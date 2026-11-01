// GET /api/config — публичные настройки для браузера. Секреты сюда не попадают

import { json } from "../_lib/http.js";
import { mailConfigured } from "../_lib/mail.js";

export async function onRequestGet({ env, request }) {
  const metrika = String(env.YANDEX_METRIKA_ID || "").trim();
  return json(
    {
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      // Токен Cloudflare Web Analytics публичный: он всё равно виден в коде страницы
      webAnalyticsToken: env.WEB_ANALYTICS_TOKEN || "",
      // Номер счётчика Яндекс Метрики тоже публичный. Только цифры: он подставляется в адрес скрипта
      yandexMetrikaId: /^\d{5,12}$/.test(metrika) ? metrika : "",
      // Без отправки писем ссылка «Забыли пароль?» не показывается
      passwordReset: mailConfigured(env, request)
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}
