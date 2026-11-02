// Каталог: поиск по названию, автору или жанру, фильтры по типу, статусу, жанру, тегу и полке, сортировка,
// постраничная выдача «Показать ещё». Фильтры хранятся в адресе: ссылкой можно поделиться, «назад» возвращает прежнюю выдачу

import {
  api, button, cardSkeletons, el, errorBox, getLibrary, getMe, initHeader, plural, SORT_LABELS, stateBox, STATUS_LABELS,
  titleCard, toggleFavorite
} from "./app.js";

const $ = (selector) => document.querySelector(selector);
const grid = $("#titleGrid");
const status = $("#resultsStatus");
const loadMore = $("#loadMore");
const searchInput = $("#searchInput");
const fieldSelect = $("#fieldSelect");
const sortSelect = $("#sortSelect");
const tagSelect = $("#tagSelect");
const filters = $("#filters");

const PAGE_SIZE = 24;
const SEARCH_DELAY = 300;
const SHELVES = { favorites: "Избранное", ...STATUS_LABELS };

const state = { q: "", field: "all", type: "", status: "", genre: "", tag: "", tab: "", sort: "popular" };
let titles = [];
let total = 0;
let library = new Map();
// Ответ на устаревший запрос (фильтр успели сменить) отбрасывается
let requestId = 0;
let searchTimer = null;

// ==================== АДРЕС ====================

function readUrl() {
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(state)) state[key] = params.get(key) || "";
  if (!state.field) state.field = "all";
  if (!SORT_LABELS[state.sort]) state.sort = "popular";
}

function writeUrl(push) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value && !(key === "field" && value === "all") && !(key === "sort" && value === "popular")) params.set(key, value);
  }
  const url = `${location.pathname}${params.size ? `?${params}` : ""}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function apiUrl(offset, facets) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort: state.sort });
  if (state.q.trim()) {
    params.set("q", state.q.trim());
    params.set("field", state.field);
  }
  for (const key of ["type", "status", "genre", "tag", "tab"]) if (state[key]) params.set(key, state[key]);
  if (facets) params.set("facets", "1");
  return `/api/titles?${params}`;
}

// ==================== ОТРИСОВКА ====================

function syncControls() {
  searchInput.value = state.q;
  fieldSelect.value = state.field;
  sortSelect.value = state.sort;
  tagSelect.value = state.tag;
  document.querySelectorAll("[data-filter]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(state[chip.dataset.filter] === chip.dataset.value));
  });
}

function renderFacets(facets) {
  for (const [type, count] of Object.entries(facets.typeCounts)) {
    const node = document.querySelector(`[data-count-type="${type}"]`);
    if (node) node.textContent = String(count);
  }
  const all = document.querySelector('[data-count-type=""]');
  if (all) all.textContent = String(Object.values(facets.typeCounts).reduce((sum, n) => sum + n, 0));
  for (const [key, count] of Object.entries(facets.statusCounts)) {
    const node = document.querySelector(`[data-count-status="${key}"]`);
    if (node) node.textContent = String(count);
  }
  const genres = $("#genreChips");
  const names = facets.genres.includes(state.genre) || !state.genre ? facets.genres : [state.genre, ...facets.genres];
  genres.replaceChildren(
    chip("genre", "", "Все"),
    ...names.map((name) => chip("genre", name, name, facets.genreCounts[name] ?? 0))
  );
  syncControls();
}

function chip(filter, value, label, count = null) {
  const node = button(label, "chip", null, { pressed: state[filter] === value });
  node.dataset.filter = filter;
  node.dataset.value = value;
  if (count !== null) node.append(el("small", null, String(count)));
  return node;
}

function summary() {
  const parts = [];
  if (state.q.trim()) parts.push(`«${state.q.trim()}»`);
  if (state.tab) parts.push(SHELVES[state.tab]);
  if (state.genre) parts.push(state.genre);
  if (state.tag) parts.push(tagSelect.selectedOptions[0]?.textContent || state.tag);
  return `Найдено ${total} ${plural(total, "тайтл", "тайтла", "тайтлов")}${parts.length ? `: ${parts.join(" · ")}` : ""}`;
}

function render() {
  grid.removeAttribute("aria-busy");
  status.textContent = summary();
  if (!titles.length) {
    grid.replaceChildren(stateBox({
      icon: "🔭",
      title: "Ничего не нашлось",
      text: state.tab ? "На этой полке пока пусто." : "Попробуйте другое слово, другой фильтр или сбросьте фильтры.",
      action: { text: "Сбросить фильтры", onClick: resetFilters }
    }));
    loadMore.hidden = true;
    return;
  }
  grid.replaceChildren(...titles.map((title) => titleCard(title, { library: library.get(title.id), onFavorite: toggleFavorite })));
  loadMore.hidden = titles.length >= total;
}

// ==================== ДАННЫЕ ====================

async function fetchPage({ facets = false } = {}) {
  const id = ++requestId;
  grid.setAttribute("aria-busy", "true");
  grid.replaceChildren(...cardSkeletons(12));
  status.textContent = "Загрузка…";
  const result = await api(apiUrl(0, facets));
  if (id !== requestId) return;
  if (!result.ok) {
    if (result.status === 401) {
      state.tab = "";
      writeUrl(false);
      return fetchPage({ facets });
    }
    grid.removeAttribute("aria-busy");
    grid.replaceChildren(errorBox(result.data?.error || "Каталог не загрузился.", () => fetchPage({ facets })));
    status.textContent = "Ошибка загрузки";
    loadMore.hidden = true;
    return;
  }
  titles = result.data.titles;
  total = result.data.total;
  if (result.data.facets) renderFacets(result.data.facets);
  render();
}

async function fetchMore() {
  const id = requestId;
  loadMore.disabled = true;
  const result = await api(apiUrl(titles.length, false));
  loadMore.disabled = false;
  if (id !== requestId) return;
  if (!result.ok) return status.textContent = result.data?.error || "Не удалось загрузить ещё.";
  // Пока листали, в каталог могли добавить тайтл: страницы сдвинулись, повторы убираем
  const known = new Set(titles.map((title) => title.id));
  const start = titles.length;
  titles = [...titles, ...result.data.titles.filter((title) => !known.has(title.id))];
  total = result.data.total;
  render();
  grid.querySelectorAll(".t-title a")[start]?.focus();
}

function apply(push = true, facets = false) {
  writeUrl(push);
  syncControls();
  fetchPage({ facets });
}

function resetFilters() {
  Object.assign(state, { q: "", field: "all", type: "", status: "", genre: "", tag: "", tab: "", sort: "popular" });
  apply(true, true);
}

// ==================== СОБЫТИЯ ====================

filters.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-filter]") : null;
  if (!(target instanceof HTMLElement)) return;
  const key = target.dataset.filter;
  state[key] = state[key] === target.dataset.value && key !== "genre" ? "" : target.dataset.value;
  // Список жанров зависит от типа: при смене типа он обновляется
  apply(true, key === "type");
});

$("#resetFilters").addEventListener("click", resetFilters);
tagSelect.addEventListener("change", () => {
  state.tag = tagSelect.value;
  apply();
});
sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  apply();
});
fieldSelect.addEventListener("change", () => {
  state.field = fieldSelect.value;
  if (state.q.trim()) apply();
});
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchInput.value;
    apply(false);
  }, SEARCH_DELAY);
});
$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  state.q = searchInput.value;
  apply();
});
loadMore.addEventListener("click", fetchMore);
window.addEventListener("popstate", () => {
  readUrl();
  syncControls();
  fetchPage({ facets: true });
});

// Фильтры на планшете и телефоне — выдвижная панель
const openButton = $("#filtersOpen");
const setFiltersOpen = (open) => {
  filters.classList.toggle("open", open);
  openButton.setAttribute("aria-expanded", String(open));
  if (open) filters.querySelector("button")?.focus();
};
openButton.addEventListener("click", () => setFiltersOpen(!filters.classList.contains("open")));
$("#filtersDone").addEventListener("click", () => {
  setFiltersOpen(false);
  openButton.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && filters.classList.contains("open")) setFiltersOpen(false);
});

// ==================== СТАРТ ====================

async function init() {
  readUrl();
  for (const [value, label] of Object.entries(SORT_LABELS)) sortSelect.append(new Option(label, value));
  const [user, taxonomy] = await Promise.all([initHeader(), api("/api/taxonomy")]);
  if (taxonomy.ok) {
    const groups = new Map();
    for (const tag of taxonomy.data.tags.filter((item) => item.titles > 0)) {
      if (!groups.has(tag.category)) {
        const group = el("optgroup");
        group.label = taxonomy.data.categories[tag.category];
        groups.set(tag.category, group);
        tagSelect.append(group);
      }
      groups.get(tag.category).append(new Option(tag.name, tag.code));
    }
  }
  if (user) {
    library = await getLibrary();
    $("#shelfGroup").hidden = false;
    $("#shelfChips").replaceChildren(chip("tab", "", "Весь каталог"), ...Object.entries(SHELVES).map(([key, label]) => chip("tab", key, label)));
  } else if (state.tab) {
    state.tab = "";
  }
  syncControls();
  writeUrl(false);
  await fetchPage({ facets: true });
}

getMe();
init();
