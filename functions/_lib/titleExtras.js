// Дополнения к тайтлу: легальные источники, персонажи, связи с другими тайтлами

export const SOURCE_KINDS = { official: "Официально", publisher: "Издатель", store: "Магазин", licensed: "Лицензия" };
export const RELATION_KINDS = {
  similar: "Похожее",
  sequel: "Продолжение",
  prequel: "Предыстория",
  spin_off: "Спин-офф",
  same_universe: "Тот же мир"
};
export const CHARACTER_ROLES = { main: "Главный герой", supporting: "Второстепенный", antagonist: "Антагонист" };

export async function knownTagCodes(env) {
  const { results } = await env.DB.prepare("SELECT code FROM tags").all();
  return new Set(results.map((row) => row.code));
}

export async function listSources(env, titleId) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, url, kind, language FROM title_sources WHERE title_id = ? ORDER BY position, id"
  ).bind(titleId).all();
  return results;
}

export function replaceSourcesStatements(env, titleId, sources) {
  return [
    env.DB.prepare("DELETE FROM title_sources WHERE title_id = ?").bind(titleId),
    ...sources.map((source, position) =>
      env.DB.prepare("INSERT INTO title_sources (title_id, name, url, kind, position) VALUES (?, ?, ?, ?, ?)")
        .bind(titleId, source.name, source.url, source.kind, position))
  ];
}

export async function listCharacters(env, titleId) {
  const { results } = await env.DB.prepare(
    "SELECT id, title_id, name, role, description, symbol FROM characters WHERE title_id = ? ORDER BY CASE role WHEN 'main' THEN 0 WHEN 'antagonist' THEN 1 ELSE 2 END, id"
  ).bind(titleId).all();
  return results.map(toCharacter);
}

export function toCharacter(row) {
  return { id: row.id, titleId: row.title_id, name: row.name, role: row.role, description: row.description, symbol: row.symbol };
}

/** Связи тайтла в обе стороны: у продолжения обратная связь — предыстория */
export async function listRelations(env, titleId) {
  const { results } = await env.DB.prepare(
    `SELECT related_id AS id, kind FROM title_relations WHERE title_id = ?
     UNION ALL
     SELECT title_id AS id, CASE kind WHEN 'sequel' THEN 'prequel' WHEN 'prequel' THEN 'sequel' ELSE kind END AS kind
     FROM title_relations WHERE related_id = ?`
  ).bind(titleId, titleId).all();
  const seen = new Set();
  return results.filter((row) => (seen.has(row.id) ? false : seen.add(row.id)));
}
