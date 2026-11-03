// POST /api/auth/login — вход по почте и паролю

import { legacyAuthClosed } from "../../_lib/endemionId.js";
import { verifyPassword } from "../../_lib/crypto.js";
import { clientIp, error, json, readJson } from "../../_lib/http.js";
import { clearAttempts, isLimited, recordAttempt, RETRY_AFTER_SECONDS } from "../../_lib/rateLimit.js";
import { cleanupSessions, createSession } from "../../_lib/session.js";
import { verifyTurnstile } from "../../_lib/turnstile.js";
import { normalizeEmail, PASSWORD_MAX } from "../../_lib/validate.js";

// Хеш-заглушка: для несуществующей почты сервер тоже считает PBKDF2,
// иначе по времени ответа можно было бы узнать, зарегистрирована ли почта
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function onRequestPost({ request, env }) {
  const closed = legacyAuthClosed(env);
  if (closed) return closed;
  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const ip = clientIp(request);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > PASSWORD_MAX) return error("Введите почту и пароль.");

  if (await isLimited(env, ip, email)) {
    return error("Слишком много неудачных попыток. Попробуйте через 15 минут.", 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return error("Подтвердите, что вы не робот.", 403);
  }

  const user = await env.DB.prepare("SELECT id, name, email, password_hash, blocked_at FROM users WHERE email = ?").bind(email).first();
  const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !valid) {
    await recordAttempt(env, ip, email);
    return error("Неверная почта или пароль.", 401);
  }
  // О блокировке сообщаем только после верного пароля: по ответу нельзя узнать, что чужой аккаунт заблокирован
  if (user.blocked_at) {
    return error("Аккаунт заблокирован. Если это ошибка, напишите на адрес из политики конфиденциальности.", 403);
  }

  await clearAttempts(env, email);
  // Изредка чистим истёкшие сессии, отдельный планировщик для этого не нужен
  if (Math.random() < 0.05) await cleanupSessions(env);

  const setCookie = await createSession(env, request, user.id);
  return json({ user: { id: user.id, name: user.name, email: user.email } }, 200, { "Set-Cookie": setCookie });
}
