// Ограничение частоты действий вошедших пользователей: комментарии, отзывы, голоса, жалобы, подписки.
// Ключ — u<id>:<действие>. Окна до суток, старые записи удаляются при записи новых

import { error } from "./http.js";

const HOUR = 60 * 60 * 1000;

// [сколько действий, за сколько миллисекунд]
export const ACTION_LIMITS = {
  comment: [[6, 60 * 1000], [60, HOUR]],
  thread: [[3, 10 * 60 * 1000], [15, 24 * HOUR]],
  review: [[10, HOUR]],
  reaction: [[60, 60 * 1000]],
  vote: [[30, 60 * 1000]],
  report: [[10, HOUR]],
  follow: [[30, HOUR]],
  collection: [[20, HOUR]],
  poll: [[5, 24 * HOUR]],
  tournament: [[3, 24 * HOUR]],
  avatar: [[10, HOUR]],
  oracle: [[60, 60 * 1000]],
  list: [[120, 60 * 1000], [2000, 24 * HOUR]],
  favorite: [[60, 60 * 1000], [500, 24 * HOUR]],
  entryReview: [[5, HOUR], [20, 24 * HOUR]]
};

// Запросы к каталогу с одного IP (гости тоже): каждый новый запрос может уйти во внешний источник
export const IP_LIMITS = {
  search: [[40, 60 * 1000]],
  catalog: [[150, 60 * 1000]]
};

/** То же, что takeAction, но по IP посетителя. Ответ 429 или null */
export async function takeIpAction(env, ip, action) {
  const key = `ip:${ip}:${action}`;
  const now = Date.now();
  for (const [count, windowMs] of IP_LIMITS[action]) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND created_at > ?").bind(key, now - windowMs).first();
    if (row.n >= count) return error("Слишком много запросов. Подождите минуту.", 429, { "Retry-After": String(Math.ceil(windowMs / 1000)) });
  }
  const statements = [env.DB.prepare("INSERT INTO rate_events (key, created_at) VALUES (?, ?)").bind(key, now)];
  if (Math.random() < 0.01) statements.push(env.DB.prepare("DELETE FROM rate_events WHERE created_at < ?").bind(now - LONGEST));
  await env.DB.batch(statements);
  return null;
}

const LONGEST = 24 * HOUR;

/**
 * Проверить и сразу учесть действие. Возвращает ответ 429 или null.
 * Учёт до самого действия: параллельные запросы не проскочат лимит
 */
export async function takeAction(env, userId, action) {
  const rules = ACTION_LIMITS[action];
  if (!rules) throw new Error(`Нет лимита для действия ${action}`);
  const key = `u${userId}:${action}`;
  const now = Date.now();
  for (const [count, windowMs] of rules) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND created_at > ?").bind(key, now - windowMs).first();
    if (row.n >= count) {
      const seconds = Math.ceil(windowMs / 1000);
      return error("Слишком часто. Подождите немного и попробуйте снова.", 429, { "Retry-After": String(seconds) });
    }
  }
  const statements = [env.DB.prepare("INSERT INTO rate_events (key, created_at) VALUES (?, ?)").bind(key, now)];
  if (Math.random() < 0.02) statements.push(env.DB.prepare("DELETE FROM rate_events WHERE created_at < ?").bind(now - LONGEST));
  await env.DB.batch(statements);
  return null;
}

// Простая защита от спама в тексте: ссылки и повторы символов. Модерация всё равно возможна через жалобы
const LINK = /https?:\/\/|www\./gi;
const MAX_LINKS = 3;

/** Проблема с текстом от пользователя или null. Текст уже очищен (cleanText) */
export function spamProblem(text) {
  if ((text.match(LINK) || []).length > MAX_LINKS) return `Не больше ${MAX_LINKS} ссылок в одном сообщении.`;
  if (/(.)\1{29,}/u.test(text)) return "Слишком много повторяющихся символов.";
  return null;
}

/** Повторил ли пользователь только что то же самое сообщение (двойная отправка или спам одним текстом) */
export async function isDuplicate(env, userId, body) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM comments WHERE user_id = ? AND body = ? AND created_at > datetime('now', '-10 minutes') LIMIT 1"
  ).bind(userId, body).first();
  return Boolean(row);
}
