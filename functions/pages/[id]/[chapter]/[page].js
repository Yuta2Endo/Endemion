// GET /pages/:id/:chapter/:page — картинка страницы главы (SVG). Страницы не меняются, поэтому их можно долго кэшировать

import { notFound } from "../../../_lib/html.js";
import { pageCount, renderPage } from "../../../_lib/pages.js";
import { getTitle, parseId } from "../../../_lib/titles.js";

export async function onRequestGet({ params, env, request }) {
  const id = parseId(params.id);
  const chapter = parseId(params.chapter);
  const page = parseId(params.page);
  const title = id && chapter && page && env.DB ? await getTitle(env, id) : null;
  if (!title || chapter > title.chapters || page > pageCount(title, chapter)) return notFound(env, request);

  return new Response(renderPage(title, chapter, page), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      // В SVG нет скриптов и внешних ресурсов. Если файл открыть напрямую, браузер всё равно ничего не загрузит
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    }
  });
}
