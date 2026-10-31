// GET /api/titles — каталог с поиском, фильтрами и постраничной выдачей.
// Параметры: q (поиск), type, genre, tab (popular, ongoing, completed, reading, favorites, library), limit, offset.
// facets=1 добавляет число тайтлов по типам и жанры для фильтров. Подборки reading, favorites и library — только для вошедших

import { error, json } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";
import { catalogFacets, MAX_PAGE_SIZE, PAGE_SIZE, searchTitles, TYPES } from "../../_lib/titles.js";

const RELEASE_TABS = { ongoing: "ongoing", completed: "completed" };
const SHELF_TABS = ["reading", "favorites", "library"];
const MAX_QUERY = 100;
const MAX_OFFSET = 100_000;

/** Целое число из адреса в пределах [min, max] или значение по умолчанию */
function intParam(value, fallback, min, max) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;

  const query = (params.get("q") || "").slice(0, MAX_QUERY);
  const type = params.get("type") || null;
  if (type && !TYPES[type]) return error("Неизвестный тип.");
  const genre = (params.get("genre") || "").slice(0, 30) || null;
  const tab = params.get("tab") || "all";
  if (tab !== "all" && tab !== "popular" && !RELEASE_TABS[tab] && !SHELF_TABS.includes(tab)) return error("Неизвестная подборка.");
  const limit = intParam(params.get("limit"), PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = intParam(params.get("offset"), 0, 0, MAX_OFFSET);
  if (limit === null || offset === null) return error("Некорректные limit или offset.");

  let shelf = null;
  if (SHELF_TABS.includes(tab)) {
    const user = await currentUser(env, request);
    if (!user) return error("Войдите в профиль.", 401);
    shelf = { userId: user.id, kind: tab };
  }

  const result = await searchTitles(env, {
    query, type, genre, release: RELEASE_TABS[tab] || null, popular: tab === "popular", shelf, limit, offset
  });
  if (params.get("facets") === "1") result.facets = await catalogFacets(env, type);

  // Каталог общий и ненадолго кешируется. Личные подборки не кешируются нигде (json по умолчанию no-store)
  return json(result, 200, shelf ? {} : { "Cache-Control": "public, max-age=60" });
}
