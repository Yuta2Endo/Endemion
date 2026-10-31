// /api/me — текущий пользователь: данные профиля, смена имени, удаление аккаунта

import { verifyPassword } from "../../_lib/crypto.js";
import { error, json, readJson } from "../../_lib/http.js";
import { currentUser, destroySession } from "../../_lib/session.js";
import { normalizeName, validateName } from "../../_lib/validate.js";

/** Гость получает { user: null } с кодом 200: страницам проще, а в консоли браузера нет ошибок */
export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ user: null });

  const stats = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(favorite), 0) AS favorites,
       COALESCE(SUM(status = 'reading'), 0) AS reading,
       COALESCE(SUM(status = 'completed'), 0) AS completed,
       COALESCE(SUM(chapter), 0) AS chapters
     FROM library WHERE user_id = ?`
  ).bind(user.id).first();

  return json({ user, stats });
}

export async function onRequestPatch({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в профиль.", 401);

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");

  const name = normalizeName(body.name);
  const problem = validateName(name);
  if (problem) return error(problem);

  await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
  return json({ user: { ...user, name } });
}

/** Удаление аккаунта требует пароль: случайно открытая чужая сессия не сможет его удалить */
export async function onRequestDelete({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в профиль.", 401);

  const body = await readJson(request);
  const password = body && typeof body.password === "string" ? body.password : "";
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!row || !(await verifyPassword(password, row.password_hash))) return error("Неверный пароль.", 403);

  // Удаляем явно, не полагаясь на каскад внешних ключей
  await env.DB.batch([
    env.DB.prepare("DELETE FROM library WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM positions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`email:${user.email}`),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)
  ]);

  const setCookie = await destroySession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}
