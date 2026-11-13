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
// Жалобы на отзывы, подборки и турниры прежних разделов остались в базе, но в очередь модерации не попадают
export const REPORT_TARGETS = ["comment", "thread", "user"];

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
    comment: `SELECT c.id, c.user_id AS owner_id, c.body AS text, COALESCE(c.deleted_at, c.hidden_at) AS removed_at, c.target_type, c.target_id FROM comments c WHERE c.id = ?`,
    thread: `SELECT t.id, t.user_id AS owner_id, t.subject || ' — ' || t.body AS text, COALESCE(t.deleted_at, t.hidden_at) AS removed_at, 'thread' AS target_type, t.id AS target_id FROM threads t WHERE t.id = ?`,
    user: `SELECT u.id, u.id AS owner_id, u.name || ' (@' || COALESCE(p.username, '') || ') — ' || COALESCE(p.bio, '') AS text, u.blocked_at AS removed_at, 'user' AS target_type, u.id AS target_id FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`
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
    case "thread":
      return `/community/thread/${row.id}`;
    case "user": {
      const profile = await env.DB.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(row.id).first();
      return profile ? `/users/${profile.username}` : "";
    }
    default:
      return "";
  }
}

export async function commentLink(env, targetType, targetId, commentId) {
  return targetType === "thread" ? `/community/thread/${targetId}#comment-${commentId}` : "";
}

/**
 * Запросы для действия модератора над контентом. action: remove (скрыть или удалить) или restore.
 * Комментарий при удалении становится заглушкой, чтобы ответы на него остались на месте
 */
export function contentStatements(env, moderator, type, id, action) {
  const remove = action === "remove";
  switch (type) {
    case "comment":
      // Удаление стирает текст безвозвратно; скрытый после жалоб ответ модератор возвращает целиком
      return remove
        ? [env.DB.prepare("UPDATE comments SET body = '', deleted_at = datetime('now'), deleted_by = ?, hidden_at = NULL, hidden_by = NULL WHERE id = ? AND deleted_at IS NULL").bind(moderator.id, id)]
        : [env.DB.prepare("UPDATE comments SET hidden_at = NULL, hidden_by = NULL WHERE id = ? AND hidden_at IS NOT NULL AND deleted_at IS NULL").bind(id)];
    case "thread":
      return [remove
        ? env.DB.prepare("UPDATE threads SET deleted_at = datetime('now'), deleted_by = ?, hidden_at = NULL, hidden_by = NULL WHERE id = ?").bind(moderator.id, id)
        : env.DB.prepare("UPDATE threads SET deleted_at = NULL, deleted_by = NULL, hidden_at = NULL, hidden_by = NULL WHERE id = ? AND body <> ''").bind(id)];
    default:
      return null;
  }
}

/** Уведомление автору о решении модератора */
export function moderationNotice(env, ownerId, text) {
  return ownerId ? [notifyStatement(env, { userId: ownerId, kind: "moderation", text })] : [];
}

export const CONTENT_LABELS = {
  comment: "Ответ",
  thread: "Тема форума",
  user: "Профиль"
};
