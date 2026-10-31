// GET /api/config — публичные настройки для браузера. Секреты сюда не попадают

import { json } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" }, 200, { "Cache-Control": "public, max-age=300" });
}
