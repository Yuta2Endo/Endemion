// Пользователи: вид для админки и удаление со всеми данными (из профиля и из админки)

// Сеансы считаются только действующие: время подставляется первым параметром запроса
export const USER_SELECT = `SELECT u.id, u.name, u.email, u.created_at, u.role, u.blocked_at, u.muted_until, p.username,
  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions,
  (SELECT COUNT(*) FROM library l WHERE l.user_id = u.id) AS library,
  (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS comments,
  (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.status = 'open') AS reports
FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`;

export function toAdminUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
    role: row.role,
    isAdmin: row.role === "admin",
    blockedAt: row.blocked_at,
    mutedUntil: row.muted_until,
    sessions: row.sessions,
    library: row.library,
    comments: row.comments,
    reports: row.reports
  };
}

export async function getAdminUser(env, id) {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(Date.now(), id).first();
  return row ? toAdminUser(row) : null;
}

/**
 * Запросы для удаления пользователя. Личные данные удаляются явно, не полагаясь на каскад внешних ключей.
 * Комментарии и обсуждения превращаются в заглушки «Комментарий удалён»: иначе пропали бы ответы других людей
 */
export function deleteUserStatements(env, user) {
  return [
    env.DB.prepare("UPDATE comments SET body = '', deleted_at = COALESCE(deleted_at, datetime('now')), user_id = NULL WHERE user_id = ?").bind(user.id),
    env.DB.prepare("UPDATE threads SET body = '', deleted_at = COALESCE(deleted_at, datetime('now')), user_id = NULL WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM comment_reactions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM reviews WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM entry_reviews WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_list WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_spoiler_settings WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM collections WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM follows WHERE follower_id = ? OR followee_id = ?").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM notifications WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM votes WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM tournament_votes WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_achievements WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM view_history WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM library WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM positions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${user.email}`),
    env.DB.prepare("DELETE FROM rate_events WHERE key LIKE ?").bind(`u${user.id}:%`),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
  ];
}
