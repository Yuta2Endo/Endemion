// Роли: user — читатель, moderator — разбирает жалобы и скрывает контент, admin — ещё каталог, пользователи и роли.
// Права проверяет сервер в каждом обработчике: интерфейсу сервер не доверяет

import { error } from "./http.js";
import { currentUser } from "./session.js";

export const ROLES = ["user", "moderator", "admin"];
const RANK = { user: 0, moderator: 1, admin: 2 };

export const ROLE_LABELS = { user: "Читатель", moderator: "Модератор", admin: "Администратор" };

/** true, если роль не ниже нужной */
export function hasRole(user, role) {
  return Boolean(user) && RANK[user.role] >= RANK[role];
}

/** Пользователь с ролью не ниже нужной или готовый ответ с ошибкой */
export async function requireRole(env, request, role) {
  const user = await currentUser(env, request);
  if (!user) return { response: error("Войдите в профиль.", 401) };
  if (!hasRole(user, role)) {
    return { response: error(role === "admin" ? "Нужны права администратора." : "Нужны права модератора.", 403) };
  }
  return { user };
}

/** Вошедший пользователь или ответ 401 */
export async function requireUser(env, request) {
  const user = await currentUser(env, request);
  return user ? { user } : { response: error("Войдите в профиль.", 401) };
}

/** Может ли пользователь писать в сообществе: не заглушён модератором */
export function mutedProblem(user) {
  if (user.mutedUntil && Date.parse(`${user.mutedUntil.replace(" ", "T")}Z`) > Date.now()) {
    return `Модератор ограничил публикации до ${user.mutedUntil.slice(0, 16)} UTC.`;
  }
  return null;
}
