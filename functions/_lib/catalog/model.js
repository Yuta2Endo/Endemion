// Модель каталога энциклопедии: виды произведений, типы, статусы, сезоны, адреса страниц.
// Не зависит от источника данных: провайдер (shikimori.js) приводит свои ответы к этим значениям

export const KINDS = ["anime", "manga"];
export const KIND_LABELS = { anime: "Аниме", manga: "Манга" };

export const ANIME_TYPES = {
  tv: "TV", movie: "Фильм", ova: "OVA", ona: "ONA", special: "Спешл", tv_special: "TV-спешл", music: "Клип", pv: "Проморолик", cm: "Реклама"
};
// Типы в фильтре каталога. Спешл объединяет special и tv_special
export const ANIME_TYPE_FILTERS = { tv: ["tv"], movie: ["movie"], ova: ["ova"], ona: ["ona"], special: ["special", "tv_special"] };
export const MANGA_TYPES = {
  manga: "Манга", manhwa: "Манхва", manhua: "Маньхуа", light_novel: "Ранобэ", novel: "Новелла", one_shot: "Ваншот", doujin: "Додзинси"
};
export const MANGA_TYPE_FILTERS = Object.fromEntries(Object.keys(MANGA_TYPES).map((key) => [key, [key]]));

export const STATUSES = {
  anime: { anons: "Анонс", ongoing: "Выходит", released: "Вышло" },
  manga: { anons: "Анонс", ongoing: "Выходит", released: "Издано", paused: "Приостановлено", discontinued: "Прекращено" }
};

export const AGE_RATINGS = { g: "G", pg: "PG", pg_13: "PG-13", r: "R-17", r_plus: "R+", rx: "Rx" };
// Взрослый рейтинг Rx в фильтре не предлагается
export const AGE_RATING_FILTERS = ["g", "pg", "pg_13", "r", "r_plus"];

export const ORDERS = { popularity: "По популярности", ranked: "По рейтингу", aired_on: "По дате выхода", name: "По названию" };

export const SEASONS = { winter: "Зима", spring: "Весна", summer: "Лето", fall: "Осень" };
const SEASON_ORDER = ["winter", "spring", "summer", "fall"];

// Статусы в списках пользователей. Ключи общие, подписи зависят от вида
export const LIST_STATUSES = {
  anime: { planned: "Планирую смотреть", current: "Смотрю", completed: "Просмотрено", on_hold: "Отложено", dropped: "Брошено" },
  manga: { planned: "Планирую читать", current: "Читаю", completed: "Прочитано", on_hold: "Отложено", dropped: "Брошено" }
};
export const LIST_STATUS_KEYS = Object.keys(LIST_STATUSES.anime);

export const SCORE_LABELS = {
  10: "Шедевр", 9: "Великолепно", 8: "Отлично", 7: "Хорошо", 6: "Неплохо", 5: "Средне", 4: "Слабо", 3: "Плохо", 2: "Ужасно", 1: "Хуже некуда"
};

export function typeLabel(kind, type) {
  return (kind === "anime" ? ANIME_TYPES : MANGA_TYPES)[type] || "";
}

export function statusLabel(kind, status) {
  return STATUSES[kind]?.[status] || "";
}

/** «12 эп.» или «141 гл.»; для выходящего — «5 из 12 эп.» */
export function unitsText(entry) {
  const unit = entry.kind === "anime" ? "эп." : "гл.";
  if (entry.kind === "anime" && entry.status === "ongoing" && entry.unitsAired) {
    return `${entry.unitsAired} из ${entry.units || "?"} ${unit}`;
  }
  return entry.units ? `${entry.units} ${unit}` : "";
}

// ==================== СЕЗОНЫ ====================

/** Сезон по дате: зима — январь–март, весна — апрель–июнь, лето — июль–сентябрь, осень — октябрь–декабрь */
export function currentSeason(date = new Date()) {
  return { season: SEASON_ORDER[Math.floor(date.getUTCMonth() / 3)], year: date.getUTCFullYear() };
}

export function seasonCode({ season, year }) {
  return `${season}_${year}`;
}

/** fall_2026 → { season: "fall", year: 2026 } или null */
export function parseSeasonCode(code) {
  const match = /^(winter|spring|summer|fall)_(\d{4})$/.exec(String(code || ""));
  if (!match) return null;
  const year = Number(match[2]);
  return year >= 1917 && year <= new Date().getUTCFullYear() + 3 ? { season: match[1], year } : null;
}

export function seasonLabel({ season, year }) {
  return `${SEASONS[season]} ${year}`;
}

/** Соседний сезон: step = -1 — предыдущий, 1 — следующий */
export function shiftSeason({ season, year }, step) {
  const index = SEASON_ORDER.indexOf(season) + step;
  const yearShift = Math.floor(index / 4);
  return { season: SEASON_ORDER[((index % 4) + 4) % 4], year: year + yearShift };
}

// ==================== АДРЕСА ====================

/** Часть адреса из латинского названия: shingeki-no-kyojin */
export function slugify(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Номер из части адреса «16498-shingeki-no-kyojin» или «16498». Иначе null */
export function parseSlugId(value) {
  const match = /^(\d{1,9})(?:-[a-z0-9-]*)?$/.exec(String(value || ""));
  if (!match) return null;
  const id = Number(match[1]);
  return id > 0 ? id : null;
}

const withSlug = (base, id, slug) => `${base}/${id}${slug ? `-${slug}` : ""}`;

export const entryPath = (entry) => withSlug(`/${entry.kind}`, entry.id, entry.slug);
export const characterPath = (character) => withSlug("/characters", character.id, character.slug);
export const personPath = (person) => withSlug("/people", person.id, person.slug);
export const studioPath = (studio) => withSlug("/studios", studio.id, studio.slug);
