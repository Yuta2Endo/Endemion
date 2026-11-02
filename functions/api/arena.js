// ENDEMION ARENA: голосования за персонажей, тайтлы и жанры, сравнение «кто кого», пользовательские турниры, таблицы лидеров.
// Голосования создают модераторы и администраторы, турниры — любой читатель. Результаты — только по реальным голосам.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { checkAchievements } from "../_lib/achievements.js";
import {
  advanceTournament, castVote, firstRoundPairs, getPoll, getTournament, leaderboards, listPolls, listTournaments,
  POLL_KINDS, retractVote, TOURNAMENT_SIZES
} from "../_lib/arena.js";
import { error, json, readJson } from "../_lib/http.js";
import { spamProblem, takeAction } from "../_lib/limits.js";
import { moderationStatement } from "../_lib/moderation.js";
import { hasRole, mutedProblem, requireRole, requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { parseId } from "../_lib/titles.js";
import { cleanLine, cleanText, intParam, lengthProblem } from "../_lib/validate.js";

/** Варианты голосования из запроса: ссылки на тайтлы, персонажей или жанры. Подписи берутся из базы */
async function resolveOptions(env, kind, options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 16) return { problem: "Вариантов: от 2 до 16." };
  if (kind === "versus" && options.length !== 2) return { problem: "В сравнении «кто кого» ровно два варианта." };
  const resolved = [];
  const seen = new Set();
  for (const option of options) {
    let row = null;
    if (option?.characterId) {
      row = await env.DB.prepare("SELECT c.id, c.name AS label FROM characters c WHERE c.id = ?").bind(option.characterId).first();
      if (row) row = { label: row.label, characterId: row.id };
    } else if (option?.titleId) {
      row = await env.DB.prepare("SELECT id, title AS label FROM titles WHERE id = ?").bind(option.titleId).first();
      if (row) row = { label: row.label, titleId: row.id };
    } else if (option?.genreId) {
      row = await env.DB.prepare("SELECT id, name AS label FROM genres WHERE id = ?").bind(option.genreId).first();
      if (row) row = { label: row.label, genreId: row.id };
    }
    if (!row) return { problem: "Вариант не найден в каталоге." };
    const key = JSON.stringify(row);
    if (seen.has(key)) return { problem: "Варианты повторяются." };
    seen.add(key);
    if (kind === "character" && !row.characterId) return { problem: "В голосовании за персонажей все варианты — персонажи." };
    if (kind === "title" && !row.titleId) return { problem: "В голосовании за тайтлы все варианты — тайтлы." };
    if (kind === "genre" && !row.genreId) return { problem: "В голосовании за жанры все варианты — жанры." };
    resolved.push(row);
  }
  if (kind === "versus" && !(resolved.every((row) => row.characterId) || resolved.every((row) => row.titleId))) {
    return { problem: "Сравнивать можно двух персонажей или два тайтла." };
  }
  return { options: resolved };
}

// ==================== ГОЛОСОВАНИЯ ====================

/** /api/polls — голосования (GET ?status=&kind=) и новое голосование (POST, модератор) */
export const polls = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const status = search.get("status") || null;
    if (status && !["open", "closed"].includes(status)) return error("Неизвестный статус.");
    const kind = search.get("kind") || null;
    if (kind && !POLL_KINDS[kind]) return error("Неизвестный вид голосования.");
    const offset = intParam(search.get("offset"), 0, 0, 10_000);
    if (offset === null) return error("Некорректный offset.");
    const viewer = await currentUser(env, request);
    return json({ polls: await listPolls(env, viewer?.id, { status, kind, offset }), kinds: POLL_KINDS });
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const body = await readJson(request, 20_000);
    if (!body) return error("Некорректный запрос.");
    if (!POLL_KINDS[body.kind]) return error("Выберите вид голосования.");
    const question = cleanLine(body.question);
    const problem = lengthProblem(question, "Вопрос", 3, 200) || lengthProblem(cleanText(body.description ?? ""), "Описание", 0, 1000);
    if (problem) return error(problem);
    let endsAt = null;
    if (body.days !== undefined && body.days !== null) {
      if (!Number.isInteger(body.days) || body.days < 1 || body.days > 90) return error("Срок голосования: от 1 до 90 дней.");
      endsAt = new Date(Date.now() + body.days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    }
    const resolved = await resolveOptions(env, body.kind, body.options);
    if (resolved.problem) return error(resolved.problem);

    const row = await env.DB.prepare(
      "INSERT INTO polls (kind, question, description, created_by, ends_at) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(body.kind, question, cleanText(body.description ?? ""), user.id, endsAt).first();
    await env.DB.batch([
      ...resolved.options.map((option, position) => env.DB.prepare(
        "INSERT INTO poll_options (poll_id, label, title_id, character_id, genre_id, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(row.id, option.label, option.titleId ?? null, option.characterId ?? null, option.genreId ?? null, position)),
      moderationStatement(env, user, { action: "poll.create", targetType: "poll", targetId: row.id })
    ]);
    return json({ poll: await getPoll(env, user.id, row.id) }, 201);
  }
};

/** /api/polls/:id — голосование (GET), закрыть или открыть снова (PATCH { status }), удалить (DELETE) — модератор */
export const poll = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    const viewer = await currentUser(env, request);
    const found = id ? await getPoll(env, viewer?.id, id) : null;
    return found ? json({ poll: found }) : error("Голосование не найдено.", 404);
  },

  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const id = parseId(params.id);
    const body = await readJson(request);
    if (!body || !["open", "closed"].includes(body.status)) return error("Статус: open или closed.");
    const result = await env.DB.prepare(
      `UPDATE polls SET status = ?, ends_at = CASE WHEN ? = 'open' AND ends_at <= datetime('now') THEN NULL ELSE ends_at END WHERE id = ?`
    ).bind(body.status, body.status, id).run();
    if (!result.meta.changes) return error("Голосование не найдено.", 404);
    await moderationStatement(env, user, { action: `poll.${body.status === "open" ? "open" : "close"}`, targetType: "poll", targetId: id }).run();
    return json({ poll: await getPoll(env, user.id, id) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const id = parseId(params.id);
    const result = await env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return error("Голосование не найдено.", 404);
    await moderationStatement(env, user, { action: "poll.delete", targetType: "poll", targetId: id }).run();
    return json({ ok: true });
  }
};

/** /api/polls/:id/vote — проголосовать или перенести голос (PUT { optionId }), отозвать (DELETE) */
export const pollVote = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    if (!id) return error("Голосование не найдено.", 404);
    const body = await readJson(request);
    if (!body || !Number.isInteger(body.optionId)) return error("Выберите вариант.");
    const limited = await takeAction(env, user.id, "vote");
    if (limited) return limited;
    const failed = await castVote(env, user.id, id, body.optionId);
    if (failed) return error(failed.problem, failed.status);
    const achievements = await checkAchievements(env, user.id, "vote");
    return json({ poll: await getPoll(env, user.id, id), achievements });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    if (!id) return error("Голосование не найдено.", 404);
    const failed = await retractVote(env, user.id, id);
    if (failed) return error(failed.problem, failed.status);
    return json({ poll: await getPoll(env, user.id, id) });
  }
};

// ==================== ТУРНИРЫ ====================

/** /api/tournaments — список (GET) и новый турнир (POST: 4, 8 или 16 тайтлов или персонажей в порядке посева) */
export const tournaments = {
  async onRequestGet({ request, env }) {
    const viewer = await currentUser(env, request);
    return json({ tournaments: await listTournaments(env, { includeHidden: hasRole(viewer, "moderator") }) });
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const muted = mutedProblem(user);
    if (muted) return error(muted, 403);
    const body = await readJson(request, 20_000);
    if (!body) return error("Некорректный запрос.");
    if (!["title", "character"].includes(body.kind)) return error("Турнир тайтлов или персонажей.");
    const name = cleanLine(body.name);
    const description = cleanText(body.description ?? "");
    const problem = lengthProblem(name, "Название турнира", 3, 100) || spamProblem(name) ||
      lengthProblem(description, "Описание", 0, 1000) || spamProblem(description);
    if (problem) return error(problem);
    const ids = Array.isArray(body.entries) ? body.entries : [];
    if (!TOURNAMENT_SIZES.includes(ids.length)) return error("Участников: 4, 8 или 16.");
    if (new Set(ids).size !== ids.length || !ids.every((id) => Number.isInteger(id) && id > 0)) return error("Участники повторяются.");

    const table = body.kind === "title" ? "SELECT id, title AS label FROM titles" : "SELECT id, name AS label FROM characters";
    const { results } = await env.DB.prepare(`${table} WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).all();
    if (results.length !== ids.length) return error("Участник не найден в каталоге.");
    const labels = new Map(results.map((row) => [row.id, row.label]));
    const limited = await takeAction(env, user.id, "tournament");
    if (limited) return limited;

    const row = await env.DB.prepare(
      "INSERT INTO tournaments (name, description, kind, created_by) VALUES (?, ?, ?, ?) RETURNING id"
    ).bind(name, description, body.kind, user.id).first();
    const column = body.kind === "title" ? "title_id" : "character_id";
    await env.DB.batch(ids.map((id, i) => env.DB.prepare(
      `INSERT INTO tournament_entries (tournament_id, label, ${column}, seed) VALUES (?, ?, ?, ?)`
    ).bind(row.id, labels.get(id), id, i + 1)));
    const { results: entries } = await env.DB.prepare("SELECT id, seed FROM tournament_entries WHERE tournament_id = ?").bind(row.id).all();
    const bySeed = new Map(entries.map((entry) => [entry.seed, entry.id]));
    await env.DB.batch(firstRoundPairs(ids.length).map(([a, b], i) => env.DB.prepare(
      "INSERT INTO tournament_matches (tournament_id, round, position, entry_a, entry_b) VALUES (?, 1, ?, ?, ?)"
    ).bind(row.id, i + 1, bySeed.get(a), bySeed.get(b))));
    return json({ tournament: await getTournament(env, user.id, row.id) }, 201);
  }
};

/** /api/tournaments/:id — сетка турнира (GET), закрыть раунд (POST { action: "advance" }), скрыть (DELETE) */
export const tournament = {
  async onRequestGet({ request, env, params }) {
    const viewer = await currentUser(env, request);
    const id = parseId(params.id);
    const found = id ? await getTournament(env, viewer?.id, id) : null;
    if (!found || (found.hidden && !hasRole(viewer, "moderator"))) return error("Турнир не найден.", 404);
    return json({ tournament: found });
  },

  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const found = id ? await getTournament(env, user.id, id) : null;
    if (!found || found.hidden) return error("Турнир не найден.", 404);
    if (found.createdBy !== user.id && !user.isModerator) return error("Раунд закрывает автор турнира или модератор.", 403);
    const body = await readJson(request);
    if (body?.action !== "advance") return error("Неизвестное действие.");
    const problem = await advanceTournament(env, found);
    if (problem) return error(problem, 409);
    return json({ tournament: await getTournament(env, user.id, id) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT created_by FROM tournaments WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Турнир не найден.", 404);
    const own = row.created_by === user.id;
    if (!own && !user.isModerator) return error("Удалить турнир может автор или модератор.", 403);
    if (own) {
      await env.DB.prepare("DELETE FROM tournaments WHERE id = ?").bind(id).run();
    } else {
      await env.DB.batch([
        env.DB.prepare("UPDATE tournaments SET hidden_at = datetime('now') WHERE id = ?").bind(id),
        moderationStatement(env, user, { action: "tournament.hide", targetType: "tournament", targetId: id })
      ]);
    }
    return json({ ok: true });
  }
};

/** PUT /api/tournaments/:id/matches/:match/vote { entryId } — голос в матче текущего раунда */
export const tournamentVote = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const matchId = parseId(params.match);
    const found = id ? await getTournament(env, user.id, id) : null;
    if (!found || found.hidden) return error("Турнир не найден.", 404);
    if (found.status !== "voting") return error("Турнир завершён.", 409);
    const match = found.matches.find((item) => item.id === matchId);
    if (!match) return error("Матч не найден.", 404);
    if (match.round !== found.round) return error("Этот раунд уже закрыт.", 409);
    const body = await readJson(request);
    if (!body || (body.entryId !== match.entryA && body.entryId !== match.entryB)) return error("Выберите участника матча.");
    const limited = await takeAction(env, user.id, "vote");
    if (limited) return limited;
    await env.DB.prepare(
      `INSERT INTO tournament_votes (match_id, user_id, entry_id) VALUES (?, ?, ?)
       ON CONFLICT (match_id, user_id) DO UPDATE SET entry_id = excluded.entry_id, created_at = datetime('now')`
    ).bind(matchId, user.id, body.entryId).run();
    const achievements = await checkAchievements(env, user.id, "vote");
    return json({ tournament: await getTournament(env, user.id, id), achievements });
  }
};

/** GET /api/arena/leaderboards — таблицы лидеров по реальным голосам и оценкам */
export const arenaLeaderboards = {
  async onRequestGet({ env }) {
    return json(await leaderboards(env), 200, { "Cache-Control": "public, max-age=60" });
  }
};

/** GET /api/characters?q=&title= — поиск персонажей для голосований и турниров */
export const characters = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const query = cleanLine(search.get("q") || "").slice(0, 60);
    const titleId = search.get("title") ? parseId(search.get("title")) : null;
    const where = [];
    const binds = [];
    if (query) {
      where.push("(c.name LIKE ? ESCAPE '\\' OR t.title LIKE ? ESCAPE '\\')");
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      binds.push(pattern, pattern);
    }
    if (titleId) {
      where.push("c.title_id = ?");
      binds.push(titleId);
    }
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.name, c.role, c.symbol, c.description, t.id AS title_id, t.title FROM characters c JOIN titles t ON t.id = c.title_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.title, c.id LIMIT 60`
    ).bind(...binds).all();
    return json({
      characters: results.map((row) => ({
        id: row.id, name: row.name, role: row.role, symbol: row.symbol, description: row.description, titleId: row.title_id, title: row.title
      }))
    });
  }
};
