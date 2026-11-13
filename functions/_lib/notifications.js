// Уведомления: ответы на форуме, подписчики, достижения, решения модераторов.
// Настройки получателя (user_profiles.notify_*) проверяются при создании: выключенный вид не записывается вовсе

const PREFERENCE = {
  reply: "notify_replies",
  // Упоминание @имени — тот же переключатель, что и ответы: оба про сообщения на форуме
  mention: "notify_replies",
  follow: "notify_follows",
  achievement: "notify_achievements"
};

// Уведомлений на пользователя хранится не больше этого числа: старые прочитанные удаляются
const KEEP = 300;

/**
 * Запрос, который создаёт уведомление, если получатель его не выключил.
 * Возвращает prepared statement, чтобы его можно было выполнить в одном batch с основным действием
 */
export function notifyStatement(env, { userId, kind, text, link = "", actorId = null }) {
  const column = PREFERENCE[kind];
  const allowed = column ? `AND COALESCE((SELECT ${column} FROM user_profiles WHERE user_id = ?), 1) = 1` : "AND ? IS NOT NULL";
  return env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, actor_id, text, link)
     SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) ${allowed}`
  ).bind(userId, kind, actorId, text.slice(0, 300), link, userId, userId);
}

export async function notify(env, options) {
  await notifyStatement(env, options).run();
}

const MENTION = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,24})(?![A-Za-z0-9_])/g;

/**
 * Уведомления тем, кого упомянули через @имя профиля. Себе и уже уведомлённым не пишем.
 * Возвращает prepared statements для batch вместе с основным действием
 */
export async function mentionStatements(env, { text, actor, link, told }) {
  const names = [...new Set([...text.matchAll(MENTION)].map((match) => match[1].toLowerCase()))].slice(0, 10);
  if (!names.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT u.id, p.username FROM users u JOIN user_profiles p ON p.user_id = u.id
     WHERE p.is_public = 1 AND u.blocked_at IS NULL AND lower(p.username) IN (${names.map(() => "?").join(", ")})`
  ).bind(...names).all();
  const statements = [];
  for (const row of results) {
    if (told.has(row.id)) continue;
    told.add(row.id);
    statements.push(notifyStatement(env, {
      userId: row.id, kind: "mention", actorId: actor.id, link,
      text: `${actor.name} упомянул(а) вас: @${row.username}`
    }));
  }
  return statements;
}

export async function listNotifications(env, userId, { limit = 30, before = null, unreadOnly = false } = {}) {
  const where = ["user_id = ?"];
  const binds = [userId];
  if (before) {
    where.push("id < ?");
    binds.push(before);
  }
  if (unreadOnly) where.push("read_at IS NULL");
  const [list, unread] = await env.DB.batch([
    env.DB.prepare(
      `SELECT n.id, n.kind, n.text, n.link, n.created_at, n.read_at, a.name AS actor_name, p.username AS actor_username
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN user_profiles p ON p.user_id = n.actor_id
       WHERE ${where.map((part) => `n.${part}`).join(" AND ")} ORDER BY n.id DESC LIMIT ?`
    ).bind(...binds, limit),
    env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId)
  ]);
  return {
    notifications: list.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      text: row.text,
      link: row.link,
      createdAt: row.created_at,
      read: row.read_at !== null,
      actor: row.actor_name ? { name: row.actor_name, username: row.actor_username } : null
    })),
    unread: unread.results[0].n
  };
}

export async function unreadCount(env, userId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId).first();
  return row.n;
}

export async function markRead(env, userId, ids = null) {
  if (ids === null) {
    await env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").bind(userId).run();
  } else if (ids.length) {
    await env.DB.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`
    ).bind(userId, ...ids).run();
  }
  // Изредка чистим старые прочитанные, отдельный планировщик для этого не нужен
  if (Math.random() < 0.05) {
    await env.DB.prepare(
      `DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL AND id NOT IN
         (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)`
    ).bind(userId, userId, KEEP).run();
  }
}
