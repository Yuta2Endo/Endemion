// Ограничение неудачных попыток входа и регистрации, чтобы пароль нельзя было подобрать перебором

const WINDOW_MS = 15 * 60 * 1000;

export const LIMITS = {
  // Неудачных входов в один аккаунт за 15 минут
  email: 5,
  // Попыток с одного IP за 15 минут: входы, регистрации и запросы на восстановление пароля
  ip: 30,
  // Писем для восстановления пароля на одну почту за 15 минут: чужой ящик нельзя завалить письмами
  reset: 3
};

async function count(env, key) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND created_at > ?")
    .bind(key, Date.now() - WINDOW_MS)
    .first();
  return row ? row.n : 0;
}

/** true, если с этого IP или для этой почты попыток уже слишком много */
export async function isLimited(env, ip, email) {
  if ((await count(env, `ip:${ip}`)) >= LIMITS.ip) return true;
  if (email && (await count(env, `email:${email}`)) >= LIMITS.email) return true;
  return false;
}

async function record(env, keys) {
  const now = Date.now();
  const statements = keys.map((key) => env.DB.prepare("INSERT INTO auth_attempts (key, created_at) VALUES (?, ?)").bind(key, now));
  // Старые записи больше не нужны
  statements.push(env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(now - WINDOW_MS));
  await env.DB.batch(statements);
}

export async function recordAttempt(env, ip, email) {
  await record(env, email ? [`ip:${ip}`, `email:${email}`] : [`ip:${ip}`]);
}

/** true, если с этого IP или на эту почту уже запросили слишком много писем для восстановления пароля */
export async function isResetLimited(env, ip, email) {
  if ((await count(env, `ip:${ip}`)) >= LIMITS.ip) return true;
  return (await count(env, `reset:${email}`)) >= LIMITS.reset;
}

export async function recordReset(env, ip, email) {
  await record(env, [`ip:${ip}`, `reset:${email}`]);
}

/** После успешного входа счётчик для почты сбрасывается */
export async function clearAttempts(env, email) {
  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${email}`).run();
}

export const RETRY_AFTER_SECONDS = WINDOW_MS / 1000;
