// GET /.well-known/jwks.json — публичные ключи портала для проверки утверждений Endemion Life.
// Приватный ключ здесь не появляется. Если интеграция выключена или ключ настроен неверно,
// отвечаем 503 и ничего не публикуем (fail closed).
//
// Маршрут зарегистрирован в src/worker.js, поэтому работает и в Worker, и в Node-сервере за Caddy:
// оба исполняют один и тот же src/worker.js.

import { getPublicJwks } from "./_lib/lifeAssertion.js";

export async function onRequestGet(context) {
  try {
    const jwks = await getPublicJwks(context.env);
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: {
        "Content-Type": "application/jwk-set+json; charset=utf-8",
        // Ключи ротируются редко; 5 минут совпадают с TTL кэша на стороне Life
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60"
      }
    });
  } catch {
    // Наружу — только общий ответ, без деталей конфигурации
    return new Response(JSON.stringify({ error: "JWKS недоступен." }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}
