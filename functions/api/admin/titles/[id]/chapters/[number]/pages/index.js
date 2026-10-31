// DELETE /api/admin/titles/:id/chapters/:number/pages — убрать загруженные страницы: глава снова показывает демо-рисунки

import { deletePages, findChapter, requireAdmin } from "../../../../../../../_lib/admin.js";
import { json } from "../../../../../../../_lib/http.js";
import { chapterPrefix } from "../../../../../../../_lib/pages.js";
import { getChapter } from "../../../../../../../_lib/titles.js";

export async function onRequestDelete({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findChapter(env, params);
  if (found.response) return found.response;

  const { title, chapter } = found;
  // Версия растёт, чтобы следующая загрузка не совпала с удалёнными файлами
  await env.DB.prepare(
    `UPDATE chapters SET pages = NULL, page_width = NULL, page_height = NULL, pages_version = pages_version + 1
     WHERE title_id = ? AND number = ?`
  ).bind(title.id, chapter.number).run();
  await deletePages(env.PAGES, chapterPrefix(title.id, chapter.number));

  return json({ chapter: await getChapter(env, title.id, chapter.number) });
}
