// Общие правила для всех /api/*: защита от CSRF, проверка базы и ответ при ошибке сервера

import { error } from "../_lib/http.js";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
// Серверные callback-и внешних систем: вызываются не из браузера и без Origin нашего сайта
const CSRF_EXEMPT_PATHS = new Set(["/api/robokassa/result"]);

export async function onRequest(context) {
  const { request, env } = context;

  // Изменяющие запросы принимаем только со своего сайта. Браузер всегда отправляет Origin для POST, PUT и DELETE
  const path = new URL(request.url).pathname;
  if (!SAFE_METHODS.includes(request.method) && !CSRF_EXEMPT_PATHS.has(path)) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return error("Запрос отклонён.", 403);
    }
  }

  if (!env.DB) return error("База данных не подключена. Проверьте привязку D1 с именем DB.", 500);

  try {
    return await context.next();
  } catch (err) {
    // Источник каталога не ответил, а копии в кеше нет: понятное сообщение вместо «ошибки сервера»
    if (err?.name === "CatalogError") return error(err.message, err.status, { "Retry-After": "60" });
    console.error(err);
    return error("Ошибка сервера. Попробуйте позже.", 500);
  }
}
