// Каталог манги, манхвы и маньхуа в D1

// Число глав и дата последней главы считаются по таблице chapters. Главы идут подряд с 1
// (это проверяют триггеры в migrations/0007_chapters.sql), поэтому номер последней главы равен их числу.
// У тайтла без глав датой обновления считается дата изменения карточки
const SELECT = `SELECT t.id, t.title, t.type, t.year, t.status, COALESCE(c.chapters, 0) AS chapters, t.rating, t.genres,
  t.author, t.translator, t.symbol, t.poster, t.description, t.cover_version, COALESCE(c.released_at, t.updated_at) AS updated_at
FROM titles t
LEFT JOIN (SELECT title_id, MAX(number) AS chapters, MAX(released_at) AS released_at FROM chapters GROUP BY title_id) c
  ON c.title_id = t.id`;

// Порядок сортировки выбирается из списка: в SQL не подставляется ничего, что пришло от пользователя
const ORDERS = {
  rating: "t.rating DESC",
  updated: "updated_at DESC",
  id: "t.id"
};

export const TYPES = {
  manga: { label: "Манга", country: "Япония", format: "Чёрно-белая, читается справа налево" },
  manhwa: { label: "Манхва", country: "Корея", format: "Цветной вебтун: вертикальная лента" },
  manhua: { label: "Маньхуа", country: "Китай", format: "Цветная, чаще вертикальная лента" }
};

export function toTitle(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    year: row.year,
    status: row.status,
    chapters: row.chapters,
    rating: row.rating,
    genres: JSON.parse(row.genres),
    author: row.author,
    translator: row.translator,
    symbol: row.symbol,
    poster: row.poster,
    // Адрес загруженной обложки или null. Версия в адресе меняется при замене, поэтому кеш не мешает
    cover: row.cover_version ? `/covers/${row.id}?v=${row.cover_version}` : null,
    coverVersion: row.cover_version,
    description: row.description,
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

/** Строка search_text тайтла: по ней ищет /api/titles. Обновляется при каждом сохранении тайтла в админке */
export function searchText(title) {
  return normalizeSearch([title.title, title.author, title.translator, TYPES[title.type].label, ...title.genres].join(" "));
}

export const PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
// Вкладка «Популярное»
export const POPULAR_RATING = 8.8;
// Слов в запросе, по которым ищем: длинный запрос не должен превращаться в десятки условий
const MAX_WORDS = 8;

// Условие для полки пользователя. Ключ проверяет API, в SQL не подставляется ничего от пользователя
const SHELVES = {
  favorites: "l.favorite = 1",
  reading: "l.status = 'reading'",
  library: "1 = 1"
};

/**
 * Поиск по каталогу. Каждое слово запроса должно встретиться в названии, авторе, переводе, типе или жанрах.
 * shelf: { userId, kind } — только тайтлы с полки пользователя. Возвращает одну страницу и общее число найденных
 */
export async function searchTitles(env, {
  query = "", type = null, genre = null, release = null, popular = false, shelf = null,
  order = "rating", limit = PAGE_SIZE, offset = 0
} = {}) {
  const where = [];
  const binds = [];
  for (const word of normalizeSearch(query).split(" ").filter(Boolean).slice(0, MAX_WORDS)) {
    // % и _ в запросе ищутся как обычные символы
    where.push("t.search_text LIKE ? ESCAPE '\\'");
    binds.push(`%${word.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (type) {
    where.push("t.type = ?");
    binds.push(type);
  }
  if (genre) {
    where.push("EXISTS (SELECT 1 FROM json_each(t.genres) g WHERE g.value = ?)");
    binds.push(genre);
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

  const filter = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  // t.id в конце сортировки: у тайтлов с одинаковым рейтингом порядок не меняется между страницами
  const [page, count] = await env.DB.batch([
    env.DB.prepare(`${SELECT}${filter} ORDER BY ${ORDERS[order] || ORDERS.rating}, t.id LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM titles t${filter}`).bind(...binds)
  ]);
  return { titles: page.results.map(toTitle), total: count.results[0].n };
}

/** Число тайтлов каждого типа и жанры тайтлов выбранного типа (type = null — всех типов): для фильтров на главной */
export async function catalogFacets(env, type = null) {
  const [types, genres] = await env.DB.batch([
    env.DB.prepare("SELECT type, COUNT(*) AS n FROM titles GROUP BY type"),
    env.DB.prepare("SELECT DISTINCT g.value AS genre FROM titles t, json_each(t.genres) g WHERE ? IS NULL OR t.type = ?").bind(type, type)
  ]);
  const typeCounts = Object.fromEntries(Object.keys(TYPES).map((name) => [name, 0]));
  for (const row of types.results) typeCounts[row.type] = row.n;
  return { typeCounts, genres: genres.results.map((row) => row.genre).sort((a, b) => a.localeCompare(b, "ru")) };
}

export async function listTitles(env, order = "rating") {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY ${ORDERS[order] || ORDERS.rating}`).all();
  return results.map(toTitle);
}

export async function getTitle(env, id) {
  const row = await env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first();
  return row ? toTitle(row) : null;
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

/** «2026-05-12 10:00:00» из D1 → «12 мая 2026 г.» */
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
