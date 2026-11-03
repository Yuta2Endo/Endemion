// POST /api/me/password — сменить пароль. Все остальные сессии завершаются

import { hashPassword, verifyPassword } from "../../_lib/crypto.js";
import { accountUrl } from "../../_lib/endemionId.js";
import { error, json, readJson } from "../../_lib/http.js";
import { createSession, currentUser, destroyAllSessions } from "../../_lib/session.js";
import { validatePassword } from "../../_lib/validate.js";

export async function onRequestPost({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в профиль.", 401);

  // Пароль аккаунта Endemion ID меняется только там: он общий для Endemion и Endemion Life
  if (user.viaEndemionId) {
    return json({ error: "Пароль меняется в Endemion ID.", account: accountUrl(env) }, 409);
  }

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!row || !(await verifyPassword(String(body.currentPassword || ""), row.password_hash))) {
    return error("Текущий пароль указан неверно.", 403);
  }

  const problem = validatePassword(body.newPassword);
  if (problem) return error(problem);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(body.newPassword), user.id),
    // Ссылка из письма, запрошенная раньше, больше не должна менять пароль
    env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id)
  ]);
  // Если пароль меняют из-за утечки, чужие сессии тоже должны закончиться. Текущее устройство остаётся в профиле
  await destroyAllSessions(env, user.id);
  const setCookie = await createSession(env, request, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}
