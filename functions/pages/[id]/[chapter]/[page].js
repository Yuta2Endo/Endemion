// GET /pages/:id/:chapter/:page — картинка страницы главы. Загруженные страницы отдаются из R2,
// у глав без файлов рисуется демо-страница (SVG). Страницы не меняются, поэтому их можно долго кэшировать

import { notFound } from "../../../_lib/html.js";
import { chapterLayout, pageKey, renderPage } from "../../../_lib/pages.js";
import { getChapter, getTitle, parseId } from "../../../_lib/titles.js";

// Из R2 отдаются только картинки: другой тип файла браузер не должен открыть как страницу
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

const COMMON_HEADERS = {
  "Cache-Control": "public, max-age=86400",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  // В картинке нет скриптов и внешних ресурсов. Если файл открыть напрямую, браузер всё равно ничего не загрузит
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
};

export async function onRequestGet({ params, env, request }) {
  const id = parseId(params.id);
  const chapter = parseId(params.chapter);
  const page = parseId(params.page);
  const title = id && chapter && page && env.DB ? await getTitle(env, id) : null;
  if (!title || chapter > title.chapters) return notFound(env, request);

  const layout = chapterLayout(title, chapter, await getChapter(env, title.id, chapter));
  if (page > layout.total) return notFound(env, request);

  if (!layout.uploaded) {
    return new Response(renderPage(title, chapter, page), {
      headers: { ...COMMON_HEADERS, "Content-Type": "image/svg+xml; charset=utf-8" }
    });
  }

  const object = env.PAGES ? await env.PAGES.get(pageKey(title.id, chapter, layout.version, page)) : null;
  const type = object?.httpMetadata?.contentType;
  if (!object || !IMAGE_TYPES.has(type)) return notFound(env, request);

  return new Response(object.body, {
    headers: { ...COMMON_HEADERS, "Content-Type": type, "Content-Length": String(object.size), ETag: object.httpEtag }
  });
}
