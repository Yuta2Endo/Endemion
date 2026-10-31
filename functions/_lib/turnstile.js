// Проверка Cloudflare Turnstile. Без секретного ключа проверка выключена: удобно локально и до настройки

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== "string" || !token) return false;

  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip && ip !== "local") body.append("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}
