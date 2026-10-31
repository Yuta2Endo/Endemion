// Пользователи: вид для админки и удаление со всеми данными (из профиля и из админки)

// Сеансы считаются только действующие: время подставляется первым параметром запроса
export const USER_SELECT = `SELECT u.id, u.name, u.email, u.created_at, u.is_admin, u.blocked_at,
  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions,
  (SELECT COUNT(*) FROM library l WHERE l.user_id = u.id) AS library
FROM users u`;

export function toAdminUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
    blockedAt: row.blocked_at,
    sessions: row.sessions,
    library: row.library
  };
}

export async function getAdminUser(env, id) {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(Date.now(), id).first();
  return row ? toAdminUser(row) : null;
}

/** Запросы для удаления пользователя. Всё удаляется явно, не полагаясь на каскад внешних ключей */
export function deleteUserStatements(env, user) {
  return [
    env.DB.prepare("DELETE FROM library WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM positions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${user.email}`),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
  ];
}
