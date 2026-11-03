// «Мой список»: аниме и манга по статусам с поиском и сортировкой, правка статуса, оценки и прогресса прямо в строке,
// статистика (сколько эпизодов и часов, средняя оценка, распределение оценок) и избранное

import { api, button, el, entryUrl, errorBox, initHeader, link, loginUrl, remoteImage, stateBox, toast } from "./app.js";
import { entryMeta, LIST_STATUSES, removeListItem, saveListItem, SCORE_LABELS } from "./ency-lib.js";

const root = document.querySelector("#myList");
const body = document.querySelector("#myListBody");
const tabs = [...document.querySelectorAll("[data-kind]")];

const SORTS = { updated: "Недавно изменённые", score: "По моей оценке", title: "По названию", year: "По году", progress: "По прогрессу" };
const FAVORITE_LABELS = { anime: "Аниме", manga: "Манга", character: "Персонажи", person: "Люди" };

const state = { kind: "anime", status: "", sort: "updated", q: "" };
let searchTimer = null;
// Ответ на устаревший запрос отбрасывается
let requestId = 0;

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.kind = ["anime", "manga", "favorites"].includes(params.get("kind")) ? params.get("kind") : "anime";
  state.status = LIST_STATUSES.anime[params.get("status")] ? params.get("status") : "";
  state.sort = SORTS[params.get("sort")] ? params.get("sort") : "updated";
  state.q = params.get("q") || "";
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.kind !== "anime") params.set("kind", state.kind);
  if (state.status) params.set("status", state.status);
  if (state.sort !== "updated") params.set("sort", state.sort);
  if (state.q) params.set("q", state.q);
  history.replaceState(null, "", `/mylist${params.size ? `?${params}` : ""}`);
}

// ==================== СТРОКА СПИСКА ====================

function row(item, onChange) {
  const { entry } = item;
  const node = el("article", "list-row");
  const poster = link(entryUrl(entry), "list-row-poster", null);
  poster.tabIndex = -1;
  poster.setAttribute("aria-hidden", "true");
  poster.append(remoteImage(entry.poster?.small, ""));
  const title = el("div", "list-row-title");
  title.append(link(entryUrl(entry), null, entry.title), el("small", null, entryMeta(entry)));

  const status = el("select", "select");
  status.setAttribute("aria-label", `Статус: ${entry.title}`);
  for (const [value, label] of Object.entries(LIST_STATUSES[entry.kind])) status.append(new Option(label, value));
  status.value = item.status;

  const progress = el("div", "progress-control");
  const input = el("input", "input");
  input.type = "number";
  input.min = "0";
  if (entry.units) input.max = String(entry.units);
  input.value = String(item.progress);
  input.setAttribute("aria-label", entry.kind === "anime" ? `Эпизоды: ${entry.title}` : `Главы: ${entry.title}`);
  const plus = button("+1", "ghost-btn small-btn icon-only", () => save({ progress: item.progress + 1 }), { label: "Прибавить один" });
  plus.disabled = Boolean(entry.units) && item.progress >= entry.units;
  progress.append(input, el("small", "muted", `/ ${entry.units || "?"}`), plus);

  const score = el("select", "select list-row-score");
  score.setAttribute("aria-label", `Оценка: ${entry.title}`);
  score.append(new Option("Без оценки", ""), ...Array.from({ length: 10 }, (_, i) => new Option(`${10 - i} — ${SCORE_LABELS[10 - i]}`, String(10 - i))));
  score.value = item.score ? String(item.score) : "";

  const remove = button("✕", "ghost-btn small-btn icon-only", async () => {
    if (!confirm(`Убрать «${entry.title}» из списка?`)) return;
    if (await removeListItem(entry.kind, entry.id)) {
      node.remove();
      toast("Убрано из списка");
      onChange();
    }
  }, { label: `Убрать «${entry.title}» из списка` });

  async function save(changes) {
    node.setAttribute("aria-busy", "true");
    const next = await saveListItem(entry.kind, entry.id, changes);
    node.removeAttribute("aria-busy");
    if (!next) {
      status.value = item.status;
      input.value = String(item.progress);
      score.value = item.score ? String(item.score) : "";
      return;
    }
    const moved = next.status !== item.status;
    Object.assign(item, next);
    status.value = item.status;
    input.value = String(item.progress);
    plus.disabled = Boolean(entry.units) && item.progress >= entry.units;
    // Статус сменился (например, последний эпизод — «Просмотрено»): цифры статистики и, может быть, фильтр уже другие
    if (moved) {
      toast(`«${entry.title}»: ${LIST_STATUSES[entry.kind][item.status]}`);
      if (state.status && state.status !== item.status) node.remove();
    }
    onChange();
  }

  status.addEventListener("change", () => save({ status: status.value }));
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 0) save({ progress: entry.units ? Math.min(value, entry.units) : value });
    else input.value = String(item.progress);
  });
  score.addEventListener("change", () => save({ score: score.value ? Number(score.value) : null }));

  node.append(poster, title, status, progress, score, remove);
  return node;
}

// ==================== СТАТИСТИКА ====================

function statsBlock(stats, kind, onPick) {
  const wrap = el("div");
  const grid = el("div", "list-stats");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Фильтр по статусу");
  const tile = (value, label, count) => {
    const node = button("", null, () => onPick(value), { pressed: state.status === value });
    node.append(el("strong", null, String(count)), el("span", null, label));
    return node;
  };
  grid.append(tile("", "Всего", stats.total), ...Object.entries(LIST_STATUSES[kind]).map(([key, label]) => tile(key, label, stats.statuses[key])));
  const summary = el("p", "list-summary");
  const part = (label, value) => {
    const span = el("span", null, `${label}: `);
    span.append(el("strong", null, value));
    return span;
  };
  summary.append(
    part(kind === "anime" ? "Эпизодов" : "Глав", String(stats.units)),
    ...(kind === "anime" ? [part("Часов", String(stats.hours))] : []),
    part("Средняя оценка", stats.meanScore ? String(stats.meanScore) : "—"),
    part("Оценено", String(stats.rated))
  );
  wrap.append(grid, summary);

  if (stats.rated) {
    const details = el("details", "more-block");
    details.append(el("summary", null, "Распределение оценок"));
    const bars = el("div", "score-bars");
    const max = Math.max(...Object.values(stats.distribution));
    for (let score = 10; score >= 1; score--) {
      const count = stats.distribution[score];
      const line = el("div", "score-bar");
      const fill = el("i");
      fill.style.width = `${max ? Math.max(2, (count / max) * 100) : 0}%`;
      line.append(el("span", null, String(score)), fill, el("small", "muted", String(count)));
      bars.append(line);
    }
    details.append(bars);
    wrap.append(details);
  }
  return wrap;
}

// ==================== СПИСОК ====================

async function showList() {
  const id = ++requestId;
  const statsBox = el("div");
  const toolbar = el("div", "list-toolbar");
  const search = el("input", "input");
  search.type = "search";
  search.placeholder = "Поиск по списку…";
  search.maxLength = 100;
  search.value = state.q;
  search.setAttribute("aria-label", "Поиск по списку");
  const sort = el("select", "select");
  sort.setAttribute("aria-label", "Сортировка");
  for (const [value, label] of Object.entries(SORTS)) sort.append(new Option(label, value));
  sort.value = state.sort;
  toolbar.append(search, sort);
  const rows = el("div", "list-rows");
  const more = button("Показать ещё", "ghost-btn", () => load(false));
  more.hidden = true;
  body.replaceChildren(statsBox, toolbar, rows, more);

  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = search.value.trim();
      writeUrl();
      load(true);
    }, 300);
  });
  sort.addEventListener("change", () => {
    state.sort = sort.value;
    writeUrl();
    load(true);
  });

  let offset = 0;
  let statsTimer = null;
  // После правки в строке статистика пересчитывается одним запросом, даже если правок было несколько подряд
  const refreshStats = () => {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(async () => {
      const result = await api(`/api/mylist?kind=${state.kind}&offset=100000`);
      if (result.ok) drawStats(result.data.stats);
    }, 600);
  };
  const drawStats = (stats) => statsBox.replaceChildren(statsBlock(stats, state.kind, (status) => {
    state.status = status;
    writeUrl();
    load(true);
  }));

  async function load(reset) {
    const current = requestId;
    if (reset) {
      offset = 0;
      rows.setAttribute("aria-busy", "true");
    }
    const params = new URLSearchParams({ kind: state.kind, sort: state.sort, offset: String(offset) });
    if (state.status) params.set("status", state.status);
    if (state.q) params.set("q", state.q);
    const result = await api(`/api/mylist?${params}`);
    if (current !== requestId) return;
    rows.removeAttribute("aria-busy");
    if (!result.ok) {
      rows.replaceChildren(errorBox(result.data?.error || "Список не загрузился.", () => load(true)));
      return;
    }
    drawStats(result.data.stats);
    if (reset) rows.replaceChildren();
    if (reset && !result.data.items.length) {
      const empty = !result.data.stats.total;
      rows.append(stateBox(empty
        ? { icon: "📚", title: "Список пуст", text: `Откройте любое ${state.kind === "anime" ? "аниме" : "произведение"} и нажмите «Добавить в список».`, action: { href: `/${state.kind}`, text: state.kind === "anime" ? "Каталог аниме" : "Каталог манги" } }
        : { icon: "🔭", title: "Ничего не нашлось", text: "Попробуйте другой статус или запрос." }));
    }
    rows.append(...result.data.items.map((item) => row(item, refreshStats)));
    offset += result.data.items.length;
    more.hidden = !result.data.hasMore;
  }
  if (id === requestId) await load(true);
}

// ==================== ИЗБРАННОЕ ====================

async function showFavorites() {
  body.replaceChildren(el("p", "muted", "Загружаем…"));
  const result = await api("/api/favorites");
  if (!result.ok) {
    body.replaceChildren(errorBox(result.data?.error || "Избранное не загрузилось.", showFavorites));
    return;
  }
  if (!result.data.items.length) {
    body.replaceChildren(stateBox({ icon: "♡", title: "Избранное пусто", text: "Нажмите «В избранное» на странице произведения, персонажа или человека." }));
    return;
  }
  const blocks = [];
  for (const [type, label] of Object.entries(FAVORITE_LABELS)) {
    const items = result.data.items.filter((item) => item.type === type);
    if (!items.length) continue;
    const grid = el("div", "fav-grid");
    for (const item of items) {
      const path = type === "character" ? "/characters" : type === "person" ? "/people" : `/${type}`;
      const card = el("article", "p-card");
      const photo = link(`${path}/${item.id}`, "p-photo", null);
      photo.tabIndex = -1;
      photo.setAttribute("aria-hidden", "true");
      photo.append(remoteImage(item.image, ""));
      const name = el("h3", "p-name");
      name.append(link(`${path}/${item.id}`, null, item.name));
      card.append(photo, name);
      grid.append(card);
    }
    const section = el("section", "section");
    section.append(el("h2", null, `${label} · ${items.length}`), grid);
    blocks.push(section);
  }
  body.replaceChildren(...blocks);
}

// ==================== СТАРТ ====================

function open(kind) {
  if (kind !== state.kind) {
    state.kind = kind;
    state.status = "";
    state.q = "";
  }
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.kind === state.kind)));
  writeUrl();
  if (state.kind === "favorites") showFavorites();
  else showList();
}

async function init() {
  readUrl();
  const user = await initHeader();
  root.removeAttribute("aria-busy");
  if (!user) {
    body.replaceChildren(stateBox({
      icon: "📚", title: "Войдите, чтобы вести список",
      text: "Отмечайте просмотренное и прочитанное, ставьте оценки и следите за прогрессом.",
      action: { href: loginUrl(), text: "Войти" }
    }));
    tabs.forEach((tab) => (tab.disabled = true));
    return;
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => open(tab.dataset.kind)));
  open(state.kind);
}

init();
