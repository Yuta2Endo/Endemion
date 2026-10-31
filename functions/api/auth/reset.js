// POST /api/auth/reset — новый пароль по ссылке из письма. Ссылка одноразовая.
// Все сессии завершаются: если пароль меняют из-за взлома, чужой вход тоже закончится. На этом устройстве пользователь входит

import { hashPassword, sha256 } from "../../_lib/crypto.js";
import { error, json, readJson } from "../../_lib/http.js";
import { createSession } from "../../_lib/session.js";
import { validatePassword } from "../../_lib/validate.js";

const INVALID = "Ссылка устарела или уже использована. Запросите новую.";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return error(INVALID);
  const problem = validatePassword(body.password);
  if (problem) return error(problem);

  // Ссылка удаляется в момент проверки: два одновременных запроса с одной ссылкой не пройдут оба
  const row = await env.DB.prepare("DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ? RETURNING user_id")
    .bind(await sha256(token), Date.now())
    .first();
  if (!row) return error(INVALID);

  const user = await env.DB.prepare("SELECT id, email FROM users WHERE id = ? AND blocked_at IS NULL").bind(row.user_id).first();
  if (!user) return error(INVALID);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(body.password), user.id),
    env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    // Блокировка после неудачных входов снимается: владелец подтвердил почту
    env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${user.email}`)
  ]);

  const setCookie = await createSession(env, request, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}
