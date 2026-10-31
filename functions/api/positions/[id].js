// /api/positions/:id — место в главе, на котором читатель остановился в тайтле. Одно место на тайтл:
// читалка записывает его при листании, страница тайтла по нему предлагает продолжить чтение

import { error, json, readJson } from "../../_lib/http.js";
import { chapterLayout } from "../../_lib/pages.js";
import { currentUser } from "../../_lib/session.js";
import { getChapter, getTitle, parseId } from "../../_lib/titles.js";

async function load(env, request, params) {
  const user = await currentUser(env, request);
  if (!user) return { response: error("Войдите в профиль.", 401) };
  const id = parseId(params.id);
  const title = id ? await getTitle(env, id) : null;
  if (!title) return { response: error("Тайтл не найден.", 404) };
  return { user, title };
}

export async function onRequestGet({ request, env, params }) {
  const { user, title, response } = await load(env, request, params);
  if (response) return response;
  const row = await env.DB.prepare("SELECT chapter, page, updated_at FROM positions WHERE user_id = ? AND title_id = ?")
    .bind(user.id, title.id)
    .first();
  return json({ position: row ? { chapter: row.chapter, page: row.page, updatedAt: row.updated_at } : null });
}

export async function onRequestPut({ request, env, params }) {
  const { user, title, response } = await load(env, request, params);
  if (response) return response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { chapter, page } = body;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > title.chapters) return error("Такой главы нет.");
  // Число страниц у главы с загруженными файлами и у главы с демо-страницами считается по-разному
  const { total } = chapterLayout(title, chapter, await getChapter(env, title.id, chapter));
  if (!Number.isInteger(page) || page < 1 || page > total) return error(`Страница должна быть от 1 до ${total}.`);

  await env.DB.prepare(
    `INSERT INTO positions (user_id, title_id, chapter, page, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id, title_id) DO UPDATE SET chapter = excluded.chapter, page = excluded.page, updated_at = excluded.updated_at`
  ).bind(user.id, title.id, chapter, page).run();

  return json({ position: { chapter, page } });
}

/** Глава дочитана: место в ней больше не нужно. Место в другой главе (например, после перечитывания старой) остаётся */
export async function onRequestDelete({ request, env, params }) {
  const { user, title, response } = await load(env, request, params);
  if (response) return response;

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.chapter)) return error("Некорректный запрос.");
  await env.DB.prepare("DELETE FROM positions WHERE user_id = ? AND title_id = ? AND chapter = ?")
    .bind(user.id, title.id, body.chapter)
    .run();
  return json({ ok: true });
}
