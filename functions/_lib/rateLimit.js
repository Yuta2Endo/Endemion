// Ограничение неудачных попыток входа и регистрации, чтобы пароль нельзя было подобрать перебором

const WINDOW_MS = 15 * 60 * 1000;

export const LIMITS = {
  // Неудачных входов в один аккаунт за 15 минут
  email: 5,
  // Попыток с одного IP за 15 минут: и входы, и регистрации
  ip: 30
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

export async function recordAttempt(env, ip, email) {
  const now = Date.now();
  const statements = [env.DB.prepare("INSERT INTO auth_attempts (key, created_at) VALUES (?, ?)").bind(`ip:${ip}`, now)];
  if (email) statements.push(env.DB.prepare("INSERT INTO auth_attempts (key, created_at) VALUES (?, ?)").bind(`email:${email}`, now));
  // Старые записи больше не нужны
  statements.push(env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(now - WINDOW_MS));
  await env.DB.batch(statements);
}

/** После успешного входа счётчик для почты сбрасывается */
export async function clearAttempts(env, email) {
  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${email}`).run();
}

export const RETRY_AFTER_SECONDS = WINDOW_MS / 1000;
