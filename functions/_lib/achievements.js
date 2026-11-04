// Достижения ENDEMION ID. Условие каждого достижения — SQL-запрос, который считает число по данным пользователя.
// Проверка идёт после действий, которые могут его дать (ответ, тема, подписка). Выданное не отбирается.
// Достижения прежних разделов (полка, оценки, Арена, подборки) остались в базе, но больше не выдаются и не показываются

import { notifyStatement } from "./notifications.js";

// code → [запрос, порог]. Запрос получает id пользователя и возвращает n
const RULES = {
  voice_10: ["SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND deleted_at IS NULL", 10],
  theorist: ["SELECT COUNT(*) AS n FROM threads WHERE user_id = ? AND kind = 'theory' AND deleted_at IS NULL", 1],
  followed_5: ["SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?", 5]
};

// Какие достижения проверять после какого действия
export const TRIGGERS = {
  comment: ["voice_10"],
  thread: ["theorist", "voice_10"],
  follow: ["followed_5"]
};

/** Выдать пользователю достижения, условия которых выполнены. Возвращает коды новых достижений */
export async function checkAchievements(env, userId, trigger) {
  const codes = TRIGGERS[trigger] || [];
  if (!codes.length) return [];
  const { results: earned } = await env.DB.prepare(
    `SELECT a.code FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
     WHERE ua.user_id = ? AND a.code IN (${codes.map(() => "?").join(", ")})`
  ).bind(userId, ...codes).all();
  const have = new Set(earned.map((row) => row.code));
  const fresh = [];
  for (const code of codes) {
    if (have.has(code)) continue;
    const [sql, threshold] = RULES[code];
    const row = await env.DB.prepare(sql).bind(userId).first();
    if (row && row.n >= threshold) fresh.push(code);
  }
  if (!fresh.length) return [];

  const { results: rows } = await env.DB.prepare(
    `SELECT id, code, name FROM achievements WHERE code IN (${fresh.map(() => "?").join(", ")})`
  ).bind(...fresh).all();
  await env.DB.batch(rows.flatMap((row) => [
    env.DB.prepare("INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)").bind(userId, row.id),
    notifyStatement(env, { userId, kind: "achievement", text: `Новое достижение: «${row.name}»`, link: "/profile#achievements" })
  ]));
  return fresh;
}

/** Все достижения с отметкой, получены ли они пользователем */
export async function listAchievements(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT a.code, a.name, a.description, a.icon, ua.earned_at FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
     WHERE a.code IN (${Object.keys(RULES).map(() => "?").join(", ")}) ORDER BY a.position`
  ).bind(userId, ...Object.keys(RULES)).all();
  return results.map((row) => ({ code: row.code, name: row.name, description: row.description, icon: row.icon, earnedAt: row.earned_at }));
}
