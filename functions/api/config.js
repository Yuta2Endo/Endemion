// GET /api/config — публичные настройки для браузера. Секреты сюда не попадают

import { json } from "../_lib/http.js";
import { mailConfigured } from "../_lib/mail.js";

export async function onRequestGet({ env, request }) {
  return json(
    {
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      // Без отправки писем ссылка «Забыли пароль?» не показывается
      passwordReset: mailConfigured(env, request)
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}
