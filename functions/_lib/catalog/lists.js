// Списки пользователей, избранное, оценки и отзывы энциклопедии. Произведения хранятся снимками (таблица entries),
// поэтому списки и статистика показываются без обращений к источнику

import { snapshotToEntry } from "./index.js";
import { cleanText } from "../validate.js";
import { LIST_STATUS_KEYS } from "./model.js";

// ==================== СПИСКИ ====================

export const LIST_SORTS = {
  updated: "l.updated_at DESC",
  score: "l.score IS NULL, l.score DESC, e.title COLLATE NOCASE",
  title: "e.title COLLATE NOCASE",
  year: "e.year IS NULL, e.year DESC, e.title COLLATE NOCASE",
  progress: "l.progress DESC, e.title COLLATE NOCASE"
};
export const LIST_PAGE = 60;

const LIST_SELECT = `SELECT l.status AS list_status, l.score AS user_score, l.progress, l.note, l.created_at, l.updated_at, e.*
  FROM user_list l JOIN entries e ON e.kind = l.kind AND e.ext_id = l.ext_id`;

export function toListItem(row) {
  return {
    entry: snapshotToEntry(row),
    status: row.list_status,
    score: row.user_score,
    progress: row.progress,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getListItem(env, userId, kind, id) {
  const row = await env.DB.prepare(`${LIST_SELECT} WHERE l.user_id = ? AND l.kind = ? AND l.ext_id = ?`).bind(userId, kind, id).first();
  return row ? toListItem(row) : null;
}

/** Страница списка пользователя с фильтром по статусу и поиском по названию */
export async function listItems(env, userId, kind, { status = "", sort = "updated", q = "", offset = 0 } = {}) {
  const where = ["l.user_id = ?", "l.kind = ?"];
  const binds = [userId, kind];
  if (status) {
    where.push("l.status = ?");
    binds.push(status);
  }
  if (q) {
    where.push("(e.title LIKE ? ESCAPE '\\' OR e.title_en LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    binds.push(like, like);
  }
  const [page, count] = await env.DB.batch([
    env.DB.prepare(`${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${LIST_SORTS[sort]} LIMIT ? OFFSET ?`).bind(...binds, LIST_PAGE, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM user_list l JOIN entries e ON e.kind = l.kind AND e.ext_id = l.ext_id WHERE ${where.join(" AND ")}`).bind(...binds)
  ]);
  const total = count.results[0].n;
  return { items: page.results.map(toListItem), total, hasMore: offset + page.results.length < total };
}

/** Статистика списка: сколько в каждом статусе, сколько серий или глав, часы просмотра, средняя оценка и распределение */
export async function listStats(env, userId, kind) {
  const [byStatus, totals, scores] = await env.DB.batch([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM user_list WHERE user_id = ? AND kind = ? GROUP BY status").bind(userId, kind),
    env.DB.prepare(
      `SELECT COALESCE(SUM(l.progress), 0) AS units, COALESCE(SUM(l.progress * e.duration), 0) AS minutes,
         AVG(l.score) AS mean, COUNT(l.score) AS rated
       FROM user_list l JOIN entries e ON e.kind = l.kind AND e.ext_id = l.ext_id WHERE l.user_id = ? AND l.kind = ?`
    ).bind(userId, kind),
    env.DB.prepare("SELECT score, COUNT(*) AS n FROM user_list WHERE user_id = ? AND kind = ? AND score IS NOT NULL GROUP BY score").bind(userId, kind)
  ]);
  const statuses = Object.fromEntries(LIST_STATUS_KEYS.map((key) => [key, 0]));
  for (const row of byStatus.results) statuses[row.status] = row.n;
  const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
  for (const row of scores.results) distribution[row.score] = row.n;
  const t = totals.results[0];
  return {
    statuses,
    total: Object.values(statuses).reduce((sum, n) => sum + n, 0),
    units: t.units,
    hours: Math.round((t.minutes / 60) * 10) / 10,
    meanScore: t.mean ? Math.round(t.mean * 100) / 100 : null,
    rated: t.rated,
    distribution
  };
}

/**
 * Проверка изменений записи списка. entry — снимок произведения, current — текущая запись или null.
 * Возвращает { values } с итоговыми значениями или { problem }
 */
export function listChanges(body, entry, current) {
  const status = body.status ?? current?.status;
  if (!LIST_STATUS_KEYS.includes(status)) return { problem: "Выберите статус." };
  const score = body.score === undefined ? current?.score ?? null : body.score;
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 10)) return { problem: "Оценка: целое число от 1 до 10." };
  let progress = body.progress === undefined ? current?.progress ?? 0 : body.progress;
  if (!Number.isInteger(progress) || progress < 0 || progress > 100000) return { problem: "Прогресс: целое неотрицательное число." };
  // Сколько всего серий или глав. У выходящего аниме может быть неизвестно (0)
  const total = entry.units || 0;
  if (total && progress > total) return { problem: `Прогресс не больше ${total}.` };
  const note = body.note === undefined ? current?.note ?? "" : body.note;
  if (typeof note !== "string" || cleanText(note).length > 500) return { problem: "Заметка не длиннее 500 символов." };
  let finalStatus = status;
  // «Просмотрено» — значит до конца; последняя серия — значит просмотрено
  if (status === "completed" && total) progress = total;
  else if (total && progress === total && status === "current" && body.status === undefined) finalStatus = "completed";
  return { values: { status: finalStatus, score, progress, note: cleanText(note) } };
}

// ==================== ИЗБРАННОЕ ====================

export const FAVORITE_TYPES = ["anime", "manga", "character", "person"];
const FAVORITES_LIMIT = 500;

export async function listFavorites(env, userId, type = "") {
  const { results } = await env.DB.prepare(
    `SELECT target_type, ext_id, name, image, created_at FROM favorites WHERE user_id = ?${type ? " AND target_type = ?" : ""}
     ORDER BY created_at DESC LIMIT ?`
  ).bind(...(type ? [userId, type] : [userId]), FAVORITES_LIMIT).all();
  return results.map((row) => ({ type: row.target_type, id: row.ext_id, name: row.name, image: row.image || null, createdAt: row.created_at }));
}

export async function isFavorite(env, userId, type, id) {
  return Boolean(await env.DB.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND target_type = ? AND ext_id = ?").bind(userId, type, id).first());
}

export async function countFavorites(env, userId) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").bind(userId).first()).n;
}

export { FAVORITES_LIMIT };

// ==================== ОЦЕНКИ ENDEMION ====================

/**
 * Оценки пользователей Endemion: из списков и из отзывов тех, кто не поставил оценку в списке.
 * Одна оценка на пользователя
 */
const SCORES_CTE = `WITH scores AS (
  SELECT kind, ext_id, user_id, score FROM user_list WHERE score IS NOT NULL
  UNION ALL
  SELECT r.kind, r.ext_id, r.user_id, r.score FROM entry_reviews r
  WHERE r.hidden_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM user_list l WHERE l.user_id = r.user_id AND l.kind = r.kind AND l.ext_id = r.ext_id AND l.score IS NOT NULL)
)`;

export async function endemionScore(env, kind, id) {
  const row = await env.DB.prepare(`${SCORES_CTE} SELECT AVG(score) AS average, COUNT(*) AS votes FROM scores WHERE kind = ? AND ext_id = ?`)
    .bind(kind, id).first();
  return row.votes ? { average: Math.round(row.average * 100) / 100, votes: row.votes } : null;
}

// Байесовское среднее: пока оценок мало, место в рейтинге ближе к средней оценке 7
const PRIOR = 7;
const WEIGHT = 5;
export const ENDEMION_TOP_MIN_VOTES = 2;

export async function endemionTop(env, kind, limit = 50) {
  const { results } = await env.DB.prepare(
    `${SCORES_CTE}
     SELECT e.*, AVG(s.score) AS average, COUNT(*) AS votes,
       (SUM(s.score) + ${PRIOR * WEIGHT}) * 1.0 / (COUNT(*) + ${WEIGHT}) AS weighted
     FROM scores s JOIN entries e ON e.kind = s.kind AND e.ext_id = s.ext_id
     WHERE s.kind = ? GROUP BY s.kind, s.ext_id HAVING COUNT(*) >= ? ORDER BY weighted DESC, votes DESC LIMIT ?`
  ).bind(kind, ENDEMION_TOP_MIN_VOTES, limit).all();
  return results.map((row) => ({ ...snapshotToEntry(row), endemion: { average: Math.round(row.average * 100) / 100, votes: row.votes } }));
}

// ==================== ОТЗЫВЫ ====================

export const REVIEW_MIN = 30;
export const REVIEW_MAX = 10000;
export const REVIEWS_PAGE = 10;

const REVIEW_SELECT = `SELECT r.id, r.user_id, r.kind, r.ext_id, r.score, r.body, r.spoiler, r.created_at, r.updated_at, r.hidden_at,
  u.name AS author_name, u.role AS author_role, p.username AS author_username, p.avatar_version AS author_avatar, p.avatar_color AS author_color,
  e.title AS entry_title, e.slug AS entry_slug, e.poster AS entry_poster,
  (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'entry_review' AND c.target_id = r.id AND c.deleted_at IS NULL) AS comments
FROM entry_reviews r JOIN users u ON u.id = r.user_id LEFT JOIN user_profiles p ON p.user_id = r.user_id
JOIN entries e ON e.kind = r.kind AND e.ext_id = r.ext_id`;

export function toEntryReview(row, viewer) {
  return {
    id: row.id,
    kind: row.kind,
    entryId: row.ext_id,
    entry: { kind: row.kind, id: row.ext_id, slug: row.entry_slug, title: row.entry_title, poster: JSON.parse(row.entry_poster || "{}") },
    score: row.score,
    body: row.body,
    spoiler: row.spoiler === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hidden: row.hidden_at !== null,
    comments: row.comments,
    author: {
      id: row.user_id,
      name: row.author_name,
      role: row.author_role,
      username: row.author_username,
      avatar: row.author_avatar ? `/avatars/${row.user_id}?v=${row.author_avatar}` : null,
      avatarColor: row.author_color || "violet"
    },
    canEdit: Boolean(viewer && viewer.id === row.user_id),
    canModerate: Boolean(viewer?.isModerator)
  };
}

/** Отзывы о произведении и свой отзыв (даже скрытый модератором: автор видит, что он скрыт) */
export async function listEntryReviews(env, viewer, kind, id, { offset = 0 } = {}) {
  const [list, count, mine] = await env.DB.batch([
    env.DB.prepare(`${REVIEW_SELECT} WHERE r.kind = ? AND r.ext_id = ? AND r.hidden_at IS NULL ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .bind(kind, id, REVIEWS_PAGE, offset),
    env.DB.prepare("SELECT COUNT(*) AS n FROM entry_reviews WHERE kind = ? AND ext_id = ? AND hidden_at IS NULL").bind(kind, id),
    env.DB.prepare(`${REVIEW_SELECT} WHERE r.kind = ? AND r.ext_id = ? AND r.user_id = ?`).bind(kind, id, viewer?.id ?? 0)
  ]);
  const total = count.results[0].n;
  return {
    reviews: list.results.map((row) => toEntryReview(row, viewer)),
    total,
    hasMore: offset + list.results.length < total,
    mine: mine.results[0] ? toEntryReview(mine.results[0], viewer) : null
  };
}

/** Последние отзывы: для главной и сообщества */
export async function recentEntryReviews(env, viewer, { limit = 6, offset = 0, kind = "" } = {}) {
  const { results } = await env.DB.prepare(
    `${REVIEW_SELECT} WHERE r.hidden_at IS NULL${kind ? " AND r.kind = ?" : ""} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
  ).bind(...(kind ? [kind] : []), limit, offset).all();
  return results.map((row) => toEntryReview(row, viewer));
}

export async function getEntryReview(env, viewer, id) {
  const row = await env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`).bind(id).first();
  return row ? toEntryReview(row, viewer) : null;
}

/** Отзывы для админки: все или только скрытые */
export async function adminEntryReviews(env, { hidden = false, offset = 0 } = {}) {
  const [list, count] = await env.DB.batch([
    env.DB.prepare(`${REVIEW_SELECT} WHERE ${hidden ? "r.hidden_at IS NOT NULL" : "1"} ORDER BY r.id DESC LIMIT 30 OFFSET ?`).bind(offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM entry_reviews r WHERE ${hidden ? "r.hidden_at IS NOT NULL" : "1"}`)
  ]);
  return {
    reviews: list.results.map((row) => toEntryReview(row, { id: 0, isModerator: true })),
    total: count.results[0].n
  };
}
