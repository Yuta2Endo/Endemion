// /api/admin/titles/:id/cover — загрузить обложку тайтла (тело запроса — файл картинки) или убрать её

import { deletePages, findTitle, imageType, MAX_COVER_BYTES, requireAdmin } from "../../../../_lib/admin.js";
import { error, json } from "../../../../_lib/http.js";
import { coverKey } from "../../../../_lib/pages.js";
import { getTitle } from "../../../../_lib/titles.js";

export async function onRequestPut({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;
  if (!env.PAGES) return error("Хранилище R2 не подключено.", 500);

  const length = Number(request.headers.get("Content-Length"));
  if (!length || length > MAX_COVER_BYTES) return error("Обложка должна быть не больше 5 МБ.", 413);
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) return error("Обложка должна быть не больше 5 МБ.", 413);
  const type = imageType(buffer);
  if (!type) return error("Обложка должна быть картинкой JPEG, PNG, WebP или AVIF.", 415);

  const { title } = found;
  const version = (title.coverVersion || 0) + 1;
  await env.PAGES.put(coverKey(title.id, version), buffer, { httpMetadata: { contentType: type } });

  // Условие на прежнюю версию: две загрузки из разных вкладок не перепутают файлы
  const result = await env.DB.prepare("UPDATE titles SET cover_version = ? WHERE id = ? AND cover_version IS ?")
    .bind(version, title.id, title.coverVersion)
    .run();
  if (!result.meta.changes) {
    await env.PAGES.delete(coverKey(title.id, version));
    return error("Обложку только что изменили. Обновите страницу.", 409);
  }
  if (title.coverVersion) await env.PAGES.delete(coverKey(title.id, title.coverVersion));

  return json({ title: await getTitle(env, title.id) });
}

export async function onRequestDelete({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  await env.DB.prepare("UPDATE titles SET cover_version = NULL WHERE id = ?").bind(found.title.id).run();
  await deletePages(env.PAGES, `covers/${found.title.id}/`);
  return json({ title: await getTitle(env, found.title.id) });
}
