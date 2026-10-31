// /api/admin/titles — список тайтлов для админки (без кеша) и создание тайтла

import { deletePages, parseTitle, requireAdmin, TITLE_COLUMNS, titleValues } from "../../../_lib/admin.js";
import { error, json, readJson } from "../../../_lib/http.js";
import { getTitle, listTitles } from "../../../_lib/titles.js";

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  return json({ titles: await listTitles(env, "id") });
}

export async function onRequestPost({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { title, problem } = parseTitle(body);
  if (problem) return error(problem);

  const row = await env.DB.prepare(
    `INSERT INTO titles (${TITLE_COLUMNS.join(", ")}, updated_at)
     VALUES (${TITLE_COLUMNS.map(() => "?").join(", ")}, datetime('now')) RETURNING id`
  ).bind(...titleValues(title)).first();

  // id освобождается после удаления последнего тайтла: файлы прежнего тайтла с этим id не должны попасть в новый
  await deletePages(env.PAGES, `${row.id}/`);
  return json({ title: await getTitle(env, row.id) }, 201);
}
