// Главная страница: каталог с поиском на сервере (/api/titles) и постраничной выдачей, фильтры по типу, жанру и подборкам,
// избранное и прогресс из библиотеки пользователя

import { api, chaptersText, getMe, initHeader, loginUrl, posterBackground, STATUS_LABELS, toast, TYPE_LABELS } from "./app.js";

const grid = document.querySelector("#titleGrid");
const popularGrid = document.querySelector("#popularGrid");
const updatesList = document.querySelector("#updatesList");
const emptyState = document.querySelector("#emptyState");
const resultsStatus = document.querySelector("#resultsStatus");
const searchInput = document.querySelector("#searchInput");
const genresBox = document.querySelector("#genres");
const loadMore = document.querySelector("#loadMore");

const PAGE_SIZE = 24;
// Поиск уходит на сервер, когда пользователь перестал печатать
const SEARCH_DELAY = 250;

const state = {
  // Загруженные страницы выдачи и сколько всего тайтлов подходит под фильтры
  titles: [],
  total: 0,
  // Сколько тайтлов в каталоге без фильтров
  catalogSize: 0,
  popular: [],
  facets: { typeCounts: {}, genres: [] },
  type: "all",
  tab: "all",
  genre: "Все",
  query: "",
  user: null,
  // titleId -> { favorite, status, chapter }
  library: new Map()
};

// Номер последнего запроса выдачи: ответ на устаревший запрос (фильтр успели сменить) отбрасывается
let requestId = 0;
let searchTimer = null;

// Избранное из версии сайта про аниме: его id указывают на другие тайтлы, переносить нечего
localStorage.removeItem("endemion-favorites");

// ==================== ДАННЫЕ ====================

function catalogUrl(offset, withFacets) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const query = state.query.trim();
  if (query) params.set("q", query);
  if (state.type !== "all") params.set("type", state.type);
  if (state.genre !== "Все") params.set("genre", state.genre);
  if (state.tab !== "all") params.set("tab", state.tab);
  if (withFacets) params.set("facets", "1");
  return `/api/titles?${params}`;
}

function applyFacets(facets) {
  state.facets = facets;
  if (state.type === "all") state.catalogSize = Object.values(facets.typeCounts).reduce((sum, n) => sum + n, 0);
  renderTypeCounts();
  renderGenres();
}

/** Первая страница выдачи по текущим фильтрам. withFacets — заодно обновить число тайтлов по типам и список жанров */
async function fetchCatalog({ withFacets = false } = {}) {
  const id = ++requestId;
  showSkeletons();
  const result = await api(catalogUrl(0, withFacets));
  if (id !== requestId) return;

  if (!result.ok) {
    state.titles = [];
    state.total = 0;
    grid.replaceChildren();
    loadMore.hidden = true;
    showEmpty(result.data?.error || "Не удалось загрузить каталог. Обновите страницу.");
    return;
  }

  if (result.data.facets) {
    applyFacets(result.data.facets);
    // У нового типа нет выбранного жанра: снимаем жанр и загружаем выдачу заново
    if (state.genre !== "Все" && !state.facets.genres.includes(state.genre)) {
      state.genre = "Все";
      setPressed("[data-genre]", "genre", state.genre);
      return fetchCatalog();
    }
  }
  state.titles = result.data.titles;
  state.total = result.data.total;
  render();
}

async function fetchMore() {
  const id = requestId;
  loadMore.disabled = true;
  const result = await api(catalogUrl(state.titles.length, false));
  loadMore.disabled = false;
  if (id !== requestId) return;
  if (!result.ok) {
    toast(result.data?.error || "Не удалось загрузить. Попробуйте ещё раз.");
    return;
  }

  // Пока листали, в каталог могли добавить тайтл: страницы сдвинулись, повторы убираем
  const known = new Set(state.titles.map((item) => item.id));
  const start = state.titles.length;
  state.titles = [...state.titles, ...result.data.titles.filter((item) => !known.has(item.id))];
  state.total = result.data.total;
  render();
  // Фокус на первую новую карточку: с клавиатуры не нужно проходить заново весь список
  grid.querySelectorAll(".card-title a")[start]?.focus();
}

async function load() {
  const [me, popular, updates] = await Promise.all([
    getMe(),
    api(`/api/titles?limit=4`),
    api("/api/updates"),
    fetchCatalog({ withFacets: true })
  ]);

  state.user = me.user;
  if (state.user) {
    const library = await api("/api/library");
    if (library.ok) state.library = new Map(library.data.items.map((item) => [item.titleId, item]));
  }
  state.popular = popular.ok ? popular.data.titles : [];

  if (state.titles.length) render();
  renderPopular();
  renderUpdates(updates.ok ? updates.data.titles : []);
}

// ==================== ФИЛЬТРЫ ====================

function renderTypeCounts() {
  for (const [type, id] of [["manga", "#countManga"], ["manhwa", "#countManhwa"], ["manhua", "#countManhua"]]) {
    document.querySelector(id).textContent = `${state.facets.typeCounts[type] ?? 0} в каталоге`;
  }
}

/** Жанры только тех тайтлов, которые подходят под выбранный тип: список присылает сервер */
function renderGenres() {
  genresBox.replaceChildren(
    ...["Все", ...state.facets.genres].map((genre) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "genre";
      button.dataset.genre = genre;
      button.textContent = genre;
      button.setAttribute("aria-pressed", String(genre === state.genre));
      return button;
    })
  );
}

function setPressed(selector, attribute, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
  });
}

function setType(type) {
  state.type = type;
  setPressed("[data-type]", "type", type);
  document.querySelectorAll("[data-type-card]").forEach((card) => card.classList.toggle("active", card.dataset.typeCard === type));
  // Жанры зависят от типа
  fetchCatalog({ withFacets: true });
}

function setTab(tab) {
  // Личные подборки есть только у вошедших
  if ((tab === "favorites" || tab === "reading") && !state.user) {
    toast(`Чтобы видеть свою полку, <a href="${loginUrl()}">войдите в профиль</a>.`, { html: true, duration: 5000 });
    return;
  }
  state.tab = tab;
  setPressed("[data-tab]", "tab", tab);
  fetchCatalog();
}

function setQuery(value, { now = false } = {}) {
  clearTimeout(searchTimer);
  if (value.trim() === state.query.trim() && !now) return;
  state.query = value;
  if (now) fetchCatalog();
  else searchTimer = setTimeout(fetchCatalog, SEARCH_DELAY);
}

// ==================== КАРТОЧКИ ====================

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(item) {
  const entry = state.library.get(item.id);
  const article = element("article", "title-card");

  const poster = element("div", "card-poster");
  // Градиент обложки ставится через CSSOM: встроенный атрибут style запретил бы строгий CSP
  poster.style.setProperty("--poster", posterBackground(item));
  poster.append(element("span", `type-badge type-${item.type}`, TYPE_LABELS[item.type]));
  // Символ рисуется только на градиенте: поверх загруженной обложки он не нужен
  if (!item.cover) {
    const symbol = element("span", "poster-symbol", item.symbol);
    symbol.setAttribute("aria-hidden", "true");
    poster.append(symbol);
  }

  const favorite = element("button", "favorite", entry?.favorite ? "♥" : "♡");
  favorite.type = "button";
  favorite.dataset.favorite = item.id;
  favorite.setAttribute("aria-pressed", String(entry?.favorite === true));
  favorite.setAttribute("aria-label", entry?.favorite ? `Убрать «${item.title}» из избранного` : `Добавить «${item.title}» в избранное`);
  poster.append(favorite);

  const posterContent = element("div", "card-poster-content");
  posterContent.append(element("small", null, item.genres.join(" · ")));
  if (entry?.status) posterContent.append(element("span", "status-badge", STATUS_LABELS[entry.status]));
  poster.append(posterContent);

  const info = element("div", "card-info");
  const title = element("h3", "card-title");
  const link = element("a", null, item.title);
  link.href = `/title/${item.id}`;
  title.append(link);
  info.append(title);

  const meta = element("div", "card-meta");
  meta.append(element("span", null, String(item.year)), element("span", null, "•"), element("span", null, chaptersText(item.chapters)),
    element("span", null, "•"), element("span", "rating", `★ ${item.rating}`));
  info.append(meta);

  const footer = element("div", "card-footer");
  footer.append(element("span", "translator", item.translator));
  footer.append(element("span", `release release-${item.status}`, item.status === "ongoing" ? "Выходит" : "Завершён"));
  info.append(footer);

  if (entry?.chapter > 0 && item.chapters > 0) {
    const progress = element("div", "progress-line");
    progress.setAttribute("role", "img");
    progress.setAttribute("aria-label", `Прочитано ${entry.chapter} из ${item.chapters} глав`);
    const bar = element("span");
    bar.style.width = `${Math.round((entry.chapter / item.chapters) * 100)}%`;
    progress.append(bar);
    info.append(progress);
  }

  article.append(poster, info);
  return article;
}

function render() {
  grid.replaceChildren(...state.titles.map(card));
  resultsStatus.textContent = `Найдено тайтлов: ${state.total}`;
  loadMore.hidden = state.titles.length >= state.total;

  if (state.titles.length > 0) {
    emptyState.hidden = true;
  } else if (state.catalogSize === 0) {
    showEmpty("Каталог пока пуст. Тайтлы скоро появятся.");
  } else if (state.tab === "favorites") {
    showEmpty("В избранном пока пусто. Нажми ♡ на карточке, чтобы сохранить тайтл.");
  } else if (state.tab === "reading") {
    showEmpty("Здесь появятся тайтлы, которые ты читаешь. Отметь прочитанную главу на странице тайтла.");
  } else {
    showEmpty("Ничего не найдено. Попробуй изменить запрос, тип или жанр.");
  }
}

function renderPopular() {
  popularGrid.replaceChildren(...state.popular.map(card));
}

function renderUpdates(items) {
  if (items.length === 0) {
    updatesList.replaceChildren(element("p", "empty", "Новых глав пока нет."));
    return;
  }
  updatesList.replaceChildren(
    ...items.map((item) => {
      const row = element("article", "update-row");
      const thumb = element("div", "update-thumb", item.cover ? "" : item.symbol);
      thumb.style.setProperty("--poster", posterBackground(item));
      thumb.setAttribute("aria-hidden", "true");

      const text = element("div");
      const title = element("strong");
      const link = element("a", null, item.title);
      link.href = `/title/${item.id}`;
      title.append(link);
      const when = new Date(item.updatedAt.replace(" ", "T") + "Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
      const label = item.status === "completed" ? "Финальная глава" : "Глава";
      text.append(title, element("span", null, `${TYPE_LABELS[item.type]} · ${label} ${item.chapters} · ${when}`));

      row.append(thumb, text);
      return row;
    })
  );
}

function showEmpty(message) {
  emptyState.textContent = message;
  emptyState.hidden = false;
}

function showSkeletons() {
  emptyState.hidden = true;
  loadMore.hidden = true;
  grid.replaceChildren(...Array.from({ length: 4 }, () => element("div", "skeleton")));
}

// ==================== ИЗБРАННОЕ ====================

async function toggleFavorite(id) {
  if (!state.user) {
    toast(`Чтобы сохранять избранное, <a href="${loginUrl()}">войдите или зарегистрируйтесь</a>.`, { html: true, duration: 5000 });
    return;
  }
  const entry = state.library.get(id);
  const result = await api(`/api/library/${id}`, { method: "PUT", body: { favorite: !entry?.favorite } });
  if (!result.ok) {
    toast(result.data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
    return;
  }
  state.library.set(id, result.data.item);
  renderPopular();
  // В подборке «Избранное» состав выдачи изменился: загружаем её заново
  if (state.tab === "favorites") {
    await fetchCatalog();
    return;
  }
  render();
  // Фокус возвращается на кнопку: после перерисовки старой кнопки уже нет
  document.querySelector(`#titleGrid [data-favorite="${id}"]`)?.focus();
}

// ==================== СОБЫТИЯ ====================

document.querySelector("#types").addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (button) setType(button.dataset.type);
});

document.querySelectorAll("[data-type-card]").forEach((cardButton) => {
  cardButton.addEventListener("click", () => {
    // Повторное нажатие на выбранный тип снимает фильтр
    setType(state.type === cardButton.dataset.typeCard ? "all" : cardButton.dataset.typeCard);
    document.querySelector("#catalog").scrollIntoView({ block: "start" });
  });
});

document.querySelector("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) setTab(button.dataset.tab);
});

genresBox.addEventListener("click", (event) => {
  const button = event.target.closest("[data-genre]");
  if (!button) return;
  state.genre = button.dataset.genre;
  setPressed("[data-genre]", "genre", state.genre);
  fetchCatalog();
});

searchInput.addEventListener("input", () => setQuery(searchInput.value));

document.querySelector("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  setQuery(searchInput.value, { now: true });
  document.querySelector("#catalog").scrollIntoView({ block: "start" });
});

loadMore.addEventListener("click", fetchMore);

document.querySelector("#favoritesTop").addEventListener("click", () => {
  setTab("favorites");
  if (state.user) document.querySelector("#catalog").scrollIntoView({ block: "start" });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-favorite]");
  if (button) toggleFavorite(Number(button.dataset.favorite));
});

initHeader();
load();
