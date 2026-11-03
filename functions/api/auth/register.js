// POST /api/auth/register — создать аккаунт и сразу войти

import { legacyAuthClosed } from "../../_lib/endemionId.js";
import { hashPassword } from "../../_lib/crypto.js";
import { clientIp, error, json, readJson } from "../../_lib/http.js";
import { createProfile } from "../../_lib/profiles.js";
import { isLimited, recordAttempt, RETRY_AFTER_SECONDS } from "../../_lib/rateLimit.js";
import { createSession } from "../../_lib/session.js";
import { verifyTurnstile } from "../../_lib/turnstile.js";
import { normalizeEmail, normalizeName, validateEmail, validateName, validatePassword } from "../../_lib/validate.js";

export async function onRequestPost({ request, env }) {
  const closed = legacyAuthClosed(env);
  if (closed) return closed;
  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const ip = clientIp(request);
  if (await isLimited(env, ip, null)) {
    return error("Слишком много попыток. Попробуйте через 15 минут.", 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });
  }

  const name = normalizeName(body.name);
  const email = normalizeEmail(body.email);
  const problem = validateName(name) || validateEmail(email) || validatePassword(body.password);
  if (problem) return error(problem);
  if (body.consent !== true) return error("Нужно согласие с политикой конфиденциальности.");

  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return error("Подтвердите, что вы не робот.", 403);
  }

  // Каждая регистрация считается попыткой: с одного IP нельзя создать сотни аккаунтов
  await recordAttempt(env, ip, null);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return error("Пользователь с такой почтой уже существует.", 409);

  let userId;
  try {
    const result = await env.DB.prepare(
      "INSERT INTO users (name, email, password_hash, consent_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(name, email, await hashPassword(body.password)).run();
    userId = result.meta.last_row_id;
  } catch (err) {
    // Две регистрации одной почты одновременно: вторая упирается в UNIQUE
    if (String(err).includes("UNIQUE")) return error("Пользователь с такой почтой уже существует.", 409);
    throw err;
  }
  // Профиль ENDEMION ID с адресом /u/<имя>. Имя можно сменить в настройках профиля
  await createProfile(env, userId, email, name);

  const setCookie = await createSession(env, request, userId);
  return json({ user: { id: userId, name, email } }, 201, { "Set-Cookie": setCookie });
}
