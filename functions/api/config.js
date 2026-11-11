// GET /api/config — публичные настройки для браузера. Секреты сюда не попадают

import { json } from "../_lib/http.js";
import { accountUrl, endemionIdEnabled } from "../_lib/endemionId.js";
import { adsPageId } from "../_lib/ads.js";
import { mailConfigured } from "../_lib/mail.js";
import { getSettings } from "../_lib/studio.js";

export async function onRequestGet({ env, request }) {
  const metrika = String(env.YANDEX_METRIKA_ID || "").trim();
  // Ссылки на соцсети для подвала: задаёт администратор, сервер пропускает только https
  let socialLinks = [];
  try {
    socialLinks = (await getSettings(env)).socialLinks;
  } catch {}
  return json(
    {
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      // Токен Cloudflare Web Analytics публичный: он всё равно виден в коде страницы
      webAnalyticsToken: env.WEB_ANALYTICS_TOKEN || "",
      // Номер счётчика Яндекс Метрики тоже публичный. Только цифры: он подставляется в адрес скрипта
      yandexMetrikaId: /^\d{5,12}$/.test(metrika) ? metrika : "",
      yandexAdsPageId: adsPageId(env),
      // Без отправки писем ссылка «Забыли пароль?» не показывается
      passwordReset: mailConfigured(env, request),
      // Вход через Endemion ID: адреса страницы аккаунта и игры для ссылок в интерфейсе
      socialLinks,
      endemionId: endemionIdEnabled(env) ? { account: accountUrl(env), life: env.ENDEMION_LIFE_URL || "https://life.endemion.online" } : null
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}
