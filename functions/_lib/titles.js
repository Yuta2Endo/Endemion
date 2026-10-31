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
