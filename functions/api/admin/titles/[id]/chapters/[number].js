// /api/admin/titles/:id/chapters/:number — изменить главу или удалить последнюю главу вместе с её страницами

import { deletePages, findChapter, parseChapter, requireAdmin } from "../../../../../_lib/admin.js";
import { audit, titleLabel } from "../../../../../_lib/audit.js";
import { error, json, readJson } from "../../../../../_lib/http.js";
import { chapterPrefix } from "../../../../../_lib/pages.js";
import { getChapter } from "../../../../../_lib/titles.js";

export async function onRequestPut({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findChapter(env, params);
  if (found.response) return found.response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { chapter, problem } = parseChapter(body);
  if (problem) return error(problem);

  // Дата не передана — остаётся прежней
  await env.DB.prepare(
    `UPDATE chapters SET name = ?, volume = ?, side_story = ?, released_at = COALESCE(?, released_at)
     WHERE title_id = ? AND number = ?`
  ).bind(chapter.name, chapter.volume, chapter.sideStory, chapter.releasedAt, found.title.id, found.chapter.number).run();

  await audit(env, user, "chapter.update", `${titleLabel(found.title)}, глава ${found.chapter.number}`);
  return json({ chapter: await getChapter(env, found.title.id, found.chapter.number) });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findChapter(env, params);
  if (found.response) return found.response;

  const { title, chapter } = found;
  if (chapter.number !== title.chapters) return error("Удалять можно только последнюю главу.", 409);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM chapters WHERE title_id = ? AND number = ?").bind(title.id, chapter.number),
    // Прогресс читателей не может быть больше числа глав
    env.DB.prepare("UPDATE library SET chapter = ? WHERE title_id = ? AND chapter > ?").bind(chapter.number - 1, title.id, chapter.number - 1),
    // Место в удалённой главе: продолжать там нечего
    env.DB.prepare("DELETE FROM positions WHERE title_id = ? AND chapter >= ?").bind(title.id, chapter.number)
  ]);
  await deletePages(env.PAGES, chapterPrefix(title.id, chapter.number));
  await audit(env, user, "chapter.delete", `${titleLabel(title)}, глава ${chapter.number}`);
  return json({ ok: true });
}
