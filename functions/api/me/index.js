// /api/me — текущий пользователь: данные профиля, смена имени, удаление аккаунта

import { verifyPassword } from "../../_lib/crypto.js";
import { error, json, readJson } from "../../_lib/http.js";
import { unreadCount } from "../../_lib/notifications.js";
import { readingStats } from "../../_lib/profiles.js";
import { currentUser, destroySession } from "../../_lib/session.js";
import { deleteUserStatements } from "../../_lib/users.js";
import { normalizeName, validateName } from "../../_lib/validate.js";

/** Гость получает { user: null } с кодом 200: страницам проще, а в консоли браузера нет ошибок */
export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ user: null });
  const [stats, unread] = await Promise.all([readingStats(env, user.id), unreadCount(env, user.id)]);
  return json({ user, stats, unread });
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

  // Аватар в хранилище картинок удаляется вместе с аккаунтом
  const profile = await env.DB.prepare("SELECT avatar_version FROM user_profiles WHERE user_id = ?").bind(user.id).first();
  await env.DB.batch(deleteUserStatements(env, user));
  if (profile?.avatar_version && env.PAGES) await env.PAGES.delete(`avatars/${user.id}/${profile.avatar_version}`);

  const setCookie = await destroySession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}
