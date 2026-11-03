// API энциклопедии: каталог аниме и манги с фильтрами, поиск, персонажи, люди, студии, рейтинги,
// списки пользователей, избранное, отзывы, рекомендации и настройки каталога в админке.
// Данные каталога — только через functions/_lib/catalog, пользовательские данные — в базе Endemion.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { audit } from "../_lib/audit.js";
import {
  allGenres, clearCache, clearErrors, DEFAULT_SETTINGS, ensureSnapshot, getCharacter, getEntry, getGenres, getPerson, getSettings, isHidden,
  listCharacters, listEntries, listPeople, listStudios, popularCharacters, providerStatus, recommendations, saveSettings, searchAll
} from "../_lib/catalog/index.js";
import {
  adminEntryReviews, countFavorites, endemionScore, endemionTop, FAVORITE_TYPES, FAVORITES_LIMIT, getEntryReview, getListItem,
  isFavorite, LIST_SORTS, listChanges, listEntryReviews, listFavorites, listItems, listStats, recentEntryReviews, REVIEW_MAX, REVIEW_MIN
} from "../_lib/catalog/lists.js";
import {
  AGE_RATING_FILTERS, ANIME_TYPE_FILTERS, KINDS, LIST_STATUS_KEYS, MANGA_TYPE_FILTERS, ORDERS, parseSeasonCode, parseSlugId, STATUSES
} from "../_lib/catalog/model.js";
import { clientIp, error, json, readJson } from "../_lib/http.js";
import { spamProblem, takeAction, takeIpAction } from "../_lib/limits.js";
import { moderationStatement } from "../_lib/moderation.js";
import { canSeeProfile, profileByUsername } from "../_lib/profiles.js";
import { mutedProblem, requireRole, requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { cleanLine, cleanText, intParam, lengthProblem } from "../_lib/validate.js";

const PAGE_SIZE = 24;
const MAX_PAGE = 200;

// Списки каталога одинаковы для всех посетителей: браузер может держать ответ минуту
const PUBLIC_CACHE = { "Cache-Control": "public, max-age=60" };

const kindParam = (value) => (KINDS.includes(value) ? value : null);

function idParam(value) {
  return parseSlugId(value);
}

/** Вошедший пользователь, который может писать (не ограничен модератором), или ответ с ошибкой */
async function requireWriter(env, request) {
  const { user, response } = await requireUser(env, request);
  if (response) return { response };
  const muted = mutedProblem(user);
  return muted ? { response: error(muted, 403) } : { user };
}

/** Год «2024», диапазон «2010_2015» или сезон «fall_2024». Иначе null */
function seasonParam(value) {
  if (!value) return "";
  if (parseSeasonCode(value)) return value;
  const now = new Date().getUTCFullYear();
  const year = (text) => Number(text) >= 1917 && Number(text) <= now + 3;
  const single = /^(\d{4})$/.exec(value);
  if (single && year(single[1])) return value;
  const range = /^(\d{4})_(\d{4})$/.exec(value);
  if (range && year(range[1]) && year(range[2]) && Number(range[1]) <= Number(range[2])) return value;
  return null;
}

/** Номера через запятую: «1,4,22». Не больше max. Иначе null */
function idList(value, max = 10) {
  if (!value) return [];
  const ids = String(value).split(",").map(Number);
  return ids.length <= max && ids.every((id) => Number.isInteger(id) && id > 0 && id < 1e9) ? [...new Set(ids)] : null;
}

/** Фильтры каталога из адреса запроса или текст ошибки */
export function parseCatalogFilters(kind, search) {
  const page = intParam(search.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { problem: `Страница: от 1 до ${MAX_PAGE}.` };
  const order = search.get("order") || "popularity";
  if (!ORDERS[order]) return { problem: "Неизвестная сортировка." };
  const typeFilters = kind === "anime" ? ANIME_TYPE_FILTERS : MANGA_TYPE_FILTERS;
  const typeKeys = search.get("types") ? search.get("types").split(",") : [];
  if (typeKeys.length > 10 || typeKeys.some((key) => !typeFilters[key])) return { problem: "Неизвестный тип." };
  const status = search.get("status") || "";
  if (status && !STATUSES[kind][status]) return { problem: "Неизвестный статус." };
  const season = seasonParam(search.get("season"));
  if (season === null) return { problem: "Неверный сезон или год." };
  const genres = idList(search.get("genres"));
  if (genres === null) return { problem: "Неверный список жанров." };
  const score = intParam(search.get("score"), null, 1, 9);
  if (search.get("score") && score === null) return { problem: "Минимальная оценка: от 1 до 9." };
  const query = cleanLine(search.get("q") || "").slice(0, 100);
  const filters = {
    page, limit: PAGE_SIZE, order, types: typeKeys.flatMap((key) => typeFilters[key]), status, season, genres, score, search: query
  };
  if (kind === "anime") {
    const rating = search.get("rating") || "";
    if (rating && !AGE_RATING_FILTERS.includes(rating)) return { problem: "Неизвестный возрастной рейтинг." };
    const studio = intParam(search.get("studio"), null, 1, 1e9);
    if (search.get("studio") && studio === null) return { problem: "Неверная студия." };
    Object.assign(filters, { rating, studio });
  }
  return { filters };
}

// ==================== КАТАЛОГ ====================

/** GET /api/catalog/:kind — аниме, манга, персонажи, люди или студии с поиском и фильтрами */
export const catalogList = {
  async onRequestGet({ request, env, params }) {
    const limited = await takeIpAction(env, clientIp(request), "catalog");
    if (limited) return limited;
    const search = new URL(request.url).searchParams;
    const query = cleanLine(search.get("q") || "").slice(0, 100);

    if (params.kind === "characters" || params.kind === "people") {
      const page = intParam(search.get("page"), 1, 1, MAX_PAGE);
      if (page === null) return error("Неверная страница.");
      if (params.kind === "characters") {
        // Без поиска — главные герои популярных произведений
        if (!query) {
          const source = search.get("from") === "manga" ? "manga" : "anime";
          return json({ items: page === 1 ? await popularCharacters(env, source) : [], page, hasMore: false }, 200, PUBLIC_CACHE);
        }
        return json(await listCharacters(env, { search: query, page, limit: PAGE_SIZE }), 200, PUBLIC_CACHE);
      }
      const role = search.get("role") || "";
      if (role && !["seyu", "mangaka", "producer"].includes(role)) return error("Неизвестная роль.");
      return json(await listPeople(env, { search: query, role, page, limit: PAGE_SIZE }), 200, PUBLIC_CACHE);
    }

    if (params.kind === "studios") {
      const needle = query.toLowerCase();
      const all = await listStudios(env);
      const items = needle
        ? all.filter((studio) => studio.name.toLowerCase().includes(needle))
        : all.filter((studio) => studio.real || studio.image);
      items.sort((a, b) => Number(b.real) - Number(a.real) || a.name.localeCompare(b.name));
      return json({ items: items.slice(0, 300), total: items.length }, 200, PUBLIC_CACHE);
    }

    const kind = kindParam(params.kind);
    if (!kind) return error("Раздел не найден.", 404);
    const { filters, problem } = parseCatalogFilters(kind, search);
    if (problem) return error(problem);
    return json(await listEntries(env, kind, filters), 200, PUBLIC_CACHE);
  }
};

/** GET /api/catalog/:kind/genres — жанры для фильтров (без скрытых настройками каталога) */
export const catalogGenres = {
  async onRequestGet({ env, params }) {
    const kind = kindParam(params.kind);
    if (!kind) return error("Раздел не найден.", 404);
    return json({ genres: await getGenres(env, kind) }, 200, { "Cache-Control": "public, max-age=3600" });
  }
};

/** GET /api/search?q= — поиск сразу по аниме, манге, персонажам, людям и студиям */
export const search = {
  async onRequestGet({ request, env }) {
    const query = cleanLine(new URL(request.url).searchParams.get("q") || "").slice(0, 100);
    if ([...query].length < 2) return error("Введите хотя бы 2 символа.");
    const limited = await takeIpAction(env, clientIp(request), "search");
    if (limited) return limited;
    // Взрослое скрывает сам источник (censored), если оно не разрешено в настройках каталога
    return json({ query, ...(await searchAll(env, query)) }, 200, PUBLIC_CACHE);
  }
};

/** GET /api/rankings?kind=anime&source=world|endemion&page= — лучшие по оценке источника или пользователей Endemion */
export const rankings = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const kind = kindParam(search.get("kind") || "anime");
    if (!kind) return error("Неизвестный раздел.");
    const source = search.get("source") || "world";
    if (source === "endemion") return json({ items: await endemionTop(env, kind, 100), hasMore: false });
    if (source !== "world") return error("Неизвестный рейтинг.");
    const page = intParam(search.get("page"), 1, 1, 4);
    if (page === null) return error("Рейтинг — до 4 страниц.");
    const limited = await takeIpAction(env, clientIp(request), "catalog");
    if (limited) return limited;
    const result = await listEntries(env, kind, { page, limit: 50, order: "ranked" });
    return json({ items: result.items, page, hasMore: result.hasMore && page < 4 }, 200, PUBLIC_CACHE);
  }
};

/** GET /api/recommendations?kind=anime — подборка по списку и оценкам вошедшего пользователя */
export const recommendationList = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const kind = kindParam(new URL(request.url).searchParams.get("kind") || "anime");
    if (!kind) return error("Неизвестный раздел.");
    return json(await recommendations(env, user.id, kind));
  }
};

// ==================== СПИСКИ ====================

/** GET /api/mylist?kind=&status=&sort=&q=&offset= — свой список со статистикой */
export const myList = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const parsed = parseListQuery(new URL(request.url).searchParams);
    if (parsed.problem) return error(parsed.problem);
    const [page, stats] = await Promise.all([listItems(env, user.id, parsed.kind, parsed), listStats(env, user.id, parsed.kind)]);
    return json({ ...page, stats });
  }
};

function parseListQuery(search) {
  const kind = kindParam(search.get("kind") || "anime");
  if (!kind) return { problem: "Неизвестный раздел." };
  const status = search.get("status") || "";
  if (status && !LIST_STATUS_KEYS.includes(status)) return { problem: "Неизвестный статус." };
  const sort = search.get("sort") || "updated";
  if (!LIST_SORTS[sort]) return { problem: "Неизвестная сортировка." };
  const offset = intParam(search.get("offset"), 0, 0, 100_000);
  if (offset === null) return { problem: "Некорректный offset." };
  return { kind, status, sort, offset, q: cleanLine(search.get("q") || "").slice(0, 100) };
}

/** Снимок произведения для записи в список или избранное. null — нет такого или скрыто настройками */
async function visibleEntry(env, kind, id) {
  const entry = await ensureSnapshot(env, kind, id);
  if (!entry) return null;
  // У снимка нет возрастного рейтинга: скрытие проверяется по полной записи (она в кеше после ensureSnapshot)
  const full = await getEntry(env, kind, id).catch(() => null);
  return isHidden(full || entry, await getSettings(env)) ? null : entry;
}

/** /api/mylist/:kind/:id — своя запись: получить (GET), добавить или изменить (PUT), убрать из списка (DELETE) */
export const myListItem = {
  async onRequestGet({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    const [item, favorite] = await Promise.all([getListItem(env, user.id, kind, id), isFavorite(env, user.id, kind, id)]);
    return json({ item, favorite });
  },

  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    const limited = await takeAction(env, user.id, "list");
    if (limited) return limited;
    const entry = await visibleEntry(env, kind, id);
    if (!entry) return error("Произведение не найдено.", 404);
    const current = await getListItem(env, user.id, kind, id);
    const { values, problem } = listChanges(body, entry, current);
    if (problem) return error(problem);
    await env.DB.prepare(
      `INSERT INTO user_list (user_id, kind, ext_id, status, score, progress, note) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, kind, ext_id) DO UPDATE SET status = excluded.status, score = excluded.score,
         progress = excluded.progress, note = excluded.note, updated_at = datetime('now')`
    ).bind(user.id, kind, id, values.status, values.score, values.progress, values.note).run();
    return json({ item: await getListItem(env, user.id, kind, id) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    await env.DB.prepare("DELETE FROM user_list WHERE user_id = ? AND kind = ? AND ext_id = ?").bind(user.id, kind, id).run();
    return json({ ok: true, item: null });
  }
};

/** Профиль, который смотрящий может видеть вместе со списками, или ответ с ошибкой */
async function visibleLists(env, request, username) {
  const viewer = await currentUser(env, request);
  const row = await profileByUsername(env, username);
  if (!row) return { response: error("Профиль не найден.", 404) };
  const own = viewer?.id === row.id;
  if (!canSeeProfile(row, viewer) || (!own && row.show_library !== 1 && !viewer?.isModerator)) {
    return { response: error("Пользователь скрыл свои списки.", 403) };
  }
  return { row };
}

/** GET /api/users/:username/encyclopedia — статистика списков и избранное пользователя */
export const userEncyclopedia = {
  async onRequestGet({ request, env, params }) {
    const { row, response } = await visibleLists(env, request, params.username);
    if (response) return response;
    const [anime, manga, favorites] = await Promise.all([
      listStats(env, row.id, "anime"), listStats(env, row.id, "manga"), listFavorites(env, row.id)
    ]);
    return json({ stats: { anime, manga }, favorites });
  }
};

/** GET /api/users/:username/mylist?kind=&status=&sort=&offset= — список пользователя, если он его не скрыл */
export const userList = {
  async onRequestGet({ request, env, params }) {
    const { row, response } = await visibleLists(env, request, params.username);
    if (response) return response;
    const parsed = parseListQuery(new URL(request.url).searchParams);
    if (parsed.problem) return error(parsed.problem);
    const page = await listItems(env, row.id, parsed.kind, parsed);
    // Заметки — личные
    return json({ ...page, items: page.items.map((item) => ({ ...item, note: "" })) });
  }
};

// ==================== ИЗБРАННОЕ ====================

/** GET /api/favorites?type= — своё избранное */
export const favorites = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const type = new URL(request.url).searchParams.get("type") || "";
    if (type && !FAVORITE_TYPES.includes(type)) return error("Неизвестный тип.");
    return json({ items: await listFavorites(env, user.id, type) });
  }
};

/** Имя и картинка для избранного берутся из источника, а не от браузера */
async function favoriteTarget(env, type, id) {
  if (type === "anime" || type === "manga") {
    const entry = await visibleEntry(env, type, id);
    return entry ? { name: entry.title, image: entry.poster?.small || "" } : null;
  }
  const item = type === "character" ? await getCharacter(env, id) : await getPerson(env, id);
  return item ? { name: item.name, image: item.image?.small || "" } : null;
}

/** /api/favorites/:type/:id — добавить (PUT) или убрать (DELETE) */
export const favorite = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = idParam(params.id);
    if (!FAVORITE_TYPES.includes(params.type) || !id) return error("Не найдено.", 404);
    const limited = await takeAction(env, user.id, "favorite");
    if (limited) return limited;
    if ((await countFavorites(env, user.id)) >= FAVORITES_LIMIT) return error(`В избранном не больше ${FAVORITES_LIMIT} записей.`, 409);
    const target = await favoriteTarget(env, params.type, id);
    if (!target) return error("Не найдено.", 404);
    await env.DB.prepare(
      `INSERT INTO favorites (user_id, target_type, ext_id, name, image) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, target_type, ext_id) DO UPDATE SET name = excluded.name, image = excluded.image`
    ).bind(user.id, params.type, id, target.name.slice(0, 200), target.image).run();
    return json({ favorite: true });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = idParam(params.id);
    if (!FAVORITE_TYPES.includes(params.type) || !id) return error("Не найдено.", 404);
    await env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND target_type = ? AND ext_id = ?").bind(user.id, params.type, id).run();
    return json({ favorite: false });
  }
};

// ==================== ОТЗЫВЫ ====================

/** /api/catalog/:kind/:id/reviews — отзывы (GET), свой отзыв: написать или исправить (PUT), удалить (DELETE) */
export const entryReviews = {
  async onRequestGet({ request, env, params }) {
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    const offset = intParam(new URL(request.url).searchParams.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const viewer = await currentUser(env, request);
    const [list, score] = await Promise.all([listEntryReviews(env, viewer, kind, id, { offset }), endemionScore(env, kind, id)]);
    return json({ ...list, score });
  },

  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    const body = await readJson(request, 40_000);
    if (!body) return error("Некорректный запрос.");
    if (!Number.isInteger(body.score) || body.score < 1 || body.score > 10) return error("Оценка: целое число от 1 до 10.");
    if (typeof (body.spoiler ?? false) !== "boolean") return error("Некорректная пометка спойлера.");
    const text = cleanText(body.body);
    const problem = lengthProblem(text, "Отзыв", REVIEW_MIN, REVIEW_MAX) || spamProblem(text);
    if (problem) return error(problem);
    const limited = await takeAction(env, user.id, "entryReview");
    if (limited) return limited;
    const entry = await visibleEntry(env, kind, id);
    if (!entry) return error("Произведение не найдено.", 404);
    // Скрытый модератором отзыв автор может исправить, но виден он станет только после проверки
    await env.DB.prepare(
      `INSERT INTO entry_reviews (user_id, kind, ext_id, score, body, spoiler) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, kind, ext_id) DO UPDATE SET score = excluded.score, body = excluded.body, spoiler = excluded.spoiler,
         updated_at = datetime('now')`
    ).bind(user.id, kind, id, body.score, text, body.spoiler ? 1 : 0).run();
    const [list, score] = await Promise.all([listEntryReviews(env, user, kind, id), endemionScore(env, kind, id)]);
    return json({ review: list.mine, score });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const kind = kindParam(params.kind);
    const id = idParam(params.id);
    if (!kind || !id) return error("Не найдено.", 404);
    await env.DB.prepare("DELETE FROM entry_reviews WHERE user_id = ? AND kind = ? AND ext_id = ?").bind(user.id, kind, id).run();
    return json({ ok: true, score: await endemionScore(env, kind, id) });
  }
};

/** GET /api/entry-reviews?kind=&offset= — последние отзывы обо всех произведениях */
export const recentReviews = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const kind = search.get("kind") || "";
    if (kind && !KINDS.includes(kind)) return error("Неизвестный раздел.");
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const viewer = await currentUser(env, request);
    const reviews = await recentEntryReviews(env, viewer, { limit: 20, offset, kind });
    return json({ reviews, hasMore: reviews.length === 20 });
  }
};

/** /api/entry-reviews/:id — один отзыв (GET); удаление автором или модератором (DELETE) */
export const entryReview = {
  async onRequestGet({ request, env, params }) {
    const viewer = await currentUser(env, request);
    const id = idParam(params.id);
    const found = id ? await getEntryReview(env, viewer, id) : null;
    if (!found || (found.hidden && !viewer?.isModerator && viewer?.id !== found.author.id)) return error("Отзыв не найден.", 404);
    return json({ review: found });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = idParam(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id FROM entry_reviews WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Отзыв не найден.", 404);
    const own = row.user_id === user.id;
    if (!own && !user.isModerator) return error("Удалить можно только свой отзыв.", 403);
    const statements = [env.DB.prepare("DELETE FROM entry_reviews WHERE id = ?").bind(id)];
    if (!own) {
      statements.push(
        env.DB.prepare("UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE target_type = 'entry_review' AND target_id = ? AND status = 'open'")
          .bind(user.id, id),
        moderationStatement(env, user, { action: "entry_review.delete", targetType: "entry_review", targetId: id })
      );
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
};

// ==================== АДМИНКА ====================

/** GET /api/admin/catalog — источник данных, кеш, ошибки интеграции, настройки и жанры */
export const adminCatalog = {
  async onRequestGet({ request, env }) {
    const { response } = await requireRole(env, request, "admin");
    if (response) return response;
    const [status, settings, counts] = await Promise.all([
      providerStatus(env),
      getSettings(env),
      env.DB.batch([
        env.DB.prepare("SELECT COUNT(*) AS n FROM entries"),
        env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM user_list"),
        env.DB.prepare("SELECT COUNT(*) AS n FROM favorites"),
        env.DB.prepare("SELECT COUNT(*) AS n, SUM(hidden_at IS NOT NULL) AS hidden FROM entry_reviews")
      ])
    ]);
    // Жанры нужны для настройки скрытия. Если источник недоступен, настройки всё равно показываются
    const genres = {};
    for (const kind of KINDS) genres[kind] = await allGenres(env, kind).catch(() => []);
    return json({
      ...status,
      settings,
      genres,
      counts: {
        entries: counts[0].results[0].n,
        listItems: counts[1].results[0].n,
        listUsers: counts[1].results[0].users,
        favorites: counts[2].results[0].n,
        reviews: counts[3].results[0].n,
        reviewsHidden: counts[3].results[0].hidden || 0
      }
    });
  }
};

/** PUT /api/admin/catalog/settings — { allowAdult, hiddenGenres: { anime: [], manga: [] }, hero: null | { kind, id } } */
export const adminCatalogSettings = {
  async onRequestPut({ request, env }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (typeof body.allowAdult !== "boolean") return error("Укажите, показывать ли взрослый контент.");
    const current = await getSettings(env);
    const hiddenGenres = {};
    for (const kind of KINDS) {
      const ids = body.hiddenGenres?.[kind];
      if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => !Number.isInteger(id) || id <= 0)) return error("Неверный список скрытых жанров.");
      // Уже скрытые и скрытые по умолчанию жанры допустимы, даже если источник их сейчас не отдаёт
      const known = new Set([...(await allGenres(env, kind)).map((genre) => genre.id), ...current.hiddenGenres[kind], ...DEFAULT_SETTINGS.hiddenGenres[kind]]);
      if (ids.some((id) => !known.has(id))) return error("В списке есть неизвестный жанр.");
      hiddenGenres[kind] = [...new Set(ids)];
    }
    let hero = null;
    if (body.hero !== null && body.hero !== undefined) {
      const kind = kindParam(body.hero.kind);
      const id = Number.isInteger(body.hero.id) && body.hero.id > 0 ? body.hero.id : null;
      if (!kind || !id || !(await getEntry(env, kind, id))) return error("Произведение для главной не найдено.");
      hero = { kind, id };
    }
    await saveSettings(env, { allowAdult: body.allowAdult, hiddenGenres, hero });
    await audit(env, user, "catalog.settings", `взрослый контент: ${body.allowAdult ? "да" : "нет"}, скрыто жанров: ${hiddenGenres.anime.length + hiddenGenres.manga.length}${hero ? `, на главной ${hero.kind} #${hero.id}` : ""}`);
    return json({ settings: await getSettings(env) });
  }
};

/** POST /api/admin/catalog/cache — очистить кеш каталога */
export const adminCatalogCache = {
  async onRequestPost({ request, env }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const removed = await clearCache(env);
    await audit(env, user, "catalog.cache", `удалено записей: ${removed}`);
    return json({ removed });
  }
};

/** DELETE /api/admin/catalog/errors — очистить журнал ошибок интеграции */
export const adminCatalogErrors = {
  async onRequestDelete({ request, env }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    await clearErrors(env);
    await audit(env, user, "catalog.errors", "журнал ошибок очищен");
    return json({ ok: true });
  }
};

/** GET /api/admin/entry-reviews?hidden=1&offset= — отзывы для модерации */
export const adminReviews = {
  async onRequestGet({ request, env }) {
    const { response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const search = new URL(request.url).searchParams;
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    return json(await adminEntryReviews(env, { hidden: search.get("hidden") === "1", offset }));
  }
};
