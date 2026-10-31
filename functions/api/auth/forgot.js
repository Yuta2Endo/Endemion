// POST /api/auth/forgot — письмо со ссылкой для нового пароля.
// Ответ одинаковый для любой почты: по нему нельзя узнать, зарегистрирован ли адрес

import { newToken, sha256 } from "../../_lib/crypto.js";
import { escapeHtml as e } from "../../_lib/html.js";
import { clientIp, error, json, readJson } from "../../_lib/http.js";
import { mailConfigured, mailDevMode, sendMail } from "../../_lib/mail.js";
import { isResetLimited, recordReset, RETRY_AFTER_SECONDS } from "../../_lib/rateLimit.js";
import { verifyTurnstile } from "../../_lib/turnstile.js";
import { normalizeEmail, validateEmail } from "../../_lib/validate.js";

const LINK_MINUTES = 60;
const SENT = "Если аккаунт с такой почтой есть, мы отправили на неё ссылку для нового пароля. Ссылка действует 1 час.";

/** Новая ссылка для пользователя. Прежние ссылки перестают действовать, просроченные ссылки всех пользователей удаляются */
async function createLink(env, userId, origin) {
  const token = newToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").bind(userId, now),
    env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), userId, now + LINK_MINUTES * 60 * 1000, now)
  ]);
  return `${origin}/reset?token=${token}`;
}

function letter(name, link) {
  return {
    subject: "Новый пароль для Endemion",
    text: `Здравствуйте, ${name}!\n\nЧтобы задать новый пароль, откройте ссылку:\n${link}\n\n` +
      `Ссылка действует 1 час и подходит только один раз. Если вы не запрашивали новый пароль, просто удалите это письмо: ` +
      `старый пароль продолжит работать.`,
    html: `<p>Здравствуйте, ${e(name)}!</p><p>Чтобы задать новый пароль, откройте ссылку:</p>` +
      `<p><a href="${e(link)}">Задать новый пароль</a></p>` +
      `<p>Ссылка действует 1 час и подходит только один раз. Если вы не запрашивали новый пароль, просто удалите это письмо: ` +
      `старый пароль продолжит работать.</p>`
  };
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!mailConfigured(env, request)) return error("Восстановление пароля пока недоступно.", 503);

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const email = normalizeEmail(body.email);
  const problem = validateEmail(email);
  if (problem) return error(problem);

  const ip = clientIp(request);
  if (await isResetLimited(env, ip, email)) {
    return error("Слишком много запросов. Попробуйте через 15 минут.", 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) return error("Подтвердите, что вы не робот.", 403);
  await recordReset(env, ip, email);

  const user = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first();
  if (!user) return json({ message: SENT });

  // На Workers запрос доходит до этого кода, только если домен в адресе принадлежит сайту, поэтому origin можно брать из запроса
  const origin = new URL(request.url).origin;
  if (mailDevMode(env, request)) return json({ message: SENT, devLink: await createLink(env, user.id, origin) });

  // Ссылка создаётся и письмо уходит после ответа: по времени ответа не видно, есть ли аккаунт
  waitUntil(
    createLink(env, user.id, origin)
      .then((link) => sendMail(env, { to: email, ...letter(user.name, link) }))
      .catch((err) => console.error("Письмо для восстановления пароля не отправлено:", err.message))
  );
  return json({ message: SENT });
}
