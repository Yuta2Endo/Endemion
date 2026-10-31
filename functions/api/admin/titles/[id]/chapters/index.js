// /api/admin/titles/:id/chapters — главы тайтла со служебными полями и добавление следующей главы

import { deletePages, findTitle, parseChapter, requireAdmin } from "../../../../../_lib/admin.js";
import { error, json, readJson } from "../../../../../_lib/http.js";
import { chapterPrefix } from "../../../../../_lib/pages.js";
import { getChapter, listChapters } from "../../../../../_lib/titles.js";

export async function onRequestGet({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;
  return json({ chapters: await listChapters(env, found.title.id) });
}

export async function onRequestPost({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { chapter, problem } = parseChapter(body);
  if (problem) return error(problem);

  // Новая глава всегда следующая по номеру. Если последнюю главу удаляли, её старые файлы в R2 тоже стираются
  const number = found.title.chapters + 1;
  await deletePages(env.PAGES, chapterPrefix(found.title.id, number));
  try {
    await env.DB.prepare(
      `INSERT INTO chapters (title_id, number, name, volume, side_story, released_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    ).bind(found.title.id, number, chapter.name, chapter.volume, chapter.sideStory, chapter.releasedAt).run();
  } catch {
    // Триггер chapters_insert_in_order: главу с этим номером только что добавили из другой вкладки
    return error("Глава уже добавлена. Обновите страницу.", 409);
  }

  return json({ chapter: await getChapter(env, found.title.id, number) }, 201);
}
