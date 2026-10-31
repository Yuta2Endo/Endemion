// Сессии в D1 и cookie. Токен живёт только в cookie с HttpOnly, в базе — его SHA-256

import { newToken, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "endemion_session";
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * Атрибуты cookie. Secure ставится только на https: локальный `wrangler pages dev` работает по http
 */
function cookie(request, value, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Создать сессию и вернуть заголовок Set-Cookie */
export async function createSession(env, request, userId) {
  const token = newToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now + SESSION_DAYS * DAY_MS, now)
    .run();
  return cookie(request, token, SESSION_DAYS * 24 * 60 * 60);
}

/** Пользователь текущей сессии или null */
export async function currentUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.name, users.email, users.created_at, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

/** Удалить текущую сессию и вернуть заголовок, который стирает cookie */
export async function destroySession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return cookie(request, "", 0);
}

/** Выйти на всех устройствах: после смены пароля старые сессии не должны работать */
export async function destroyAllSessions(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

/** Удалить истёкшие сессии. Вызывается изредка при входе, чтобы таблица не росла */
export async function cleanupSessions(env) {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
}
