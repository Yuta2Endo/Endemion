// Модерация: скрытие и удаление контента, ограничение публикаций, журнал действий модераторов.
// Модератор работает с контентом сообщества, блокировать аккаунты и менять роли может только администратор

import { notifyStatement } from "./notifications.js";

export const REPORT_REASONS = {
  spam: "Спам или реклама",
  abuse: "Оскорбления или травля",
  spoiler: "Спойлер без пометки",
  illegal: "Нарушает закон или авторские права",
  other: "Другое"
};
export const REPORT_TARGETS = ["comment", "review", "thread", "collection", "user", "tournament"];

/** Запрос в журнал модерации */
export function moderationStatement(env, moderator, { action, targetType, targetId, reason = "", reportId = null }) {
  return env.DB.prepare(
    `INSERT INTO moderation_actions (moderator_id, moderator_name, action, target_type, target_id, reason, report_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(moderator.id, moderator.name, action, targetType, targetId, reason.slice(0, 500), reportId);
}

/** Что пожаловались и кто автор: для очереди жалоб и для решения */
export async function loadTarget(env, type, id) {
  const queries = {
    comment: `SELECT c.id, c.user_id AS owner_id, c.body AS text, c.deleted_at AS removed_at, c.target_type, c.target_id FROM comments c WHERE c.id = ?`,
    review: `SELECT r.id, r.user_id AS owner_id, r.body AS text, r.hidden_at AS removed_at, 'title' AS target_type, r.title_id AS target_id FROM reviews r WHERE r.id = ?`,
    thread: `SELECT t.id, t.user_id AS owner_id, t.subject || ' — ' || t.body AS text, t.deleted_at AS removed_at, 'thread' AS target_type, t.id AS target_id FROM threads t WHERE t.id = ?`,
    collection: `SELECT c.id, c.user_id AS owner_id, c.name || ' — ' || c.description AS text, c.hidden_at AS removed_at, 'collection' AS target_type, c.id AS target_id FROM collections c WHERE c.id = ?`,
    user: `SELECT u.id, u.id AS owner_id, u.name || ' (@' || COALESCE(p.username, '') || ') — ' || COALESCE(p.bio, '') AS text, u.blocked_at AS removed_at, 'user' AS target_type, u.id AS target_id FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    tournament: `SELECT t.id, t.created_by AS owner_id, t.name || ' — ' || t.description AS text, t.hidden_at AS removed_at, 'tournament' AS target_type, t.id AS target_id FROM tournaments t WHERE t.id = ?`
  };
  if (!queries[type]) return null;
  const row = await env.DB.prepare(queries[type]).bind(id).first();
  if (!row) return null;
  return { ...row, link: await targetLink(env, type, row) };
}

/** Адрес, где виден контент */
export async function targetLink(env, type, row) {
  switch (type) {
    case "comment":
      return commentLink(env, row.target_type, row.target_id, row.id);
    case "review":
      return `/title/${row.target_id}#reviews`;
    case "thread":
      return `/community/thread/${row.id}`;
    case "collection":
      return `/collection/${row.id}`;
    case "tournament":
      return `/arena#tournament-${row.id}`;
    case "user": {
      const profile = await env.DB.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(row.id).first();
      return profile ? `/u/${profile.username}` : "";
    }
    default:
      return "";
  }
}

export async function commentLink(env, targetType, targetId, commentId) {
  if (targetType === "title") return `/title/${targetId}#comment-${commentId}`;
  if (targetType === "thread") return `/community/thread/${targetId}#comment-${commentId}`;
  if (targetType === "collection") return `/collection/${targetId}#comment-${commentId}`;
  if (targetType === "review") {
    const review = await env.DB.prepare("SELECT title_id FROM reviews WHERE id = ?").bind(targetId).first();
    return review ? `/title/${review.title_id}#review-${targetId}` : "";
  }
  return "";
}

/**
 * Запросы для действия модератора над контентом. action: remove (скрыть или удалить) или restore.
 * Комментарий при удалении становится заглушкой, чтобы ответы на него остались на месте
 */
export function contentStatements(env, moderator, type, id, action) {
  const remove = action === "remove";
  switch (type) {
    case "comment":
      // Восстановить удалённый комментарий нельзя: текст стирается
      return remove
        ? [env.DB.prepare("UPDATE comments SET body = '', deleted_at = datetime('now'), deleted_by = ? WHERE id = ? AND deleted_at IS NULL").bind(moderator.id, id)]
        : null;
    case "review":
      return [remove
        ? env.DB.prepare("UPDATE reviews SET hidden_at = datetime('now'), hidden_by = ? WHERE id = ?").bind(moderator.id, id)
        : env.DB.prepare("UPDATE reviews SET hidden_at = NULL, hidden_by = NULL WHERE id = ?").bind(id)];
    case "thread":
      return [remove
        ? env.DB.prepare("UPDATE threads SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").bind(moderator.id, id)
        : env.DB.prepare("UPDATE threads SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND body <> ''").bind(id)];
    case "collection":
      return [env.DB.prepare(`UPDATE collections SET hidden_at = ${remove ? "datetime('now')" : "NULL"}${remove ? ", featured = 0" : ""} WHERE id = ?`).bind(id)];
    case "tournament":
      return [env.DB.prepare(`UPDATE tournaments SET hidden_at = ${remove ? "datetime('now')" : "NULL"} WHERE id = ?`).bind(id)];
    default:
      return null;
  }
}

/** Уведомление автору о решении модератора */
export function moderationNotice(env, ownerId, text) {
  return ownerId ? [notifyStatement(env, { userId: ownerId, kind: "moderation", text })] : [];
}

export const CONTENT_LABELS = {
  comment: "Комментарий",
  review: "Отзыв",
  thread: "Обсуждение",
  collection: "Подборка",
  user: "Профиль",
  tournament: "Турнир"
};
