// POST /api/admin/titles/:id/chapters/:number/publish — опубликовать загруженный черновик страниц.
// Публикация проходит, только если в R2 есть все страницы 1..pages. После неё старые файлы удаляются

import { deleteOldPages, findChapter, MAX_PAGES, missingPage, requireAdmin } from "../../../../../../_lib/admin.js";
import { error, json, readJson } from "../../../../../../_lib/http.js";
import { getChapter } from "../../../../../../_lib/titles.js";

const MAX_SIDE = 20000;
const isSide = (value) => Number.isInteger(value) && value > 0 && value <= MAX_SIDE;

export async function onRequestPost({ request, env, params, waitUntil }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findChapter(env, params);
  if (found.response) return found.response;
  if (!env.PAGES) return error("Хранилище страниц R2 не подключено.", 500);

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { title, chapter } = found;

  const version = chapter.pagesVersion + 1;
  if (body.version !== version) return error("Страницы главы уже изменились. Загрузите их заново.", 409);
  if (!Number.isInteger(body.pages) || body.pages < 1 || body.pages > MAX_PAGES) return error(`В главе от 1 до ${MAX_PAGES} страниц.`);

  // Размер страниц необязателен: без него читалка возьмёт стандартный размер для типа тайтла
  const hasSize = body.width !== null && body.width !== undefined;
  if (hasSize && !(isSide(body.width) && isSide(body.height))) return error("Некорректный размер страниц.");

  const missing = await missingPage(env.PAGES, title.id, chapter.number, version, body.pages);
  if (missing) return error(`Страница ${missing} не загружена. Загрузите главу заново.`, 409);

  // Условие на версию: если черновик параллельно опубликовали из другой вкладки, второй раз публикация не пройдёт
  const result = await env.DB.prepare(
    `UPDATE chapters SET pages = ?, page_width = ?, page_height = ?, pages_version = ?
     WHERE title_id = ? AND number = ? AND pages_version = ?`
  ).bind(body.pages, hasSize ? body.width : null, hasSize ? body.height : null, version, title.id, chapter.number, chapter.pagesVersion).run();
  if (!result.meta.changes) return error("Страницы главы уже изменились. Загрузите их заново.", 409);

  // Старые версии читателям уже не нужны: страница отдаётся по версии из базы
  waitUntil(deleteOldPages(env.PAGES, title.id, chapter.number, version, body.pages));
  return json({ chapter: await getChapter(env, title.id, chapter.number) });
}
