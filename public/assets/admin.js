// Админка: сводка, тайтлы с главами и страницами, жалобы, пользователи и журнал действий.
// Права проверяет сервер в каждом запросе /api/admin/*, эта страница только показывает формы.
// Модератор видит только модерацию и голосования (разделы сообщества — в admin-community.js)

import { api, chaptersText, getMe, loginUrl, posterBackground, titlePicker, toast, TYPE_LABELS } from "./app.js";
import { loadCollections, loadModeration, loadPlatformStats, loadPolls, loadReports, loadTaxonomy } from "./admin-community.js";
import { initCatalogAdmin, loadCatalog, loadReviews } from "./admin-catalog.js";
import { initUniverseAdmin, loadUniverse } from "./admin-universe.js";
import { initStudioAdmin, loadForumCategories, loadGames, loadSiteSettings, loadStudioPosts } from "./admin-studio.js";

const $ = (selector) => document.querySelector(selector);

const adminLayout = $("#admin");
const denied = $("#denied");
const titleList = $("#titleList");
const titleForm = $("#titleForm");
const titleHeading = $("#titleFormHeading");
const titleMessage = $("#titleMessage");
const deleteTitleButton = $("#deleteTitleButton");
const viewTitleLink = $("#viewTitleLink");
const posterPreview = $("#posterPreview");
const chaptersSection = $("#chaptersSection");
const chapterForm = $("#chapterForm");
const chapterHeading = $("#chapterFormHeading");
const chapterCancel = $("#chapterCancel");
const chapterMessage = $("#chapterMessage");
const chapterList = $("#chapterList");
const coverField = $("#coverField");
const coverInput = $("#coverInput");
const coverRemove = $("#coverRemove");
const titleSearch = $("#titleSearch");
const titleTypeFilter = $("#titleTypeFilter");
const MAX_COVER_BYTES = 5 * 1024 * 1024;

const DEFAULT_COLORS = ["#1f2a4d", "#5d4a8a", "#e3b5c9"];
// Те же ограничения проверяет сервер (functions/_lib/admin.js)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 500;
const PARALLEL_UPLOADS = 3;
const SEARCH_DELAY = 250;

// Вошедший администратор: свой аккаунт в разделе «Пользователи» менять нельзя
let me = null;
let titles = [];
// Выбранный тайтл; null — форма нового тайтла
let current = null;
let titleFormReady = false;
let chapters = [];
// Номер главы в форме; null — новая глава
let editing = null;
let uploading = false;

const titleField = (name) => titleForm.elements.namedItem(name);
const chapterField = (name) => chapterForm.elements.namedItem(name);
const titleUrl = (id) => `/api/admin/titles/${id}`;
const chapterUrl = (number) => `${titleUrl(current.id)}/chapters/${number}`;

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function formatDate(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Дата и время в часовом поясе администратора */
function formatDateTime(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

/** Для поиска по тайтлам: регистр и «ё» не важны */
const normalize = (value) => value.toLowerCase().replaceAll("ё", "е").trim();

/** Пока идёт загрузка страниц, переключаться и менять главы нельзя: черновик остался бы недогруженным */
function busy() {
  if (uploading) toast("Дождитесь окончания загрузки страниц.");
  return uploading;
}

// ==================== РАЗДЕЛЫ ====================

const SECTIONS = ["dashboard", "games", "studio", "forum-categories", "site-settings", "catalog", "universe", "reviews", "titles", "taxonomy", "moderation", "polls", "collections", "complaints", "users", "audit"];
const MODERATOR_SECTIONS = ["reviews", "moderation", "polls"];

/** Разделы, доступные вошедшему: модератору — только модерация и голосования */
const allowedSections = () => (me?.isAdmin ? SECTIONS : MODERATOR_SECTIONS);

function showSection(name) {
  document.querySelectorAll("[data-panel]").forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
  document.querySelectorAll("[data-section]").forEach((link) => {
    if (link.dataset.section === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

/**
 * Адрес #раздел открывает раздел, #titles/5 — тайтл 5. После обновления страницы остаёшься там же.
 * Старые ссылки вида #5 ведут на тайтл
 */
async function route() {
  const hash = location.hash.slice(1);
  const oldTitle = /^\d+$/.test(hash) ? hash : null;
  const [name, id] = oldTitle ? ["titles", oldTitle] : hash.split("/");
  const allowed = allowedSections();
  const section = allowed.includes(name) ? name : allowed[0];
  showSection(section);

  if (section === "dashboard") loadDashboard();
  if (section === "games") loadGames();
  if (section === "studio") loadStudioPosts();
  if (section === "forum-categories") loadForumCategories();
  if (section === "site-settings") loadSiteSettings();
  if (section === "catalog") loadCatalog();
  if (section === "universe") loadUniverse(id);
  if (section === "reviews") loadReviews(true);
  if (section === "taxonomy") loadTaxonomy();
  if (section === "moderation") loadModeration();
  if (section === "polls") loadPolls();
  if (section === "collections") loadCollections();
  if (section === "complaints") loadComplaints();
  if (section === "users") loadUsers();
  if (section === "audit") loadAudit();
  if (section === "titles") {
    const wanted = Number(id);
    if (id && titles.some((title) => title.id === wanted)) {
      if (current?.id !== wanted) await selectTitle(wanted);
    } else if (!titleFormReady) {
      await selectTitle(null);
    } else {
      // Вернулись в раздел: остаётся тот тайтл, что был открыт
      history.replaceState(null, "", current ? `#titles/${current.id}` : "#titles");
    }
  }
}

window.addEventListener("hashchange", route);

// ==================== СВОДКА ====================

const statsBox = $("#stats");
const recentAudit = $("#recentAudit");

function statCard(label, value, note, alert = false) {
  const card = element("div", `admin-stat${alert ? " is-alert" : ""}`);
  card.append(element("span", null, label), element("strong", null, String(value)), element("small", null, note));
  return card;
}

async function loadDashboard() {
  loadPlatformStats();
  const [stats, recent] = await Promise.all([api("/api/admin/stats"), api("/api/admin/audit?limit=8")]);
  if (!stats.ok) {
    setMessage($("#statsMessage"), stats.data?.error || "Не удалось загрузить сводку.");
  } else {
    setMessage($("#statsMessage"), "");
    const { users, content, complaints, storage } = stats.data;
    statsBox.replaceChildren(
      statCard("Пользователи", users.total, `+${users.week} за 7 дней · +${users.month} за 30 дней`),
      statCard("Администраторы", users.admins, users.blocked ? `заблокировано: ${users.blocked}` : "заблокированных нет"),
      statCard("Тайтлы", content.titles, `глав: ${content.chapters}`),
      statCard("Главы со страницами", content.uploaded, `страниц: ${content.pages}`),
      statCard("Новые жалобы", complaints.new, `всего: ${complaints.total}`, complaints.new > 0),
      storage
        ? statCard("Файлы в R2", `${storage.complete ? "" : "больше "}${formatBytes(storage.bytes)}`, `файлов: ${storage.files}`)
        : statCard("Файлы в R2", "—", "хранилище не подключено")
    );
    updateComplaintsBadge(complaints.new);
  }
  renderAudit(recentAudit, recent.ok ? recent.data.entries : []);
}

// ==================== ТАЙТЛЫ ====================

/** Тайтлы под поиском и фильтром типа в списке слева */
function visibleTitles() {
  const query = normalize(titleSearch.value);
  const type = titleTypeFilter.value;
  return titles.filter((title) => (!type || title.type === type) && (!query || normalize(title.title).includes(query)));
}

function renderTitles() {
  const shown = visibleTitles();
  $("#titleCount").textContent = titles.length ? `Показано ${shown.length} из ${titles.length}` : "";
  if (!shown.length) {
    titleList.replaceChildren(element("li", "admin-empty", titles.length ? "Ничего не найдено." : "Тайтлов пока нет."));
    return;
  }
  titleList.replaceChildren(...shown.map((title) => {
    const item = element("li");
    const node = button("", "admin-title-item", () => selectTitle(title.id));
    node.setAttribute("aria-current", String(title.id === current?.id));
    node.append(element("strong", null, title.title), element("small", null, `${TYPE_LABELS[title.type]} · ${chaptersText(title.chapters)}`));
    item.append(node);
    return item;
  }));
}

let titleSearchTimer = null;
titleSearch.addEventListener("input", () => {
  clearTimeout(titleSearchTimer);
  titleSearchTimer = setTimeout(renderTitles, SEARCH_DELAY);
});
titleTypeFilter.addEventListener("change", renderTitles);

function posterColors(poster) {
  const found = poster?.match(/#[0-9a-f]{6}/gi) || [];
  return found.length >= 3 ? found.slice(0, 3) : DEFAULT_COLORS;
}

function updatePreview() {
  const [c0, c1, c2] = [0, 1, 2].map((i) => titleField(`color${i}`).value);
  const poster = `linear-gradient(145deg, ${c0}, ${c1} 55%, ${c2})`;
  const cover = current?.cover || null;
  posterPreview.style.background = posterBackground({ cover, poster });
  posterPreview.textContent = cover ? "" : titleField("symbol").value.trim();
}

/** Обложку можно загрузить только у сохранённого тайтла: ключ в R2 строится по его id */
function renderCover() {
  coverField.hidden = !current;
  coverRemove.hidden = !current?.cover;
}

function replaceCurrent(saved) {
  current = { ...saved, chapters: current?.chapters ?? saved.chapters };
  titles = titles.map((title) => (title.id === current.id ? current : title));
  renderTitles();
  renderCover();
  updatePreview();
}

coverInput.addEventListener("change", async () => {
  const file = coverInput.files[0];
  coverInput.value = "";
  if (!file || !current) return;
  if (!IMAGE_TYPES.includes(file.type)) return setMessage(titleMessage, "Обложка должна быть картинкой JPEG, PNG, WebP или AVIF.");
  if (file.size > MAX_COVER_BYTES) return setMessage(titleMessage, "Обложка должна быть не больше 5 МБ.");

  setMessage(titleMessage, "Загружаю обложку…");
  let response = null;
  try {
    response = await fetch(`${titleUrl(current.id)}/cover`, {
      method: "PUT",
      body: file,
      credentials: "same-origin",
      headers: { "Content-Type": file.type }
    });
  } catch {}
  const data = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return setMessage(titleMessage, data?.error || "Не удалось загрузить обложку.");
  replaceCurrent(data.title);
  setMessage(titleMessage, "Обложка загружена.", true);
});

coverRemove.addEventListener("click", async () => {
  if (!current?.cover || !confirm("Убрать обложку? Вместо неё будет градиент с символом.")) return;
  const result = await api(`${titleUrl(current.id)}/cover`, { method: "DELETE" });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось убрать обложку.");
  replaceCurrent(result.data.title);
  setMessage(titleMessage, "Обложка убрана.", true);
});

function fillTitleForm(title) {
  titleField("title").value = title?.title ?? "";
  titleField("type").value = title?.type ?? "manhwa";
  titleField("status").value = title?.status ?? "ongoing";
  titleField("year").value = String(title?.year ?? new Date().getFullYear());
  titleField("rating").value = String(title?.rating ?? 8);
  titleField("genres").value = title?.genres.join(", ") ?? "";
  titleField("author").value = title?.author ?? "";
  titleField("translator").value = title?.translator ?? "";
  titleField("symbol").value = title?.symbol ?? "✦";
  posterColors(title?.poster).forEach((color, i) => (titleField(`color${i}`).value = color.toLowerCase()));
  titleField("description").value = title?.description ?? "";
  titleField("originalTitle").value = title?.originalTitle ?? "";
  titleField("releaseDay").value = title?.releaseDay === null || title?.releaseDay === undefined ? "" : String(title.releaseDay);
  updatePreview();

  titleHeading.textContent = title ? title.title : "Новый тайтл";
  deleteTitleButton.hidden = !title;
  viewTitleLink.hidden = !title;
  if (title) viewTitleLink.href = `/title/${title.id}`;
}

async function selectTitle(id) {
  if (busy()) return;
  titleFormReady = true;
  current = titles.find((title) => title.id === id) || null;
  history.replaceState(null, "", current ? `#titles/${current.id}` : "#titles");
  fillTitleForm(current);
  renderCover();
  renderTitles();
  setMessage(titleMessage, "");
  setMessage(chapterMessage, "");
  chaptersSection.hidden = !current;
  charactersSection.hidden = !current;
  relationsSection.hidden = !current;
  resetChapterForm();
  resetCharacterForm();
  setMessage(characterMessage, "");
  setMessage(relationMessage, "");
  if (current) await Promise.all([loadChapters(), loadTitleDetails()]);
  else applyDetails({ tags: [], sources: [], characters: [], relations: [] });
}

// ==================== ТЕГИ, ИСТОЧНИКИ, ПЕРСОНАЖИ И СВЯЗИ ====================

const tagPicker = $("#tagPicker");
const sourceList = $("#sourceList");
const charactersSection = $("#charactersSection");
const characterList = $("#characterList");
const characterForm = $("#characterForm");
const characterCancel = $("#characterCancel");
const characterMessage = $("#characterMessage");
const relationsSection = $("#relationsSection");
const relationList = $("#relationList");
const relationKind = $("#relationKind");
const relationMessage = $("#relationMessage");
const TAG_CATEGORIES = { mood: "Атмосфера", hero: "Главный герой", plot: "Сюжет", theme: "Темы", setting: "Мир" };
const SOURCE_KINDS = { official: "Официально", publisher: "Издатель", store: "Магазин", licensed: "Лицензия" };
const ROLE_LABELS = { main: "Главный герой", supporting: "Второстепенный", antagonist: "Антагонист" };
const RELATION_LABELS = { similar: "Похожее", sequel: "Продолжение", prequel: "Предыстория", spin_off: "Спин-офф", same_universe: "Тот же мир" };
const MAX_SOURCES = 10;

// Все теги платформы; вес выбранных у текущего тайтла: code → 1..3
let allTags = [];
let tagWeights = new Map();
let characters = [];
// Персонаж в форме; null — новый
let editingCharacter = null;
// Связи текущего тайтла: [{ id, title, kind }]
let relations = [];

async function loadTags() {
  const result = await api("/api/admin/tags");
  allTags = result.ok ? result.data.tags : [];
  renderTagPicker();
}

function renderTagPicker() {
  if (!allTags.length) {
    tagPicker.replaceChildren(element("p", "admin-hint", "Теги не загрузились. Обновите страницу."));
    return;
  }
  const groups = Object.entries(TAG_CATEGORIES).map(([category, label]) => {
    const group = element("div", "admin-tag-group");
    group.append(element("span", "admin-tag-group-label", label));
    for (const item of allTags.filter((tagItem) => tagItem.category === category)) {
      const weight = tagWeights.get(item.code) || 0;
      const chip = button(weight ? `${item.name} · ${weight}` : item.name, `admin-tag-chip${weight ? ` is-w${weight}` : ""}`, () => {
        const next = ((tagWeights.get(item.code) || 0) + 1) % 4;
        if (next) tagWeights.set(item.code, next);
        else tagWeights.delete(item.code);
        renderTagPicker();
        tagPicker.querySelector(`[data-code="${item.code}"]`)?.focus();
      });
      chip.dataset.code = item.code;
      chip.setAttribute("aria-pressed", String(weight > 0));
      chip.setAttribute("aria-label", `${item.name}: ${weight ? `вес ${weight}` : "не выбран"}`);
      group.append(chip);
    }
    return group;
  });
  tagPicker.replaceChildren(...groups);
}

function sourceRow(source = { name: "", url: "", kind: "official" }) {
  const row = element("div", "admin-source-row");
  const name = element("input", "input");
  name.value = source.name;
  name.maxLength = 80;
  name.placeholder = "Название площадки";
  name.setAttribute("aria-label", "Название источника");
  name.dataset.part = "name";
  const url = element("input", "input");
  url.type = "url";
  url.value = source.url;
  url.maxLength = 500;
  url.placeholder = "https://…";
  url.setAttribute("aria-label", "Ссылка на источник");
  url.dataset.part = "url";
  const kind = element("select", "select");
  kind.setAttribute("aria-label", "Вид источника");
  kind.dataset.part = "kind";
  kind.append(...Object.entries(SOURCE_KINDS).map(([value, label]) => {
    const option = element("option", null, label);
    option.value = value;
    return option;
  }));
  kind.value = source.kind;
  const remove = button("Убрать", "secondary-button", () => {
    row.remove();
    updateSourceButton();
  });
  remove.setAttribute("aria-label", "Убрать источник");
  row.append(name, url, kind, remove);
  return row;
}

function updateSourceButton() {
  $("#addSource").disabled = sourceList.children.length >= MAX_SOURCES;
}

$("#addSource").addEventListener("click", () => {
  if (sourceList.children.length >= MAX_SOURCES) return;
  const row = sourceRow();
  sourceList.append(row);
  updateSourceButton();
  row.querySelector("input").focus();
});

/** Источники из формы; пустые строки пропускаются */
function formSources() {
  return [...sourceList.children].map((row) => ({
    name: row.querySelector("[data-part=name]").value.trim(),
    url: row.querySelector("[data-part=url]").value.trim(),
    kind: row.querySelector("[data-part=kind]").value
  })).filter((source) => source.name || source.url);
}

function applyDetails({ tags, sources, characters: list, relations: links }) {
  tagWeights = new Map(tags.map((item) => [item.code, item.weight]));
  renderTagPicker();
  sourceList.replaceChildren(...sources.map(sourceRow));
  updateSourceButton();
  characters = list;
  renderCharacters();
  relations = links.map((link) => ({ id: link.id, kind: link.kind, title: titles.find((title) => title.id === link.id)?.title || `#${link.id}` }));
  renderRelations();
}

async function loadTitleDetails() {
  const id = current.id;
  const result = await api(titleUrl(id));
  if (current?.id !== id) return;
  if (!result.ok) {
    setMessage(titleMessage, result.data?.error || "Не удалось загрузить теги и источники.");
    applyDetails({ tags: [], sources: [], characters: [], relations: [] });
    return;
  }
  applyDetails(result.data);
}

// Персонажи

function renderCharacters() {
  characterList.replaceChildren(...(characters.length ? characters.map((character) => {
    const item = element("li", "admin-plain-item");
    const info = element("div", "admin-plain-info");
    info.append(
      element("strong", null, `${character.symbol} ${character.name}`),
      element("small", null, `${ROLE_LABELS[character.role]}${character.description ? ` · ${character.description}` : ""}`)
    );
    const actions = element("div", "admin-chapter-actions");
    actions.append(
      button("Изменить", "secondary-button", () => editCharacter(character)),
      button("Удалить", "danger-button", () => deleteCharacter(character))
    );
    item.append(info, actions);
    return item;
  }) : [element("li", "admin-empty", "Персонажей пока нет.")]));
}

function resetCharacterForm() {
  editingCharacter = null;
  characterForm.reset();
  $("#characterFormHeading").textContent = "Новый персонаж";
  characterForm.querySelector("[type=submit]").textContent = "Добавить персонажа";
  characterCancel.hidden = true;
}

function editCharacter(character) {
  editingCharacter = character.id;
  const field = (name) => characterForm.elements.namedItem(name);
  field("name").value = character.name;
  field("role").value = character.role;
  field("symbol").value = character.symbol;
  field("description").value = character.description || "";
  $("#characterFormHeading").textContent = character.name;
  characterForm.querySelector("[type=submit]").textContent = "Сохранить персонажа";
  characterCancel.hidden = false;
  field("name").focus();
}

characterCancel.addEventListener("click", resetCharacterForm);

characterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current) return;
  const field = (name) => characterForm.elements.namedItem(name).value;
  const body = { name: field("name"), role: field("role"), symbol: field("symbol").trim() || "✦", description: field("description") };
  const isNew = editingCharacter === null;
  const result = isNew
    ? await api(`${titleUrl(current.id)}/characters`, { method: "POST", body })
    : await api(`/api/admin/characters/${editingCharacter}`, { method: "PUT", body });
  if (!result.ok) return setMessage(characterMessage, result.data?.error || "Не удалось сохранить персонажа.");
  if (isNew) characters = result.data.characters;
  else characters = characters.map((character) => (character.id === result.data.character.id ? result.data.character : character));
  resetCharacterForm();
  renderCharacters();
  setMessage(characterMessage, isNew ? "Персонаж добавлен." : "Персонаж сохранён.", true);
});

async function deleteCharacter(character) {
  if (!confirm(`Удалить персонажа «${character.name}»? Варианты в прошедших голосованиях сохранят его имя.`)) return;
  const result = await api(`/api/admin/characters/${character.id}`, { method: "DELETE" });
  if (!result.ok) return setMessage(characterMessage, result.data?.error || "Не удалось удалить персонажа.");
  characters = characters.filter((item) => item.id !== character.id);
  if (editingCharacter === character.id) resetCharacterForm();
  renderCharacters();
  setMessage(characterMessage, `Персонаж «${character.name}» удалён.`, true);
}

// Связи

function renderRelations() {
  relationList.replaceChildren(...(relations.length ? relations.map((relation, index) => {
    const item = element("li", "admin-plain-item");
    const info = element("div", "admin-plain-info");
    info.append(element("strong", null, relation.title), element("small", null, RELATION_LABELS[relation.kind]));
    item.append(info, button("Убрать", "secondary-button", () => {
      relations.splice(index, 1);
      renderRelations();
      setMessage(relationMessage, "Связь убрана. Нажмите «Сохранить связи».");
    }));
    return item;
  }) : [element("li", "admin-empty", "Связей пока нет. Nexus всё равно найдёт похожие тайтлы по тегам и жанрам.")]));
}

$("#relationPicker").append(titlePicker({
  placeholder: "Найти тайтл для связи…",
  label: "Найти тайтл для связи",
  id: "relationSearch",
  onPick: (title) => {
    if (!current) return;
    if (title.id === current.id) return setMessage(relationMessage, "Тайтл не может ссылаться сам на себя.");
    const existing = relations.find((relation) => relation.id === title.id);
    if (existing) existing.kind = relationKind.value;
    else relations.push({ id: title.id, title: title.title, kind: relationKind.value });
    renderRelations();
    setMessage(relationMessage, "Связь добавлена. Нажмите «Сохранить связи».");
  }
}).root);

$("#relationsSave").addEventListener("click", async () => {
  if (!current) return;
  const result = await api(`${titleUrl(current.id)}/relations`, {
    method: "PUT", body: { relations: relations.map((relation) => ({ titleId: relation.id, kind: relation.kind })) }
  });
  if (!result.ok) return setMessage(relationMessage, result.data?.error || "Не удалось сохранить связи.");
  setMessage(relationMessage, "Связи сохранены.", true);
});

titleForm.addEventListener("input", (event) => {
  if (event.target.name === "symbol" || event.target.type === "color") updatePreview();
});

titleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    title: titleField("title").value,
    type: titleField("type").value,
    status: titleField("status").value,
    year: Number(titleField("year").value),
    rating: Number(titleField("rating").value.replace(",", ".")),
    genres: titleField("genres").value.split(","),
    author: titleField("author").value,
    translator: titleField("translator").value,
    symbol: titleField("symbol").value,
    colors: [0, 1, 2].map((i) => titleField(`color${i}`).value),
    description: titleField("description").value,
    originalTitle: titleField("originalTitle").value,
    releaseDay: titleField("releaseDay").value === "" ? null : Number(titleField("releaseDay").value),
    sources: formSources()
  };
  // Если теги не загрузились, они не отправляются и на сервере остаются прежними
  if (allTags.length) body.tags = [...tagWeights].map(([code, weight]) => ({ code, weight }));
  const isNew = !current;
  const result = isNew
    ? await api("/api/admin/titles", { method: "POST", body })
    : await api(titleUrl(current.id), { method: "PUT", body });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось сохранить тайтл.");

  const saved = result.data.title;
  titles = isNew ? [...titles, saved] : titles.map((title) => (title.id === saved.id ? saved : title));
  await selectTitle(saved.id);
  setMessage(titleMessage, isNew ? "Тайтл создан. Теперь добавьте главы." : "Тайтл сохранён.", true);
});

deleteTitleButton.addEventListener("click", async () => {
  if (!current || busy()) return;
  if (!confirm(`Удалить «${current.title}» вместе со всеми главами, страницами и отметками читателей? Это нельзя отменить.`)) return;
  const result = await api(titleUrl(current.id), { method: "DELETE" });
  if (!result.ok) return setMessage(titleMessage, result.data?.error || "Не удалось удалить тайтл.");
  const removed = current.title;
  titles = titles.filter((title) => title.id !== current.id);
  await selectTitle(null);
  setMessage(titleMessage, `Тайтл «${removed}» удалён.`, true);
});

$("#newTitleButton").addEventListener("click", async () => {
  await selectTitle(null);
  titleField("title").focus();
});

// ==================== ГЛАВЫ ====================

async function loadChapters() {
  const result = await api(`${titleUrl(current.id)}/chapters`);
  if (!result.ok) {
    chapters = [];
    setMessage(chapterMessage, result.data?.error || "Не удалось загрузить главы.");
  } else {
    chapters = result.data.chapters;
  }
  // Число глав в списке тайтлов слева
  current = { ...current, chapters: chapters.length ? chapters[0].number : 0 };
  titles = titles.map((title) => (title.id === current.id ? current : title));
  renderTitles();
  renderChapters();
}

function renderChapters() {
  if (!chapters.length) {
    chapterList.replaceChildren(element("li", "admin-empty", "Глав пока нет. Добавьте первую главу формой выше."));
    return;
  }
  // Главы приходят новыми сверху: первая в списке — последняя по номеру
  const last = chapters[0].number;
  chapterList.replaceChildren(...chapters.map((chapter) => chapterRow(chapter, chapter.number === last)));
}

function chapterRow(chapter, isLast) {
  const item = element("li", "admin-chapter");

  const info = element("div", "admin-chapter-info");
  const label = `${chapter.sideStory ? "Экстра · " : ""}Глава ${chapter.number}${chapter.name ? `: ${chapter.name}` : ""}`;
  const details = [
    chapter.volume ? `Том ${chapter.volume}` : "",
    formatDate(chapter.releasedAt),
    chapter.pages ? `Страниц: ${chapter.pages}` : "Страницы не загружены"
  ].filter(Boolean).join(" · ");
  info.append(element("strong", null, label), element("small", chapter.pages ? null : "admin-warning", details));

  const actions = element("div", "admin-chapter-actions");
  const upload = element("label", "secondary-button admin-upload", chapter.pages ? "Заменить страницы" : "Загрузить страницы");
  const input = element("input", "visually-hidden");
  input.type = "file";
  input.multiple = true;
  input.accept = IMAGE_TYPES.join(",");
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) uploadPages(chapter, item, files);
  });
  upload.append(input);

  actions.append(button("Изменить", "secondary-button", () => editChapter(chapter)), upload);
  if (chapter.pages) {
    const link = element("a", "secondary-button", "Читать");
    link.href = `/read/${current.id}/${chapter.number}`;
    link.target = "_blank";
    link.rel = "noopener";
    actions.append(link, button("Убрать страницы", "secondary-button", () => removePages(chapter)));
  }
  if (isLast) actions.append(button("Удалить главу", "danger-button", () => deleteChapter(chapter)));

  const progress = element("p", "admin-progress");
  progress.setAttribute("role", "status");
  progress.hidden = true;

  item.append(info, actions, progress);
  return item;
}

function resetChapterForm() {
  editing = null;
  chapterForm.reset();
  chapterHeading.textContent = "Новая глава";
  chapterForm.querySelector("[type=submit]").textContent = "Добавить главу";
  chapterCancel.hidden = true;
}

function editChapter(chapter) {
  if (busy()) return;
  editing = chapter.number;
  chapterField("name").value = chapter.name ?? "";
  chapterField("volume").value = chapter.volume ? String(chapter.volume) : "";
  chapterField("releasedAt").value = chapter.releasedAt.slice(0, 10);
  chapterField("sideStory").checked = chapter.sideStory;
  chapterHeading.textContent = `Глава ${chapter.number}`;
  chapterForm.querySelector("[type=submit]").textContent = "Сохранить главу";
  chapterCancel.hidden = false;
  chapterForm.scrollIntoView({ behavior: "smooth", block: "center" });
  chapterField("name").focus({ preventScroll: true });
}

chapterCancel.addEventListener("click", resetChapterForm);

chapterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy()) return;
  const volume = chapterField("volume").value.trim();
  const body = {
    name: chapterField("name").value,
    volume: volume ? Number(volume) : null,
    releasedAt: chapterField("releasedAt").value || null,
    sideStory: chapterField("sideStory").checked
  };
  const isNew = editing === null;
  const result = isNew
    ? await api(`${titleUrl(current.id)}/chapters`, { method: "POST", body })
    : await api(chapterUrl(editing), { method: "PUT", body });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось сохранить главу.");

  const { number } = result.data.chapter;
  resetChapterForm();
  await loadChapters();
  setMessage(chapterMessage, isNew ? `Глава ${number} добавлена. Загрузите её страницы.` : `Глава ${number} сохранена.`, true);
});

async function deleteChapter(chapter) {
  if (busy()) return;
  if (!confirm(`Удалить главу ${chapter.number} вместе со страницами? Это нельзя отменить.`)) return;
  const result = await api(chapterUrl(chapter.number), { method: "DELETE" });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось удалить главу.");
  if (editing === chapter.number) resetChapterForm();
  await loadChapters();
  setMessage(chapterMessage, `Глава ${chapter.number} удалена.`, true);
}

async function removePages(chapter) {
  if (busy()) return;
  if (!confirm(`Убрать загруженные страницы главы ${chapter.number}? Файлы будут удалены.`)) return;
  const result = await api(`${chapterUrl(chapter.number)}/pages`, { method: "DELETE" });
  if (!result.ok) return setMessage(chapterMessage, result.data?.error || "Не удалось убрать страницы.");
  await loadChapters();
  setMessage(chapterMessage, `Страницы главы ${chapter.number} убраны.`, true);
}

// ==================== ЗАГРУЗКА СТРАНИЦ ====================

/** Размер первой страницы: по нему читалка задаёт width/height у картинок */
async function imageSize(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // Браузер не умеет читать этот формат: читалка возьмёт стандартный размер
    return null;
  }
}

async function putPage(chapterNumber, page, file) {
  const url = `${chapterUrl(chapterNumber)}/pages/${page}`;
  let response = null;
  // Одна повторная попытка: на мобильном интернете запрос иногда обрывается
  for (let attempt = 1; attempt <= 2 && !response; attempt++) {
    try {
      response = await fetch(url, { method: "PUT", body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
    } catch {}
  }
  if (!response) throw new Error(`Страница ${page} (${file.name}): нет связи с сервером.`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(`Страница ${page} (${file.name}): ${data?.error || "не загрузилась."}`);
  }
}

/**
 * Страницы грузятся в черновик (следующую версию) по несколько штук сразу и публикуются одним запросом.
 * Если загрузка оборвалась, читатели продолжают видеть прежние страницы
 */
async function uploadPages(chapter, row, files) {
  if (busy()) return;
  files.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }));
  const problem = files.length > MAX_PAGES ? `В главе не больше ${MAX_PAGES} страниц.`
    : files.some((file) => !IMAGE_TYPES.includes(file.type)) ? "Подходят только картинки JPEG, PNG, WebP и AVIF."
    : files.some((file) => file.size > MAX_PAGE_BYTES) ? "Каждая страница должна быть не больше 15 МБ."
    : "";
  if (problem) return setMessage(chapterMessage, problem);
  if (chapter.pages && !confirm(`Заменить страницы главы ${chapter.number} (сейчас ${chapter.pages}) на ${files.length} новых?`)) return;

  uploading = true;
  setMessage(chapterMessage, "");
  const progress = row.querySelector(".admin-progress");
  progress.hidden = false;
  let done = 0;
  const showProgress = () => (progress.textContent = `Загружено ${done} из ${files.length}…`);
  showProgress();

  try {
    const size = await imageSize(files[0]);
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && next < files.length) {
        const index = next++;
        try {
          await putPage(chapter.number, index + 1, files[index]);
        } catch (err) {
          failed = true;
          throw err;
        }
        done++;
        showProgress();
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL_UPLOADS, files.length) }, worker));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    progress.textContent = "Публикую…";
    const result = await api(`${chapterUrl(chapter.number)}/publish`, {
      method: "POST",
      body: { version: chapter.pagesVersion + 1, pages: files.length, width: size?.width ?? null, height: size?.height ?? null }
    });
    if (!result.ok) throw new Error(result.data?.error || "Не удалось опубликовать страницы.");

    uploading = false;
    await loadChapters();
    setMessage(chapterMessage, `Глава ${chapter.number}: опубликовано страниц — ${files.length}.`, true);
  } catch (err) {
    progress.hidden = true;
    setMessage(chapterMessage, `${err.message} Читатели по-прежнему видят прежние страницы.`);
  } finally {
    uploading = false;
  }
}

window.addEventListener("beforeunload", (event) => {
  if (uploading) event.preventDefault();
});

// ==================== ЖАЛОБЫ ====================

const complaintList = $("#complaintList");
const complaintsMessage = $("#complaintsMessage");
const complaintsBadge = $("#complaintsBadge");
const COMPLAINT_LABELS = { new: "Новая", resolved: "Материал удалён", rejected: "Отклонена" };
let complaints = [];

function updateComplaintsBadge(count) {
  complaintsBadge.hidden = !count;
  complaintsBadge.textContent = String(count);
  complaintsBadge.setAttribute("aria-label", `новых: ${count}`);
}

function complaintRow(complaint) {
  const item = element("li", `admin-complaint${complaint.status === "new" ? " is-new" : ""}`);

  const header = element("header");
  header.append(
    element("strong", null, `№${complaint.id} · ${COMPLAINT_LABELS[complaint.status]}`),
    element("small", null, formatDate(complaint.createdAt))
  );

  // Текст жалобы пришёл от посетителя сайта: только textContent, никакого HTML
  const details = element("dl");
  const add = (label, value) => {
    const dd = element("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    details.append(element("dt", null, label), dd);
  };
  add("Заявитель", complaint.name);
  const mail = element("a", null, complaint.email);
  mail.href = `mailto:${encodeURIComponent(complaint.email).replace("%40", "@")}`;
  add("Почта", mail);
  add("Правообладатель", complaint.rightholder);
  add("Произведение", complaint.work);
  const links = element("div");
  for (const href of complaint.links) {
    // Сервер принимает только ссылки на этот сайт, но открываем их всё равно без доступа к этой вкладке
    const link = element("a", null, href);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link, element("br"));
  }
  add("Ссылки", links);

  const actions = element("div", "admin-chapter-actions");
  for (const [status, label] of Object.entries(COMPLAINT_LABELS)) {
    if (status === complaint.status) continue;
    const text = status === "new" ? "Вернуть в новые" : label;
    actions.append(button(text, "secondary-button", () => setComplaintStatus(complaint, status)));
  }
  actions.append(button("Удалить жалобу", "danger-button", () => deleteComplaint(complaint)));

  item.append(header, details, element("p", "admin-complaint-text", complaint.description), actions);
  return item;
}

function renderComplaints() {
  const fresh = complaints.filter((complaint) => complaint.status === "new").length;
  $("#complaintsHeading").textContent = fresh ? `Жалобы правообладателей (новых: ${fresh})` : "Жалобы правообладателей";
  updateComplaintsBadge(fresh);
  complaintList.replaceChildren(
    ...(complaints.length ? complaints.map(complaintRow) : [element("li", "admin-empty", "Жалоб нет.")])
  );
}

async function loadComplaints() {
  const result = await api("/api/admin/complaints");
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось загрузить жалобы.");
  complaints = result.data.complaints;
  renderComplaints();
}

async function setComplaintStatus(complaint, status) {
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "PUT", body: { status } });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось изменить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id}: ${COMPLAINT_LABELS[status].toLowerCase()}.`, true);
  await loadComplaints();
}

async function deleteComplaint(complaint) {
  if (!confirm(`Удалить жалобу №${complaint.id} с данными заявителя? Это нельзя отменить.`)) return;
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "DELETE" });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось удалить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id} удалена.`, true);
  await loadComplaints();
}

// ==================== ПОДТВЕРЖДЕНИЕ ПАРОЛЕМ ====================

const passwordDialog = $("#passwordDialog");
const passwordInput = $("#passwordInput");

/** Пароль администратора для опасного действия или null, если окно закрыли. Проверяет пароль сервер */
function askPassword(text) {
  return new Promise((resolve) => {
    $("#passwordDialogText").textContent = text;
    $("#passwordUsername").value = me.email;
    passwordInput.value = "";
    passwordDialog.returnValue = "";
    passwordDialog.addEventListener("close", () => {
      const value = passwordDialog.returnValue === "confirm" ? passwordInput.value : null;
      // Пароль не остаётся в поле после закрытия окна
      passwordInput.value = "";
      resolve(value || null);
    }, { once: true });
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

// ==================== ПОЛЬЗОВАТЕЛИ ====================

const userList = $("#userList");
const userSearch = $("#userSearch");
const userFilter = $("#userFilter");
const usersMessage = $("#usersMessage");
const usersMore = $("#usersMore");
const USERS_PAGE = 50;
let users = [];
let usersTotal = 0;
// Ответ на устаревший запрос (фильтр успели сменить) отбрасывается
let usersRequest = 0;

function usersUrl(offset) {
  const params = new URLSearchParams({ filter: userFilter.value, limit: String(USERS_PAGE), offset: String(offset) });
  const query = userSearch.value.trim();
  if (query) params.set("q", query);
  return `/api/admin/users?${params}`;
}

function tag(text, className = "") {
  return element("span", `admin-tag ${className}`.trim(), text);
}

function userRow(user) {
  const item = element("li", `admin-user${user.blockedAt ? " is-blocked" : ""}`);

  const info = element("div", "admin-user-info");
  const name = element("strong", null, user.name);
  const tags = element("span", "admin-tags");
  if (user.id === me.id) tags.append(tag("Это вы", "is-self"));
  if (user.isAdmin) tags.append(tag("Администратор", "is-admin"));
  if (user.role === "moderator") tags.append(tag("Модератор", "is-moderator"));
  if (user.blockedAt) tags.append(tag(`Заблокирован ${formatDate(user.blockedAt)}`, "is-blocked"));
  if (user.mutedUntil && new Date(`${user.mutedUntil.replace(" ", "T")}Z`) > new Date()) {
    tags.append(tag(`Без публикаций до ${formatDate(user.mutedUntil)}`, "is-blocked"));
  }
  info.append(
    name,
    tags,
    element("small", null, user.email),
    element("small", null, `#${user.id} · с ${formatDate(user.createdAt)} · сеансов: ${user.sessions} · на полке: ${user.library}`)
  );

  const actions = element("div", "admin-chapter-actions");
  // Свой аккаунт меняется только в профиле: так нельзя случайно снять права с себя
  if (user.id !== me.id) {
    if (user.blockedAt) {
      actions.append(button("Разблокировать", "secondary-button", () => userAction(user, "unblock")));
    } else if (!user.isAdmin) {
      actions.append(button("Заблокировать", "secondary-button", () => userAction(user, "block")));
    }
    if (user.sessions > 0) actions.append(button("Завершить сеансы", "secondary-button", () => userAction(user, "logout")));
    if (user.isAdmin) actions.append(button("Снять права администратора", "secondary-button", () => userAction(user, "revokeAdmin")));
    else if (!user.blockedAt) actions.append(button("Сделать администратором", "secondary-button", () => userAction(user, "grantAdmin")));
    if (user.role === "moderator") actions.append(button("Снять права модератора", "secondary-button", () => setRole(user, "user")));
    else if (user.role === "user" && !user.blockedAt) actions.append(button("Сделать модератором", "secondary-button", () => setRole(user, "moderator")));
    if (user.mutedUntil && new Date(`${user.mutedUntil.replace(" ", "T")}Z`) > new Date()) {
      actions.append(button("Снять ограничение", "secondary-button", () => unmute(user)));
    }
    if (!user.isAdmin) actions.append(button("Удалить аккаунт", "danger-button", () => deleteUser(user)));
  }

  item.append(info, actions);
  return item;
}

function renderUsers() {
  $("#userCount").textContent = `Найдено: ${usersTotal}`;
  userList.replaceChildren(...(users.length ? users.map(userRow) : [element("li", "admin-empty", "Никого не найдено.")]));
  usersMore.hidden = users.length >= usersTotal;
}

async function loadUsers() {
  const id = ++usersRequest;
  const result = await api(usersUrl(0));
  if (id !== usersRequest) return;
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось загрузить пользователей.");
  users = result.data.users;
  usersTotal = result.data.total;
  renderUsers();
}

usersMore.addEventListener("click", async () => {
  const id = usersRequest;
  usersMore.disabled = true;
  const result = await api(usersUrl(users.length));
  usersMore.disabled = false;
  if (id !== usersRequest) return;
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось загрузить пользователей.");
  // Пока листали, могли зарегистрироваться новые пользователи: повторы убираем
  const known = new Set(users.map((user) => user.id));
  users = [...users, ...result.data.users.filter((user) => !known.has(user.id))];
  usersTotal = result.data.total;
  renderUsers();
});

let userSearchTimer = null;
userSearch.addEventListener("input", () => {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(loadUsers, SEARCH_DELAY);
});
userFilter.addEventListener("change", loadUsers);

const USER_ACTIONS = {
  block: { confirm: (user) => `Заблокировать ${user.email}? Все сеансы пользователя сразу завершатся, войти он не сможет.`, done: "заблокирован" },
  unblock: { done: "разблокирован" },
  logout: { confirm: (user) => `Завершить все сеансы ${user.email}? На всех устройствах нужно будет войти заново.`, done: "сеансы завершены" },
  grantAdmin: { password: (user) => `Выдать ${user.email} права администратора? У него будет доступ ко всей админке.`, done: "теперь администратор" },
  revokeAdmin: { password: (user) => `Снять с ${user.email} права администратора?`, done: "больше не администратор" }
};

function replaceUser(saved) {
  users = users.map((user) => (user.id === saved.id ? saved : user));
  renderUsers();
}

async function userAction(user, action) {
  const config = USER_ACTIONS[action];
  if (config.confirm && !confirm(config.confirm(user))) return;
  let password;
  if (config.password) {
    password = await askPassword(config.password(user));
    if (!password) return;
  }
  const result = await api(`/api/admin/users/${user.id}`, { method: "PUT", body: { action, password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось выполнить действие.");
  replaceUser(result.data.user);
  setMessage(usersMessage, `${user.email}: ${config.done}.`, true);
}

const ROLE_TEXTS = {
  moderator: { ask: (user) => `Сделать ${user.email} модератором? Он сможет скрывать контент, разбирать жалобы и вести голосования.`, done: "теперь модератор" },
  user: { ask: (user) => `Снять с ${user.email} права модератора?`, done: "больше не модератор" }
};

async function setRole(user, role) {
  const text = ROLE_TEXTS[role];
  const password = await askPassword(text.ask(user));
  if (!password) return;
  const result = await api(`/api/admin/users/${user.id}/role`, { method: "PUT", body: { role, password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось изменить роль.");
  replaceUser(result.data.user);
  setMessage(usersMessage, `${user.email}: ${text.done}.`, true);
}

async function unmute(user) {
  const result = await api(`/api/moderation/users/${user.id}/unmute`, { method: "POST" });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось снять ограничение.");
  replaceUser({ ...user, mutedUntil: null });
  setMessage(usersMessage, `${user.email}: публиковать снова можно.`, true);
}

async function deleteUser(user) {
  if (!confirm(`Удалить аккаунт ${user.email} вместе с полкой и прогрессом? Это нельзя отменить.`)) return;
  const password = await askPassword(`Удаление аккаунта ${user.email}.`);
  if (!password) return;
  const result = await api(`/api/admin/users/${user.id}`, { method: "DELETE", body: { password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось удалить аккаунт.");
  users = users.filter((item) => item.id !== user.id);
  usersTotal = Math.max(0, usersTotal - 1);
  renderUsers();
  setMessage(usersMessage, `Аккаунт ${user.email} удалён.`, true);
}

// ==================== ЖУРНАЛ ====================

const auditList = $("#auditList");
const auditGroup = $("#auditGroup");
const auditMessage = $("#auditMessage");
const auditMore = $("#auditMore");
const AUDIT_PAGE = 50;
let auditEntries = [];
let auditTotal = 0;
let auditRequest = 0;

// Коды действий пишет сервер (functions/_lib/audit.js и обработчики /api/admin/*)
const ACTION_LABELS = {
  "game.create": "новая игра",
  "game.update": "изменение игры",
  "game.delete": "удаление игры",
  "game.cover": "обложка игры",
  "game.coverDelete": "удаление обложки игры",
  "game.shot": "новый скриншот",
  "game.shotDelete": "удаление скриншота",
  "post.create": "новая публикация",
  "post.update": "изменение публикации",
  "post.published": "публикация опубликована",
  "post.draft": "публикация в черновики",
  "post.archived": "публикация в архив",
  "post.delete": "удаление публикации",
  "post.image": "картинка публикации",
  "post.imageDelete": "удаление картинки публикации",
  "forum.create": "новая категория форума",
  "forum.update": "изменение категории форума",
  "forum.delete": "удаление категории форума",
  "settings.update": "настройки сайта",
  "title.create": "создание тайтла",
  "title.update": "изменение тайтла",
  "title.delete": "удаление тайтла",
  "cover.upload": "загрузка обложки",
  "cover.delete": "удаление обложки",
  "chapter.create": "новая глава",
  "chapter.update": "изменение главы",
  "chapter.delete": "удаление главы",
  "pages.publish": "публикация страниц",
  "pages.delete": "удаление страниц",
  "complaint.new": "жалоба возвращена в новые",
  "complaint.resolved": "жалоба: материал удалён",
  "complaint.rejected": "жалоба отклонена",
  "complaint.delete": "удаление жалобы",
  "user.block": "блокировка",
  "user.unblock": "разблокировка",
  "user.logout": "завершение сеансов",
  "user.grantAdmin": "выдача прав администратора",
  "user.revokeAdmin": "снятие прав администратора",
  "user.role.user": "роль: читатель",
  "user.role.moderator": "роль: модератор",
  "user.role.admin": "роль: администратор",
  "user.delete": "удаление аккаунта",
  "title.relations": "связи тайтла",
  "genre.create": "новый жанр",
  "genre.update": "изменение жанра",
  "genre.delete": "удаление жанра",
  "author.create": "новый автор",
  "author.update": "изменение автора",
  "author.delete": "удаление автора",
  "character.create": "новый персонаж",
  "character.update": "изменение персонажа",
  "character.delete": "удаление персонажа",
  "collection.update": "изменение подборки",
  "catalog.settings": "настройки каталога",
  "catalog.cache": "очистка кеша каталога",
  "catalog.errors": "очистка журнала ошибок каталога",
  "universe.entity.create": "новая запись вселенной",
  "universe.entity.update": "изменение записи вселенной",
  "universe.entity.delete": "удаление записи вселенной",
  "universe.relation.create": "новая связь вселенной",
  "universe.relation.update": "изменение связи вселенной",
  "universe.relation.delete": "удаление связи вселенной"
};

function auditRow(entry) {
  const item = element("li", "admin-audit-entry");
  const label = ACTION_LABELS[entry.action] || entry.action;
  const what = element("span");
  what.append(element("strong", null, label.charAt(0).toUpperCase() + label.slice(1)), ` · ${entry.target}`);
  item.append(element("time", null, formatDateTime(entry.createdAt)), what, element("small", null, entry.actorName));
  item.querySelector("time").dateTime = `${entry.createdAt.replace(" ", "T")}Z`;
  return item;
}

function renderAudit(list, entries) {
  list.replaceChildren(...(entries.length ? entries.map(auditRow) : [element("li", "admin-empty", "Записей пока нет.")]));
}

function auditUrl(offset) {
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE), offset: String(offset) });
  if (auditGroup.value) params.set("group", auditGroup.value);
  return `/api/admin/audit?${params}`;
}

async function loadAudit() {
  const id = ++auditRequest;
  const result = await api(auditUrl(0));
  if (id !== auditRequest) return;
  if (!result.ok) return setMessage(auditMessage, result.data?.error || "Не удалось загрузить журнал.");
  auditEntries = result.data.entries;
  auditTotal = result.data.total;
  renderAudit(auditList, auditEntries);
  auditMore.hidden = auditEntries.length >= auditTotal;
}

auditMore.addEventListener("click", async () => {
  const id = auditRequest;
  auditMore.disabled = true;
  const result = await api(auditUrl(auditEntries.length));
  auditMore.disabled = false;
  if (id !== auditRequest) return;
  if (!result.ok) return setMessage(auditMessage, result.data?.error || "Не удалось загрузить журнал.");
  // Новые записи сдвигают страницы: повторы убираем
  const known = new Set(auditEntries.map((entry) => entry.id));
  auditEntries = [...auditEntries, ...result.data.entries.filter((entry) => !known.has(entry.id))];
  auditTotal = result.data.total;
  renderAudit(auditList, auditEntries);
  auditMore.hidden = auditEntries.length >= auditTotal;
});

auditGroup.addEventListener("change", loadAudit);

// ==================== СТАРТ ====================

async function init() {
  const { user } = await getMe();
  if (!user) {
    location.replace(loginUrl());
    return;
  }
  if (!user.isAdmin && !user.isModerator) {
    denied.hidden = false;
    return;
  }
  me = user;
  initCatalogAdmin();
  initUniverseAdmin();
  initStudioAdmin();

  if (!user.isAdmin) {
    // Модератору не нужны тайтлы и жалобы правообладателей: эти запросы сервер ему всё равно отклонит
    document.querySelectorAll("[data-admin-only]").forEach((node) => node.remove());
    adminLayout.hidden = false;
    loadReports();
    await route();
    return;
  }

  const result = await api("/api/admin/titles");
  if (!result.ok) {
    denied.textContent = result.data?.error || "Не удалось загрузить тайтлы.";
    denied.hidden = false;
    return;
  }
  titles = result.data.titles;
  await loadTags();
  adminLayout.hidden = false;
  // Значки новых жалоб в меню видны в любом разделе
  loadComplaints();
  loadReports();
  await route();
}

init();
