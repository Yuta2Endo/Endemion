// Каталог манги, манхвы и маньхуа в D1

const COLUMNS = "id, title, type, year, status, chapters, rating, genres, author, translator, symbol, poster, description, updated_at";

// Порядок сортировки выбирается из списка: в SQL не подставляется ничего, что пришло от пользователя
const ORDERS = {
  rating: "rating DESC",
  updated: "updated_at DESC",
  id: "id"
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
    description: row.description,
    updatedAt: row.updated_at
  };
}

export async function listTitles(env, order = "rating") {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM titles ORDER BY ${ORDERS[order] || ORDERS.rating}`).all();
  return results.map(toTitle);
}

export async function getTitle(env, id) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM titles WHERE id = ?`).bind(id).first();
  return row ? toTitle(row) : null;
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
