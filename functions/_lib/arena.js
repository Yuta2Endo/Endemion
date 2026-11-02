// ENDEMION ARENA: голосования (персонажи, тайтлы, жанры, сравнение «кто кого»), турниры на выбывание и таблицы лидеров.
// Все результаты считаются по таблицам votes и tournament_votes: один голос на пользователя в голосовании или матче

import { BAYES_PRIOR, BAYES_WEIGHT } from "./titles.js";

export const POLL_KINDS = { character: "Персонажи", title: "Тайтлы", genre: "Жанры", versus: "Кто кого" };
export const TOURNAMENT_SIZES = [4, 8, 16];

/** Голосования с истёкшим сроком закрываются при первом обращении: отдельный планировщик не нужен */
export async function closeExpiredPolls(env) {
  await env.DB.prepare("UPDATE polls SET status = 'closed' WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= datetime('now')").run();
}

const POLL_SELECT = `SELECT p.id, p.kind, p.question, p.description, p.status, p.ends_at, p.created_at, p.created_by,
  (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS total
FROM polls p`;

function toPoll(row) {
  return {
    id: row.id,
    kind: row.kind,
    question: row.question,
    description: row.description,
    status: row.status,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    total: row.total
  };
}

/** Варианты голосований с числом голосов и выбором пользователя */
async function attachOptions(env, polls, viewerId) {
  if (!polls.length) return polls;
  const ids = polls.map((poll) => poll.id);
  const marks = ids.map(() => "?").join(", ");
  const [options, mine] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.id, o.poll_id, o.label, o.title_id, o.character_id, o.genre_id, o.position,
         (SELECT COUNT(*) FROM votes v WHERE v.option_id = o.id) AS votes,
         t.symbol AS title_symbol, t.poster AS title_poster, c.symbol AS character_symbol, ct.title AS character_title
       FROM poll_options o
       LEFT JOIN titles t ON t.id = COALESCE(o.title_id, (SELECT title_id FROM characters WHERE id = o.character_id))
       LEFT JOIN characters c ON c.id = o.character_id
       LEFT JOIN titles ct ON ct.id = c.title_id
       WHERE o.poll_id IN (${marks}) ORDER BY o.poll_id, o.position, o.id`
    ).bind(...ids),
    env.DB.prepare(`SELECT poll_id, option_id FROM votes WHERE user_id = ? AND poll_id IN (${marks})`).bind(viewerId ?? 0, ...ids)
  ]);
  const myVote = new Map(mine.results.map((row) => [row.poll_id, row.option_id]));
  const byPoll = new Map();
  for (const row of options.results) {
    const list = byPoll.get(row.poll_id) || [];
    list.push({
      id: row.id,
      label: row.label,
      titleId: row.title_id,
      characterId: row.character_id,
      genreId: row.genre_id,
      votes: row.votes,
      symbol: row.character_symbol || row.title_symbol || "✦",
      poster: row.title_poster || null,
      subtitle: row.character_title || null
    });
    byPoll.set(row.poll_id, list);
  }
  return polls.map((poll) => {
    const list = byPoll.get(poll.id) || [];
    const leader = Math.max(0, ...list.map((option) => option.votes));
    return {
      ...poll,
      myVote: myVote.get(poll.id) ?? null,
      options: list.map((option) => ({
        ...option,
        percent: poll.total ? Math.round((option.votes / poll.total) * 1000) / 10 : 0,
        leading: poll.total > 0 && option.votes === leader
      }))
    };
  });
}

export async function listPolls(env, viewerId, { status = null, kind = null, limit = 20, offset = 0 } = {}) {
  await closeExpiredPolls(env);
  const where = [];
  const binds = [];
  if (status) {
    where.push("p.status = ?");
    binds.push(status);
  }
  if (kind) {
    where.push("p.kind = ?");
    binds.push(kind);
  }
  const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const { results } = await env.DB.prepare(`${POLL_SELECT}${filter} ORDER BY p.status = 'open' DESC, p.id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset).all();
  return attachOptions(env, results.map(toPoll), viewerId);
}

export async function getPoll(env, viewerId, id) {
  await closeExpiredPolls(env);
  const row = await env.DB.prepare(`${POLL_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!row) return null;
  return (await attachOptions(env, [toPoll(row)], viewerId))[0];
}

/** Проголосовать или перенести голос. Возвращает текст ошибки или null */
export async function castVote(env, userId, pollId, optionId) {
  await closeExpiredPolls(env);
  const poll = await env.DB.prepare("SELECT status FROM polls WHERE id = ?").bind(pollId).first();
  if (!poll) return { status: 404, problem: "Голосование не найдено." };
  if (poll.status !== "open") return { status: 409, problem: "Голосование закрыто." };
  const option = await env.DB.prepare("SELECT id FROM poll_options WHERE id = ? AND poll_id = ?").bind(optionId, pollId).first();
  if (!option) return { status: 400, problem: "Такого варианта нет." };
  await env.DB.prepare(
    `INSERT INTO votes (poll_id, user_id, option_id) VALUES (?, ?, ?)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = datetime('now')`
  ).bind(pollId, userId, optionId).run();
  return null;
}

export async function retractVote(env, userId, pollId) {
  const poll = await env.DB.prepare("SELECT status FROM polls WHERE id = ?").bind(pollId).first();
  if (!poll) return { status: 404, problem: "Голосование не найдено." };
  if (poll.status !== "open") return { status: 409, problem: "Голосование закрыто." };
  await env.DB.prepare("DELETE FROM votes WHERE poll_id = ? AND user_id = ?").bind(pollId, userId).run();
  return null;
}

// ==================== ТУРНИРЫ ====================

/** Пары первого раунда по посеву: 1–N, 2–(N-1)... Так сильнейшие встречаются только в финале */
export function firstRoundPairs(size) {
  const pairs = [];
  for (let i = 1; i <= size / 2; i++) pairs.push([i, size + 1 - i]);
  return pairs;
}

/** Победитель матча по голосам. Ничья — проходит участник с лучшим посевом (меньший номер) */
export function matchWinner(match) {
  if (match.votesA > match.votesB) return match.entryA;
  if (match.votesB > match.votesA) return match.entryB;
  return match.seedA <= match.seedB ? match.entryA : match.entryB;
}

export async function getTournament(env, viewerId, id) {
  const tournament = await env.DB.prepare(
    `SELECT t.*, u.name AS author_name, p.username AS author_username FROM tournaments t
     LEFT JOIN users u ON u.id = t.created_by LEFT JOIN user_profiles p ON p.user_id = t.created_by WHERE t.id = ?`
  ).bind(id).first();
  if (!tournament) return null;
  const [entries, matches, mine] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.id, e.label, e.title_id, e.character_id, e.seed, COALESCE(c.symbol, t.symbol, '✦') AS symbol, t.poster
       FROM tournament_entries e LEFT JOIN characters c ON c.id = e.character_id
       LEFT JOIN titles t ON t.id = COALESCE(e.title_id, c.title_id) WHERE e.tournament_id = ? ORDER BY e.seed`
    ).bind(id),
    env.DB.prepare(
      `SELECT m.id, m.round, m.position, m.entry_a, m.entry_b, m.winner_id,
         (SELECT COUNT(*) FROM tournament_votes v WHERE v.match_id = m.id AND v.entry_id = m.entry_a) AS votes_a,
         (SELECT COUNT(*) FROM tournament_votes v WHERE v.match_id = m.id AND v.entry_id = m.entry_b) AS votes_b
       FROM tournament_matches m WHERE m.tournament_id = ? ORDER BY m.round, m.position`
    ).bind(id),
    env.DB.prepare(
      `SELECT v.match_id, v.entry_id FROM tournament_votes v JOIN tournament_matches m ON m.id = v.match_id
       WHERE m.tournament_id = ? AND v.user_id = ?`
    ).bind(id, viewerId ?? 0)
  ]);
  const myVotes = new Map(mine.results.map((row) => [row.match_id, row.entry_id]));
  const entryById = new Map(entries.results.map((row) => [row.id, row]));
  return {
    id: tournament.id,
    name: tournament.name,
    description: tournament.description,
    kind: tournament.kind,
    status: tournament.status,
    round: tournament.round,
    hidden: tournament.hidden_at !== null,
    winnerEntryId: tournament.winner_entry_id,
    createdAt: tournament.created_at,
    createdBy: tournament.created_by,
    author: tournament.author_name ? { name: tournament.author_name, username: tournament.author_username } : null,
    rounds: Math.log2(entries.results.length),
    entries: entries.results.map((row) => ({
      id: row.id, label: row.label, titleId: row.title_id, characterId: row.character_id, seed: row.seed, symbol: row.symbol, poster: row.poster
    })),
    matches: matches.results.map((row) => ({
      id: row.id,
      round: row.round,
      position: row.position,
      entryA: row.entry_a,
      entryB: row.entry_b,
      seedA: entryById.get(row.entry_a)?.seed,
      seedB: entryById.get(row.entry_b)?.seed,
      votesA: row.votes_a,
      votesB: row.votes_b,
      winnerId: row.winner_id,
      myVote: myVotes.get(row.id) ?? null
    }))
  };
}

export async function listTournaments(env, { limit = 20, includeHidden = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.kind, t.status, t.round, t.hidden_at, t.created_at,
       (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS size,
       (SELECT COUNT(*) FROM tournament_votes v JOIN tournament_matches m ON m.id = v.match_id WHERE m.tournament_id = t.id) AS votes,
       (SELECT label FROM tournament_entries e WHERE e.id = t.winner_entry_id) AS winner
     FROM tournaments t ${includeHidden ? "" : "WHERE t.hidden_at IS NULL"} ORDER BY t.status = 'voting' DESC, t.id DESC LIMIT ?`
  ).bind(limit).all();
  return results.map((row) => ({
    id: row.id, name: row.name, description: row.description, kind: row.kind, status: row.status, round: row.round,
    hidden: row.hidden_at !== null, createdAt: row.created_at, size: row.size, votes: row.votes, winner: row.winner
  }));
}

/**
 * Закрыть текущий раунд: победители матчей по голосам проходят дальше.
 * После финала турнир завершается. Возвращает текст ошибки или null
 */
export async function advanceTournament(env, tournament) {
  if (tournament.status !== "voting") return "Турнир уже завершён.";
  const current = tournament.matches.filter((match) => match.round === tournament.round);
  if (!current.length) return "В раунде нет матчей.";
  const winners = current.map((match) => ({ match, winner: matchWinner(match) }));
  const statements = winners.map(({ match, winner }) =>
    env.DB.prepare("UPDATE tournament_matches SET winner_id = ? WHERE id = ?").bind(winner, match.id));

  if (winners.length === 1) {
    statements.push(env.DB.prepare(
      "UPDATE tournaments SET status = 'finished', winner_entry_id = ?, updated_at = datetime('now') WHERE id = ? AND round = ?"
    ).bind(winners[0].winner, tournament.id, tournament.round));
  } else {
    const next = tournament.round + 1;
    for (let i = 0; i < winners.length; i += 2) {
      statements.push(env.DB.prepare(
        "INSERT INTO tournament_matches (tournament_id, round, position, entry_a, entry_b) VALUES (?, ?, ?, ?, ?)"
      ).bind(tournament.id, next, i / 2 + 1, winners[i].winner, winners[i + 1].winner));
    }
    statements.push(env.DB.prepare("UPDATE tournaments SET round = ?, updated_at = datetime('now') WHERE id = ? AND round = ?")
      .bind(next, tournament.id, tournament.round));
  }
  try {
    await env.DB.batch(statements);
  } catch {
    // UNIQUE (tournament_id, round, position): раунд только что закрыли из другой вкладки
    return "Раунд уже закрыт. Обновите страницу.";
  }
  return null;
}

// ==================== ТАБЛИЦЫ ЛИДЕРОВ ====================

export async function leaderboards(env) {
  const [characters, titles, genres, users] = await env.DB.batch([
    // Персонажи: голоса за них во всех голосованиях и в матчах турниров
    env.DB.prepare(
      `SELECT c.id, c.name, c.symbol, t.id AS title_id, t.title,
         (SELECT COUNT(*) FROM votes v JOIN poll_options o ON o.id = v.option_id WHERE o.character_id = c.id) +
         (SELECT COUNT(*) FROM tournament_votes v JOIN tournament_entries e ON e.id = v.entry_id WHERE e.character_id = c.id) AS votes
       FROM characters c JOIN titles t ON t.id = c.title_id ORDER BY votes DESC, c.name LIMIT 10`
    ),
    // Тайтлы: байесовская оценка читателей, только с оценками
    env.DB.prepare(
      `SELECT t.id, t.title, t.symbol, t.type, COUNT(r.id) AS votes, ROUND(AVG(r.score), 1) AS average,
         (SUM(r.score) + ${BAYES_PRIOR * BAYES_WEIGHT}.0) / (COUNT(r.id) + ${BAYES_WEIGHT}) AS weighted
       FROM titles t JOIN reviews r ON r.title_id = t.id AND r.hidden_at IS NULL
       GROUP BY t.id ORDER BY weighted DESC, votes DESC LIMIT 10`
    ),
    // Жанры: голоса в голосованиях за жанры
    env.DB.prepare(
      `SELECT g.id, g.name, COUNT(v.user_id) AS votes FROM genres g
       JOIN poll_options o ON o.genre_id = g.id JOIN votes v ON v.option_id = o.id
       GROUP BY g.id ORDER BY votes DESC, g.name LIMIT 10`
    ),
    // Читатели: дочитанные тайтлы и прочитанные главы, только публичные профили
    env.DB.prepare(
      `SELECT u.id, u.name, p.username, p.avatar_version, p.avatar_color,
         SUM(l.status = 'completed') AS completed, SUM(l.chapter) AS chapters
       FROM users u JOIN user_profiles p ON p.user_id = u.id JOIN library l ON l.user_id = u.id
       WHERE p.is_public = 1 AND u.blocked_at IS NULL
       GROUP BY u.id HAVING chapters > 0 ORDER BY chapters DESC, completed DESC LIMIT 10`
    )
  ]);
  return {
    characters: characters.results.filter((row) => row.votes > 0).map((row) => ({
      id: row.id, name: row.name, symbol: row.symbol, titleId: row.title_id, title: row.title, votes: row.votes
    })),
    titles: titles.results.map((row) => ({
      id: row.id, title: row.title, symbol: row.symbol, type: row.type, votes: row.votes, average: row.average,
      weighted: Math.round(row.weighted * 100) / 100
    })),
    genres: genres.results.map((row) => ({ id: row.id, name: row.name, votes: row.votes })),
    readers: users.results.map((row) => ({
      id: row.id, name: row.name, username: row.username, completed: row.completed, chapters: row.chapters,
      avatar: row.avatar_version ? `/avatars/${row.id}?v=${row.avatar_version}` : null, avatarColor: row.avatar_color
    }))
  };
}
