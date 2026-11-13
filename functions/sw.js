// Service worker отдаётся не как статический файл, а через этот обработчик: версия кеша
// подставляется из ASSET_VERSION (functions/_lib/layout.js), поэтому после выкладки
// кеш обновляется сам и не нужно вручную менять VERSION в public/sw.js.

import { ASSET_VERSION } from "./_lib/layout.js";

const VERSION_LINE = /const VERSION = "[^"]*";/;

export async function onRequestGet({ request, env }) {
  const response = await env.ASSETS.fetch(new URL("/sw.js", request.url));
  if (!response.ok) return response;
  const text = await response.text();
  return new Response(text.replace(VERSION_LINE, `const VERSION = "${ASSET_VERSION}";`), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // Скрипт обновления должен проверяться при каждом открытии сайта
      "Cache-Control": "no-cache"
    }
  });
}
