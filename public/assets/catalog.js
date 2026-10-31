// Главная страница: каталог из API, поиск, фильтры по типу и жанру, избранное и прогресс из библиотеки пользователя

import { api, chaptersText, getMe, initHeader, loginUrl, posterBackground, STATUS_LABELS, toast, TYPE_LABELS } from "./app.js";

const grid = document.querySelector("#titleGrid");
const popularGrid = document.querySelector("#popularGrid");
const updatesList = document.querySelector("#updatesList");
const emptyState = document.querySelector("#emptyState");
const resultsStatus = document.querySelector("#resultsStatus");
const searchInput = document.querySelector("#searchInput");
const genresBox = document.querySelector("#genres");

const state = {
  titles: [],
  type: "all",
  tab: "all",
  genre: "Все",
  query: "",
  user: null,
  // titleId -> { favorite, status, chapter }
  library: new Map()
};

// Избранное из версии сайта про аниме: его id указывают на другие тайтлы, переносить нечего
localStorage.removeItem("endemion-favorites");

// ==================== ДАННЫЕ ====================

async function load() {
  showSkeletons();
  const [catalog, updates, me] = await Promise.all([api("/api/titles"), api("/api/updates"), getMe()]);

  if (!catalog.ok) {
    grid.replaceChildren();
    showEmpty(catalog.data?.error || "Не удалось загрузить каталог. Обновите страницу.");
    return;
  }

  state.titles = catalog.data.titles;
  state.user = me.user;
  if (state.user) {
    const library = await api("/api/library");
    if (library.ok) state.library = new Map(library.data.items.map((item) => [item.titleId, item]));
  }

  renderTypeCounts();
  renderGenres();
  render();
  renderPopular();
  renderUpdates(updates.ok ? updates.data.titles : []);
}

// ==================== ФИЛЬТРЫ ====================

function matches(item) {
  const query = state.query.toLowerCase().trim();
  const entry = state.library.get(item.id);

  const matchesQuery =
    !query ||
    item.title.toLowerCase().includes(query) ||
    item.author.toLowerCase().includes(query) ||
    item.translator.toLowerCase().includes(query) ||
    TYPE_LABELS[item.type].toLowerCase().includes(query) ||
    item.genres.some((genre) => genre.toLowerCase().includes(query));

  const matchesType = state.type === "all" || item.type === state.type;
  const matchesGenre = state.genre === "Все" || item.genres.includes(state.genre);

  const matchesTab = {
    all: true,
    popular: item.rating >= 8.8,
    ongoing: item.status === "ongoing",
    completed: item.status === "completed",
    reading: entry?.status === "reading",
    favorites: entry?.favorite === true
  }[state.tab];

  return matchesQuery && matchesType && matchesGenre && matchesTab;
}

function renderTypeCounts() {
  for (const [type, id] of [["manga", "#countManga"], ["manhwa", "#countManhwa"], ["manhua", "#countManhua"]]) {
    const count = state.titles.filter((item) => item.type === type).length;
    document.querySelector(id).textContent = `${count} в каталоге`;
  }
}

/** Жанры только тех тайтлов, которые подходят под выбранный тип */
function renderGenres() {
  const pool = state.titles.filter((item) => state.type === "all" || item.type === state.type);
  const genres = [...new Set(pool.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b, "ru"));
  if (state.genre !== "Все" && !genres.includes(state.genre)) state.genre = "Все";

  genresBox.replaceChildren(
    ...["Все", ...genres].map((genre) => {
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
  renderGenres();
  render();
}

function setTab(tab) {
  // Личные подборки есть только у вошедших
  if ((tab === "favorites" || tab === "reading") && !state.user) {
    toast(`Чтобы видеть свою полку, <a href="${loginUrl()}">войдите в профиль</a>.`, { html: true, duration: 5000 });
    return;
  }
  state.tab = tab;
  setPressed("[data-tab]", "tab", tab);
  render();
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

  if (entry?.chapter > 0) {
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
  const filtered = state.titles.filter(matches);
  grid.replaceChildren(...filtered.map(card));
  resultsStatus.textContent = `Найдено тайтлов: ${filtered.length}`;

  if (filtered.length > 0) {
    emptyState.hidden = true;
  } else if (state.titles.length === 0) {
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
  const popular = [...state.titles].sort((a, b) => b.rating - a.rating).slice(0, 4);
  popularGrid.replaceChildren(...popular.map(card));
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
  render();
  renderPopular();
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
  render();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  render();
});

document.querySelector("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value;
  render();
  document.querySelector("#catalog").scrollIntoView({ block: "start" });
});

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
