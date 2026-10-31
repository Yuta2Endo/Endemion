// /api/admin/titles/:id — изменить или удалить тайтл. При удалении стираются его главы, записи библиотек и страницы в R2

import { deletePages, findTitle, parseTitle, requireAdmin, TITLE_COLUMNS, titleValues } from "../../../_lib/admin.js";
import { error, json, readJson } from "../../../_lib/http.js";
import { getTitle } from "../../../_lib/titles.js";

export async function onRequestPut({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const { title, problem } = parseTitle(body);
  if (problem) return error(problem);

  await env.DB.prepare(
    `UPDATE titles SET ${TITLE_COLUMNS.map((name) => `${name} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...titleValues(title), found.title.id).run();

  return json({ title: await getTitle(env, found.title.id) });
}

export async function onRequestDelete({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  // Главы и записи библиотек удаляются каскадом (ON DELETE CASCADE)
  await env.DB.prepare("DELETE FROM titles WHERE id = ?").bind(found.title.id).run();
  await deletePages(env.PAGES, `${found.title.id}/`);
  return json({ ok: true });
}
