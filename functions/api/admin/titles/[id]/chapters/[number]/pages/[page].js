// PUT /api/admin/titles/:id/chapters/:number/pages/:page — загрузить одну страницу в черновик главы.
// Тело запроса — сам файл картинки. Черновик — следующая версия страниц: читатели увидят его только после публикации

import { findChapter, imageType, MAX_PAGE_BYTES, MAX_PAGES, requireAdmin } from "../../../../../../../_lib/admin.js";
import { error, json } from "../../../../../../../_lib/http.js";
import { pageKey } from "../../../../../../../_lib/pages.js";
import { parseId } from "../../../../../../../_lib/titles.js";

export async function onRequestPut({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findChapter(env, params);
  if (found.response) return found.response;

  const page = parseId(params.page);
  if (!page || page > MAX_PAGES) return error(`Номер страницы от 1 до ${MAX_PAGES}.`);
  if (!env.PAGES) return error("Хранилище страниц R2 не подключено.", 500);

  // Размер проверяется до чтения тела, чтобы не держать в памяти слишком большой файл
  const length = Number(request.headers.get("Content-Length"));
  if (!length || length > MAX_PAGE_BYTES) return error("Файл страницы должен быть не больше 15 МБ.", 413);
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PAGE_BYTES) return error("Файл страницы должен быть не больше 15 МБ.", 413);

  const type = imageType(buffer);
  if (!type) return error("Страница должна быть картинкой JPEG, PNG, WebP или AVIF.", 415);

  const version = found.chapter.pagesVersion + 1;
  await env.PAGES.put(pageKey(found.title.id, found.chapter.number, version, page), buffer, {
    httpMetadata: { contentType: type }
  });
  return json({ page, version });
}
