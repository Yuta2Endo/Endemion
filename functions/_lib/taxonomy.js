// Справочники: жанры, авторы, теги. У тайтла жанры и авторы хранятся в таблицах связей (title_genres, title_authors),
// а столбцы titles.genres и titles.author — их копия для карточек и поиска. Обе стороны меняет только этот файл

/** Запросы, которые приводят связи тайтла к списку жанров и авторов. Новые жанры и авторы создаются */
export function syncTaxonomyStatements(env, titleId, { genres, author }) {
  const authors = splitAuthors(author);
  return [
    ...genres.map((name) => env.DB.prepare("INSERT OR IGNORE INTO genres (name) VALUES (?)").bind(name)),
    env.DB.prepare("DELETE FROM title_genres WHERE title_id = ?").bind(titleId),
    ...genres.map((name, position) =>
      env.DB.prepare("INSERT INTO title_genres (title_id, genre_id, position) SELECT ?, id, ? FROM genres WHERE name = ?")
        .bind(titleId, position, name)),
    ...authors.map((name) => env.DB.prepare("INSERT OR IGNORE INTO authors (name) VALUES (?)").bind(name)),
    env.DB.prepare("DELETE FROM title_authors WHERE title_id = ?").bind(titleId),
    ...authors.map((name, position) =>
      env.DB.prepare("INSERT INTO title_authors (title_id, author_id, position) SELECT ?, id, ? FROM authors WHERE name = ?")
        .bind(titleId, position, name))
  ];
}

/** «Чхугон, DUBU» → два автора. Пустые части и повторы отбрасываются */
export function splitAuthors(value) {
  return [...new Set(String(value).split(/[,;]/).map((part) => part.trim()).filter(Boolean))].slice(0, 6);
}

export async function listGenres(env) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.description, COUNT(tg.title_id) AS titles
     FROM genres g LEFT JOIN title_genres tg ON tg.genre_id = g.id GROUP BY g.id ORDER BY g.name`
  ).all();
  return results.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function listAuthors(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.name, a.bio, COUNT(ta.title_id) AS titles
     FROM authors a LEFT JOIN title_authors ta ON ta.author_id = a.id GROUP BY a.id ORDER BY a.name`
  ).all();
  return results.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export const TAG_CATEGORIES = {
  mood: "Атмосфера",
  hero: "Главный герой",
  plot: "Сюжет",
  theme: "Темы",
  setting: "Мир"
};

export async function listTags(env) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.code, t.category, t.name, COUNT(tt.title_id) AS titles
     FROM tags t LEFT JOIN title_tags tt ON tt.tag_id = t.id GROUP BY t.id ORDER BY t.category, t.id`
  ).all();
  return results;
}

/** Теги тайтла: { code, category, name, weight } */
export async function titleTags(env, titleId) {
  const { results } = await env.DB.prepare(
    `SELECT t.code, t.category, t.name, tt.weight FROM title_tags tt JOIN tags t ON t.id = tt.tag_id
     WHERE tt.title_id = ? ORDER BY tt.weight DESC, t.category, t.id`
  ).bind(titleId).all();
  return results;
}

/** Заменить теги тайтла. tags — [{ code, weight }], неизвестные коды отклоняются заранее (parseTags) */
export function replaceTagsStatements(env, titleId, tags) {
  return [
    env.DB.prepare("DELETE FROM title_tags WHERE title_id = ?").bind(titleId),
    ...tags.map(({ code, weight }) =>
      env.DB.prepare("INSERT INTO title_tags (title_id, tag_id, weight) SELECT ?, id, ? FROM tags WHERE code = ?").bind(titleId, weight, code))
  ];
}

/** Теги из формы: массив { code, weight } без повторов, вес 1–3 */
export function parseTags(value, knownCodes) {
  if (value === undefined) return { tags: null };
  if (!Array.isArray(value) || value.length > 30) return { problem: "Теги: не больше 30." };
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const code = typeof item === "string" ? item : item?.code;
    const weight = typeof item === "string" ? 2 : item?.weight ?? 2;
    if (typeof code !== "string" || !knownCodes.has(code)) return { problem: `Неизвестный тег: ${String(code).slice(0, 40)}.` };
    if (!Number.isInteger(weight) || weight < 1 || weight > 3) return { problem: "Вес тега: от 1 до 3." };
    if (seen.has(code)) continue;
    seen.add(code);
    tags.push({ code, weight });
  }
  return { tags };
}
