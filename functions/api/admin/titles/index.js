// /api/admin/titles — список тайтлов для админки (без кеша) и создание тайтла

import { deletePages, parseSources, parseTitle, requireAdmin, TITLE_COLUMNS, titleValues } from "../../../_lib/admin.js";
import { audit, titleLabel } from "../../../_lib/audit.js";
import { error, json, readJson } from "../../../_lib/http.js";
import { parseTags, replaceTagsStatements, syncTaxonomyStatements } from "../../../_lib/taxonomy.js";
import { getTitle, listTitles } from "../../../_lib/titles.js";
import { replaceSourcesStatements, knownTagCodes } from "../../../_lib/titleExtras.js";

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  return json({ titles: await listTitles(env, "id") });
}

export async function onRequestPost({ request, env }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;

  const body = await readJson(request, 30_000);
  if (!body) return error("Некорректный запрос.");
  const { title, problem } = parseTitle(body);
  if (problem) return error(problem);
  const tags = parseTags(body.tags, await knownTagCodes(env));
  if (tags.problem) return error(tags.problem);
  const sources = parseSources(body.sources);
  if (sources.problem) return error(sources.problem);

  const row = await env.DB.prepare(
    `INSERT INTO titles (${TITLE_COLUMNS.join(", ")}, updated_at, created_at)
     VALUES (${TITLE_COLUMNS.map(() => "?").join(", ")}, datetime('now'), datetime('now')) RETURNING id`
  ).bind(...titleValues(title)).first();

  await env.DB.batch([
    ...syncTaxonomyStatements(env, row.id, title),
    ...(tags.tags ? replaceTagsStatements(env, row.id, tags.tags) : []),
    ...(sources.sources ? replaceSourcesStatements(env, row.id, sources.sources) : [])
  ]);

  // id освобождается после удаления последнего тайтла: файлы прежнего тайтла с этим id не должны попасть в новый
  await deletePages(env.PAGES, `${row.id}/`);
  await deletePages(env.PAGES, `covers/${row.id}/`);
  const saved = await getTitle(env, row.id);
  await audit(env, user, "title.create", titleLabel(saved));
  return json({ title: saved }, 201);
}
