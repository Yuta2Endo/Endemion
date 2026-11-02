// GET /api/titles — каталог с поиском, фильтрами, сортировкой и постраничной выдачей.
// Параметры: q (поиск), field (all, title, author, genre — где искать), type, genre, tag, status (ongoing, completed),
// tab (popular, ongoing, reading, completed, favorites, library и другие полки), sort, limit, offset.
// facets=1 добавляет число тайтлов по типам, статусам и жанрам для фильтров. Полки — только для вошедших

import { error, json } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";
import {
  catalogFacets, MAX_PAGE_SIZE, PAGE_SIZE, RELEASE_STATUSES, searchTitles, SEARCH_FIELDS, SHELF_KINDS, SORTS, TYPES
} from "../../_lib/titles.js";
import { intParam } from "../../_lib/validate.js";

// tab=completed — полка «Прочитано», завершённые выпуском тайтлы ищутся через status=completed
const RELEASE_TABS = { ongoing: "ongoing" };
const MAX_QUERY = 100;
const MAX_OFFSET = 100_000;

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;

  const query = (params.get("q") || "").slice(0, MAX_QUERY);
  const field = params.get("field") || "all";
  if (!SEARCH_FIELDS[field]) return error("Неизвестное поле поиска.");
  const type = params.get("type") || null;
  if (type && !TYPES[type]) return error("Неизвестный тип.");
  const genre = (params.get("genre") || "").slice(0, 30) || null;
  const tag = (params.get("tag") || "").slice(0, 40) || null;
  const status = params.get("status") || null;
  if (status && !RELEASE_STATUSES[status]) return error("Неизвестный статус выпуска.");
  const tab = params.get("tab") || "all";
  if (tab !== "all" && tab !== "popular" && !RELEASE_TABS[tab] && !SHELF_KINDS.includes(tab)) return error("Неизвестная подборка.");
  const sort = params.get("sort") || (tab === "popular" ? "popular" : "rating");
  if (!SORTS.includes(sort) || sort === "id") return error("Неизвестная сортировка.");
  const limit = intParam(params.get("limit"), PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = intParam(params.get("offset"), 0, 0, MAX_OFFSET);
  if (limit === null || offset === null) return error("Некорректные limit или offset.");

  let shelf = null;
  if (SHELF_KINDS.includes(tab)) {
    const user = await currentUser(env, request);
    if (!user) return error("Войдите в профиль.", 401);
    shelf = { userId: user.id, kind: tab };
  }

  const result = await searchTitles(env, {
    query, field, type, genre, tag, release: status || RELEASE_TABS[tab] || null, popular: false, shelf, order: sort, limit, offset
  });
  if (params.get("facets") === "1") result.facets = await catalogFacets(env, type);

  // Каталог общий и ненадолго кешируется. Личные подборки не кешируются нигде (json по умолчанию no-store)
  return json(result, 200, shelf ? {} : { "Cache-Control": "public, max-age=60" });
}
