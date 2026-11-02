// Каталог манги, манхвы и маньхуа

// Число глав и дата последней главы считаются по таблице chapters. Главы идут подряд с 1
// (это проверяют триггеры в migrations/0007_chapters.sql), поэтому номер последней главы равен их числу.
// У тайтла без глав датой обновления считается дата изменения карточки.
// Оценка читателей — только по отзывам (reviews), скрытые модератором не считаются. rating — оценка редакции из карточки.
// Популярность: сколько человек добавили тайтл в библиотеку и в избранное, сколько оценили и сколько раз открывали страницу
const SELECT = `SELECT t.id, t.title, t.original_title, t.type, t.year, t.status, COALESCE(c.chapters, 0) AS chapters, t.rating,
  t.genres, t.author, t.translator, t.symbol, t.poster, t.description, t.cover_version, t.created_at, t.release_day, t.views,
  COALESCE(c.released_at, t.updated_at) AS updated_at,
  r.reader_sum, COALESCE(r.reader_votes, 0) AS reader_votes,
  COALESCE(l.readers, 0) AS readers, COALESCE(l.favorites, 0) AS favorites,
  (COALESCE(l.readers, 0) * 3 + COALESCE(l.favorites, 0) * 2 + COALESCE(r.reader_votes, 0) * 2 + t.views * 0.2) AS popularity
FROM titles t
LEFT JOIN (SELECT title_id, MAX(number) AS chapters, MAX(released_at) AS released_at FROM chapters GROUP BY title_id) c
  ON c.title_id = t.id
LEFT JOIN (SELECT title_id, SUM(score) AS reader_sum, COUNT(*) AS reader_votes FROM reviews WHERE hidden_at IS NULL GROUP BY title_id) r
  ON r.title_id = t.id
LEFT JOIN (SELECT title_id, COUNT(*) AS readers, SUM(favorite) AS favorites FROM library GROUP BY title_id) l
  ON l.title_id = t.id`;

// Байесовская оценка читателей: пока оценок мало, она тянется к средней 7 из 10.
// Так тайтл с одной десяткой не обгоняет тайтл с сотней девяток
export const BAYES_PRIOR = 7;
export const BAYES_WEIGHT = 5;
const READER_SCORE = `(COALESCE(r.reader_sum, 0) + ${BAYES_PRIOR * BAYES_WEIGHT}.0) / (COALESCE(r.reader_votes, 0) + ${BAYES_WEIGHT})`;

// Порядок сортировки выбирается из списка: в SQL не подставляется ничего, что пришло от пользователя
const ORDERS = {
  popular: "popularity DESC, t.rating DESC",
  rating: "t.rating DESC",
  readers: `${READER_SCORE} DESC, reader_votes DESC`,
  new: "t.created_at DESC",
  updated: "updated_at DESC",
  year: "t.year DESC",
  title: "t.title",
  id: "t.id"
};
export const SORTS = Object.keys(ORDERS);

export const TYPES = {
  manga: { label: "Манга", country: "Япония", format: "Чёрно-белая, читается справа налево" },
  manhwa: { label: "Манхва", country: "Корея", format: "Цветной вебтун: вертикальная лента" },
  manhua: { label: "Маньхуа", country: "Китай", format: "Цветная, чаще вертикальная лента" }
};

export const RELEASE_STATUSES = { ongoing: "Выходит", completed: "Завершён" };

export function toTitle(row) {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title || "",
    type: row.type,
    year: row.year,
    status: row.status,
    chapters: row.chapters,
    // Оценка редакции из карточки тайтла
    rating: row.rating,
    // Средняя оценка читателей (null — оценок нет) и их число
    readerRating: row.reader_votes ? Math.round((row.reader_sum / row.reader_votes) * 10) / 10 : null,
    readerVotes: row.reader_votes,
    readers: row.readers,
    favorites: row.favorites,
    views: row.views,
    // Сводная популярность: библиотеки, избранное, оценки и просмотры (формула в SELECT)
    popularity: Math.round(row.popularity * 10) / 10,
    genres: JSON.parse(row.genres),
    author: row.author,
    translator: row.translator,
    symbol: row.symbol,
    poster: row.poster,
    // Адрес загруженной обложки или null. Версия в адресе меняется при замене, поэтому кеш не мешает
    cover: row.cover_version ? `/covers/${row.id}?v=${row.cover_version}` : null,
    coverVersion: row.cover_version,
    description: row.description,
    releaseDay: row.release_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Фон обложки для CSS: картинка поверх градиента или только градиент. Такая же функция есть в public/assets/app.js */
export function posterBackground(title) {
  return title.cover ? `url("${title.cover}") center / cover no-repeat, ${title.poster}` : title.poster;
}

/** Текст для поиска: нижний регистр, «ё» как «е», одиночные пробелы. Такие же правила у запроса и у search_text */
export function normalizeSearch(value) {
  return String(value).toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

/** Строка search_text тайтла: по ней ищет /api/titles. Обновляется при каждом сохранении тайтла */
export function searchText(title) {
  return normalizeSearch(
    [title.title, title.originalTitle || "", title.author, title.translator, TYPES[title.type].label, ...title.genres].join(" ")
  );
}

/** Строки для поиска только по названию, автору или жанру */
export function searchColumns(title) {
  return {
    search_text: searchText(title),
    search_title: normalizeSearch(`${title.title} ${title.originalTitle || ""}`),
    search_author: normalizeSearch(title.author),
    search_genres: normalizeSearch(title.genres.join(" | "))
  };
}

/** Пересчитать строки поиска у тайтлов, где их ещё нет: например, у тайтлов, добавленных до миграции 0016 */
export async function backfillSearch(env) {
  const { results } = await env.DB.prepare(`${SELECT} WHERE t.search_title = ''`).all();
  if (!results.length) return 0;
  await env.DB.batch(results.map(toTitle).map((title) => {
    const columns = searchColumns(title);
    return env.DB.prepare("UPDATE titles SET search_text = ?, search_title = ?, search_author = ?, search_genres = ? WHERE id = ?")
      .bind(columns.search_text, columns.search_title, columns.search_author, columns.search_genres, title.id);
  }));
  return results.length;
}

export const PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
// Вкладка «Популярное» прежней главной
export const POPULAR_RATING = 8.8;
// Слов в запросе, по которым ищем: длинный запрос не должен превращаться в десятки условий
const MAX_WORDS = 8;

// Где искать слова запроса. Ключ проверяет API, в SQL не подставляется ничего от пользователя
export const SEARCH_FIELDS = {
  all: "t.search_text",
  title: "t.search_title",
  author: "t.search_author",
  genre: "t.search_genres"
};

// Условие для полки пользователя
const SHELVES = {
  favorites: "l.favorite = 1",
  reading: "l.status = 'reading'",
  planned: "l.status = 'planned'",
  completed: "l.status = 'completed'",
  on_hold: "l.status = 'on_hold'",
  dropped: "l.status = 'dropped'",
  library: "1 = 1"
};
export const SHELF_KINDS = Object.keys(SHELVES);

/** Условие LIKE для слова: % и _ ищутся как обычные символы */
function likeWord(word) {
  return `%${word.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Поиск по каталогу. Каждое слово запроса должно встретиться в выбранном поле (field).
 * shelf: { userId, kind } — только тайтлы с полки пользователя. Возвращает одну страницу и общее число найденных
 */
export async function searchTitles(env, {
  query = "", field = "all", type = null, genre = null, tag = null, release = null, popular = false, shelf = null,
  excludeIds = [], order = "rating", limit = PAGE_SIZE, offset = 0
} = {}) {
  const where = [];
  const binds = [];
  const column = SEARCH_FIELDS[field] || SEARCH_FIELDS.all;
  for (const word of normalizeSearch(query).split(" ").filter(Boolean).slice(0, MAX_WORDS)) {
    where.push(`${column} LIKE ? ESCAPE '\\'`);
    binds.push(likeWord(word));
  }
  if (type) {
    where.push("t.type = ?");
    binds.push(type);
  }
  if (genre) {
    where.push("EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.title_id = t.id AND g.name = ?)");
    binds.push(genre);
  }
  if (tag) {
    where.push("EXISTS (SELECT 1 FROM title_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.title_id = t.id AND tg.code = ?)");
    binds.push(tag);
  }
  if (release) {
    where.push("t.status = ?");
    binds.push(release);
  }
  if (popular) {
    where.push("t.rating >= ?");
    binds.push(POPULAR_RATING);
  }
  if (shelf) {
    where.push(`EXISTS (SELECT 1 FROM library l WHERE l.title_id = t.id AND l.user_id = ? AND ${SHELVES[shelf.kind]})`);
    binds.push(shelf.userId);
  }
  const exclude = excludeIds.filter((id) => Number.isInteger(id)).slice(0, 200);
  if (exclude.length) {
    where.push(`t.id NOT IN (${exclude.map(() => "?").join(", ")})`);
    binds.push(...exclude);
  }

  const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  // t.id в конце сортировки: у тайтлов с одинаковым значением порядок не меняется между страницами
  const [page, count] = await env.DB.batch([
    env.DB.prepare(`${SELECT}${filter} ORDER BY ${ORDERS[order] || ORDERS.rating}, t.id LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM titles t${filter}`).bind(...binds)
  ]);
  return { titles: page.results.map(toTitle), total: count.results[0].n };
}

/** Число тайтлов каждого типа и жанры тайтлов выбранного типа (type = null — всех типов): для фильтров */
export async function catalogFacets(env, type = null) {
  const [types, genres, statuses] = await env.DB.batch([
    env.DB.prepare("SELECT type, COUNT(*) AS n FROM titles GROUP BY type"),
    env.DB.prepare(
      `SELECT g.name AS genre, COUNT(*) AS n FROM genres g JOIN title_genres tg ON tg.genre_id = g.id JOIN titles t ON t.id = tg.title_id
       WHERE ? IS NULL OR t.type = ? GROUP BY g.id`
    ).bind(type, type),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM titles WHERE ? IS NULL OR type = ? GROUP BY status").bind(type, type)
  ]);
  const typeCounts = Object.fromEntries(Object.keys(TYPES).map((name) => [name, 0]));
  for (const row of types.results) typeCounts[row.type] = row.n;
  const statusCounts = Object.fromEntries(Object.keys(RELEASE_STATUSES).map((name) => [name, 0]));
  for (const row of statuses.results) statusCounts[row.status] = row.n;
  const sorted = genres.results.sort((a, b) => a.genre.localeCompare(b.genre, "ru"));
  return {
    typeCounts,
    statusCounts,
    genres: sorted.map((row) => row.genre),
    genreCounts: Object.fromEntries(sorted.map((row) => [row.genre, row.n]))
  };
}

export async function listTitles(env, order = "rating") {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY ${ORDERS[order] || ORDERS.rating}, t.id`).all();
  return results.map(toTitle);
}

export async function getTitle(env, id) {
  const row = await env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();
  return row ? toTitle(row) : null;
}

/** Несколько тайтлов по id в том же порядке. Неизвестные id пропускаются */
export async function getTitlesByIds(env, ids) {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id)).slice(0, 200);
  if (!unique.length) return [];
  const { results } = await env.DB.prepare(`${SELECT} WHERE t.id IN (${unique.map(() => "?").join(", ")})`).bind(...unique).all();
  const byId = new Map(results.map((row) => [row.id, toTitle(row)]));
  return unique.map((id) => byId.get(id)).filter(Boolean);
}

const CHAPTER_COLUMNS = "number, name, volume, side_story, released_at, pages, page_width, page_height, pages_version";

export function toChapter(row) {
  return {
    number: row.number,
    name: row.name,
    volume: row.volume,
    sideStory: row.side_story === 1,
    releasedAt: row.released_at,
    // null — страницы не загружены, показываются демо-рисунки
    pages: row.pages,
    pageWidth: row.page_width,
    pageHeight: row.page_height,
    // Номер опубликованной загрузки: входит в ключ R2 и в адрес картинки (?v=), чтобы браузер не показывал старые страницы
    pagesVersion: row.pages_version
  };
}

/** Главы тайтла, новые сверху */
export async function listChapters(env, titleId) {
  const { results } = await env.DB.prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE title_id = ? ORDER BY number DESC`)
    .bind(titleId)
    .all();
  return results.map(toChapter);
}

export async function getChapter(env, titleId, number) {
  const row = await env.DB.prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE title_id = ? AND number = ?`)
    .bind(titleId, number)
    .first();
  return row ? toChapter(row) : null;
}

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** «2026-05-12 10:00:00» из базы → «12 мая 2026 г.» */
export function formatDate(value) {
  return DATE_FORMAT.format(new Date(`${value.replace(" ", "T")}Z`));
}

/** id из адреса: только положительное целое число */
export function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 1 глава, 3 главы, 5 глав */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
