// Уведомления ENDEMION PULSE: новые главы тайтлов с полки, ответы, подписчики, достижения, решения модераторов.
// Настройки получателя (user_profiles.notify_*) проверяются при создании: выключенный вид не записывается вовсе

const PREFERENCE = {
  chapter: "notify_chapters",
  reply: "notify_replies",
  follow: "notify_follows",
  achievement: "notify_achievements"
};

// Уведомлений на пользователя хранится не больше этого числа: старые прочитанные удаляются
const KEEP = 300;

/**
 * Запрос, который создаёт уведомление, если получатель его не выключил.
 * Возвращает prepared statement, чтобы его можно было выполнить в одном batch с основным действием
 */
export function notifyStatement(env, { userId, kind, text, link = "", titleId = null, actorId = null }) {
  const column = PREFERENCE[kind];
  const allowed = column ? `AND COALESCE((SELECT ${column} FROM user_profiles WHERE user_id = ?), 1) = 1` : "AND ? IS NOT NULL";
  return env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, title_id, actor_id, text, link)
     SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) ${allowed}`
  ).bind(userId, kind, titleId, actorId, text.slice(0, 300), link, userId, userId);
}

export async function notify(env, options) {
  await notifyStatement(env, options).run();
}

/**
 * Уведомления о новой главе всем, у кого тайтл на полке (кроме брошенных). Вызывается при добавлении главы в админке
 */
export function chapterNotificationStatement(env, title, number) {
  return env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, title_id, text, link)
     SELECT l.user_id, 'chapter', ?, ?, ?
     FROM library l LEFT JOIN user_profiles p ON p.user_id = l.user_id
     WHERE l.title_id = ? AND (l.status IS NULL OR l.status <> 'dropped') AND COALESCE(p.notify_chapters, 1) = 1`
  ).bind(title.id, `Вышла глава ${number}: «${title.title}»`, `/read/${title.id}/${number}`, title.id);
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
      `SELECT n.id, n.kind, n.title_id, n.text, n.link, n.created_at, n.read_at, a.name AS actor_name, p.username AS actor_username
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN user_profiles p ON p.user_id = n.actor_id
       WHERE ${where.map((part) => `n.${part}`).join(" AND ")} ORDER BY n.id DESC LIMIT ?`
    ).bind(...binds, limit),
    env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(userId)
  ]);
  return {
    notifications: list.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      titleId: row.title_id,
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
