// Главная: орбита с популярными тайтлами, «Продолжить чтение», «Для тебя», популярное, новинки, обновления,
// подборки по настроению, случайная история, подборки читателей. Данные — /api/home и /api/continue

import {
  api, chaptersText, el, errorBox, getLibrary, getMe, initHeader, link, posterBackground, railControls, stateBox,
  thumb, timeAgo, titleCard, toggleFavorite, TYPE_LABELS
} from "./app.js";

const $ = (selector) => document.querySelector(selector);

let library = new Map();

function fillRail(rail, titles, controlsBox, options = {}) {
  rail.removeAttribute("aria-busy");
  if (!titles.length) {
    rail.replaceWith(stateBox({ icon: "✦", text: "Здесь пока пусто: в каталоге ещё нет подходящих тайтлов." }));
    return;
  }
  rail.replaceChildren(...titles.map((title) => titleCard(title, { library: library.get(title.id), onFavorite: toggleFavorite, ...options })));
  if (controlsBox) controlsBox.replaceChildren(railControls(rail));
}

function renderOrbit(titles) {
  const orbit = $("#heroOrbit");
  for (const title of titles.slice(0, 3)) {
    const card = titleCard(title);
    card.classList.add("orbit-card");
    orbit.insertBefore(card, orbit.querySelector(".orbit-note"));
  }
}

function renderStats(total, typeCounts) {
  const stats = $("#heroStats");
  const box = (value, label) => {
    const item = el("div");
    item.append(el("strong", null, value), el("span", null, label));
    return item;
  };
  stats.replaceChildren(box(String(total), "историй в каталоге"), box("3", "формата: манга, манхва, маньхуа"), box("6", "настроений в Oracle"));
  for (const [type, count] of Object.entries(typeCounts)) {
    const node = document.querySelector(`#count-${type}`);
    if (node) node.textContent = `${count} в каталоге →`;
  }
}

function renderUpdated(titles) {
  const list = $("#updatedList");
  list.removeAttribute("aria-busy");
  if (!titles.length) {
    list.replaceChildren(stateBox({ icon: "⏳", text: "Новых глав пока нет." }));
    return;
  }
  list.replaceChildren(...titles.slice(0, 8).map((title) => {
    const item = el("div", "update-item");
    const text = el("div");
    const name = el("strong");
    name.append(link(`/title/${title.id}`, null, title.title));
    text.append(name, el("span", null, `${TYPE_LABELS[title.type]} · глава ${title.chapters} · ${timeAgo(title.updatedAt)}`));
    item.append(thumb(title), text);
    return item;
  }));
}

function renderMoods(moods) {
  const tabs = $("#moodTabs");
  const body = $("#moodBody");
  if (!moods.length) {
    $("#moodsTitle").closest("section").hidden = true;
    return;
  }
  const show = (index) => {
    tabs.querySelectorAll("button").forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    const rail = el("div", "rail");
    body.replaceChildren(rail);
    fillRail(rail, moods[index].titles, null);
    const more = link(`/oracle?mood=${moods[index].key}`, "ghost-btn small-btn", "Больше в Oracle →");
    body.append(more);
  };
  tabs.replaceChildren(...moods.map((mood, i) => {
    const tab = el("button", null, mood.label.replace(/^Хочу /, "").replace(/^./, (c) => c.toUpperCase()));
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => show(i));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const next = (i + (event.key === "ArrowRight" ? 1 : -1) + moods.length) % moods.length;
      show(next);
      tabs.children[next].focus();
    });
    return tab;
  }));
  show(0);
}

function renderCollections(collections) {
  if (!collections.length) return;
  $("#collectionsSection").hidden = false;
  $("#collectionList").replaceChildren(...collections.map((collection) => {
    const card = el("article", "collection-card");
    const stack = el("div", "collection-stack");
    stack.setAttribute("aria-hidden", "true");
    for (const title of collection.preview) {
      const cover = el("span", null, title.cover ? "" : title.symbol);
      cover.style.setProperty("--poster", posterBackground(title));
      stack.append(cover);
    }
    const name = el("strong");
    name.append(link(`/collection/${collection.id}`, null, collection.name));
    card.append(stack, name, el("small", null, `${collection.size} тайтлов · ${collection.author.name}`));
    if (collection.description) card.append(el("p", "t-desc", collection.description));
    return card;
  }));
}

async function renderContinue() {
  const result = await api("/api/continue");
  if (!result.ok || !result.data.items.length) return;
  $("#continueSection").hidden = false;
  $("#continueList").replaceChildren(...result.data.items.slice(0, 4).map((item) => {
    const read = el("a", "primary-btn small-btn", item.position ? `Глава ${item.position.chapter}, стр. ${item.position.page}` : `Читать главу ${item.next}`);
    read.href = item.position ? `/read/${item.title.id}/${item.position.chapter}#${item.position.page}` : `/read/${item.title.id}/${item.next}`;
    const actions = el("div", "t-actions");
    actions.append(read, el("span", "muted small", `осталось ${chaptersText(item.unread)}`));
    return titleCard(item.title, { wide: true, description: false, library: { chapter: item.chapter, status: "reading" }, extra: actions });
  }));
}

function renderForYou(forYou, user) {
  const body = $("#forYouBody");
  if (!user) {
    body.replaceChildren(stateBox({
      icon: "✦", title: "Персональные рекомендации",
      text: "Войдите и добавьте пару тайтлов на полку — ENDEMION начнёт подбирать истории под ваш вкус.",
      action: { href: "/auth?next=%2F", text: "Войти или зарегистрироваться" }
    }));
    return;
  }
  if (!forYou.personalized || !forYou.items.length) {
    body.replaceChildren(stateBox({
      icon: "📚", title: "Пока мало данных о вкусе",
      text: "Добавьте тайтлы на полку, оцените прочитанное или выберите любимые жанры в профиле.",
      action: { href: "/catalog", text: "Открыть каталог" }
    }));
    return;
  }
  const rail = el("div", "rail");
  body.replaceChildren(rail);
  rail.replaceChildren(...forYou.items.map((item) => titleCard(item.title, { library: library.get(item.title.id), onFavorite: toggleFavorite, reasons: item.reasons.slice(0, 1) })));
  $("#forYouControls").replaceChildren(railControls(rail));
}

async function randomStory() {
  const box = $("#randomResult");
  const buttonNode = $("#randomButton");
  buttonNode.disabled = true;
  box.replaceChildren(el("div", "state", "Ищем историю…"));
  const result = await api("/api/random");
  buttonNode.disabled = false;
  if (!result.ok) {
    box.replaceChildren(errorBox(result.data?.error || "Не удалось подобрать историю.", randomStory));
    return;
  }
  box.replaceChildren(titleCard(result.data.title, { wide: true, library: library.get(result.data.title.id), onFavorite: toggleFavorite }));
}

async function init() {
  const [user, home, facets] = await Promise.all([
    initHeader(),
    api("/api/home"),
    api("/api/titles?facets=1&limit=1")
  ]);
  library = await getLibrary();
  if (!home.ok) {
    document.querySelector("main .container:not(.home-hero)")?.prepend(errorBox(home.data?.error || "Главная не загрузилась. Обновите страницу.", () => location.reload()));
    for (const id of ["#popularRail", "#freshRail", "#topRail", "#forYouRail", "#moodRail"]) document.querySelector(id)?.replaceChildren();
    return;
  }
  const data = home.data;
  renderOrbit(data.popular);
  if (facets.ok) renderStats(data.total, facets.data.facets.typeCounts);
  fillRail($("#popularRail"), data.popular, $("#popularControls"));
  fillRail($("#freshRail"), data.fresh, $("#freshControls"));
  fillRail($("#topRail"), data.topRated, $("#topControls"));
  renderUpdated(data.updated);
  renderMoods(data.moods);
  renderCollections(data.collections);
  renderForYou(data.forYou, user);
  if (user) renderContinue();
}

$("#randomButton").addEventListener("click", randomStory);
getMe();
init();
