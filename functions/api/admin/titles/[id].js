// /api/admin/titles/:id — карточка тайтла для правки (с тегами, источниками, персонажами и связями), изменение и удаление.
// При удалении стираются его главы, записи библиотек и страницы в R2

import { deletePages, findTitle, parseSources, parseTitle, requireAdmin, TITLE_COLUMNS, titleValues } from "../../../_lib/admin.js";
import { audit, titleLabel } from "../../../_lib/audit.js";
import { error, json, readJson } from "../../../_lib/http.js";
import { parseTags, replaceTagsStatements, syncTaxonomyStatements, titleTags } from "../../../_lib/taxonomy.js";
import { knownTagCodes, listCharacters, listRelations, listSources, replaceSourcesStatements } from "../../../_lib/titleExtras.js";
import { getTitle } from "../../../_lib/titles.js";

export async function onRequestGet({ request, env, params }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;
  const id = found.title.id;
  const [tags, sources, characters, relations] = await Promise.all([
    titleTags(env, id), listSources(env, id), listCharacters(env, id), listRelations(env, id)
  ]);
  return json({ title: found.title, tags, sources, characters, relations });
}

export async function onRequestPut({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  const body = await readJson(request, 30_000);
  if (!body) return error("Некорректный запрос.");
  const { title, problem } = parseTitle(body);
  if (problem) return error(problem);
  const tags = parseTags(body.tags, await knownTagCodes(env));
  if (tags.problem) return error(tags.problem);
  const sources = parseSources(body.sources);
  if (sources.problem) return error(sources.problem);

  const id = found.title.id;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE titles SET ${TITLE_COLUMNS.map((name) => `${name} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...titleValues(title), id),
    ...syncTaxonomyStatements(env, id, title),
    // Теги и источники меняются, только если форма их прислала
    ...(tags.tags ? replaceTagsStatements(env, id, tags.tags) : []),
    ...(sources.sources ? replaceSourcesStatements(env, id, sources.sources) : [])
  ]);

  const saved = await getTitle(env, id);
  await audit(env, user, "title.update", titleLabel(saved));
  return json({ title: saved });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;
  const found = await findTitle(env, params);
  if (found.response) return found.response;

  // Главы, записи библиотек, отзывы и связи удаляются каскадом (ON DELETE CASCADE), комментарии — триггером
  await env.DB.prepare("DELETE FROM titles WHERE id = ?").bind(found.title.id).run();
  await deletePages(env.PAGES, `${found.title.id}/`);
  await deletePages(env.PAGES, `covers/${found.title.id}/`);
  await audit(env, user, "title.delete", titleLabel(found.title));
  return json({ ok: true });
}
