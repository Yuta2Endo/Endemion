// Разделы админки портала: игры со скриншотами, публикации студии, категории форума, настройки сайта.
// Права проверяет сервер в каждом запросе (functions/api/adminStudio.js), эта страница только показывает формы

import { api, button, el, link } from "./app.js";

const $ = (selector) => document.querySelector(selector);

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const GAME_STATUS_LABELS = { in_development: "В разработке", prototype: "Прототип", released: "Вышла", planned: "Запланирована" };
const POST_KIND_LABELS = { news: "Новости", devlog: "Devlog", update: "Обновление", roadmap: "Roadmap", announcement: "Анонс" };
const POST_STATUS_LABELS = { draft: "Черновик", published: "Опубликована", archived: "В архиве" };
const SECTION_LABELS = { general: "Общее", games: "Игры", development: "Разработка", community: "Сообщество" };
const SLUG_HINT = "Латиница в нижнем регистре, цифры и дефисы: например, endemion-life.";

// ==================== ОБЩЕЕ ====================

let fieldId = 0;

function statusLine(note) {
  const node = el("p", "form-message", note?.text || "");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  if (note?.success) node.classList.add("success");
  return node;
}

function say(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function field(label, control, { hint = null, wide = false } = {}) {
  const wrap = el("div", wide ? "field admin-wide" : "field");
  control.id = `studio-field-${++fieldId}`;
  const caption = el("label", null, label);
  caption.htmlFor = control.id;
  wrap.append(caption, control);
  if (hint) wrap.append(el("small", "admin-hint", hint));
  return wrap;
}

function input(name, value = "", { type = "text", maxLength = null, required = false, min = null, max = null } = {}) {
  const node = el("input");
  node.name = name;
  node.type = type;
  node.value = value ?? "";
  if (maxLength) node.maxLength = maxLength;
  if (required) node.required = true;
  if (min !== null) node.min = String(min);
  if (max !== null) node.max = String(max);
  return node;
}

function textarea(name, value, maxLength, rows = 6) {
  const node = el("textarea");
  node.name = name;
  node.value = value ?? "";
  node.maxLength = maxLength;
  node.rows = rows;
  return node;
}

/** options: [[значение, подпись]] */
function select(name, options, value) {
  const node = el("select");
  node.name = name;
  for (const [optionValue, label] of options) {
    const option = el("option", null, label);
    option.value = String(optionValue);
    node.append(option);
  }
  node.value = value === null || value === undefined ? "" : String(value);
  return node;
}

function checkbox(name, label, checked) {
  const wrap = el("label", "admin-check");
  const node = el("input");
  node.type = "checkbox";
  node.name = name;
  node.checked = Boolean(checked);
  wrap.append(node, document.createTextNode(` ${label}`));
  return wrap;
}

const value = (form, name) => form.elements.namedItem(name).value;
const isChecked = (form, name) => form.elements.namedItem(name).checked;
const numberValue = (form, name) => Number(value(form, name) || 0);
const optionalId = (form, name) => (value(form, name) ? Number(value(form, name)) : null);

function submitRow(text, ...extra) {
  const save = el("button", "main-button", text);
  save.type = "submit";
  const row = el("div", "admin-actions admin-wide");
  row.append(save, ...extra);
  return row;
}

/** Файл картинки на сервер: тело запроса — сам файл */
async function upload(url, method, file) {
  if (!IMAGE_TYPES.includes(file.type)) return { ok: false, data: { error: "Нужна картинка JPEG, PNG, WebP или AVIF." } };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, data: { error: "Картинка должна быть не больше 5 МБ." } };
  try {
    const response = await fetch(url, { method, body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
    return { ok: response.ok, data: await response.json().catch(() => null) };
  } catch {
    return { ok: false, data: { error: "Нет связи с сервером. Проверьте интернет." } };
  }
}

function fileInput(onFile) {
  const node = el("input");
  node.type = "file";
  node.accept = IMAGE_TYPES.join(",");
  node.addEventListener("change", () => {
    const file = node.files[0];
    node.value = "";
    if (file) onFile(file);
  });
  return node;
}

function preview(url, alt) {
  const img = el("img", "admin-studio-image");
  img.src = url;
  img.alt = alt;
  img.loading = "lazy";
  return img;
}

function tag(text, extra = "") {
  return el("span", `admin-tag ${extra}`.trim(), text);
}

async function gameOptions(empty) {
  const result = await api("/api/admin/games");
  const games = result.ok ? result.data.games : [];
  return [["", empty], ...games.map((game) => [game.id, game.title])];
}

// ==================== ИГРЫ ====================

let games = [];

export async function loadGames(note = null) {
  const box = $("#gamesContent");
  $("#newGameButton").hidden = false;
  const result = await api("/api/admin/games");
  if (!result.ok) return box.replaceChildren(statusLine({ text: result.data?.error || "Не удалось загрузить игры." }));
  games = result.data.games;
  const list = el("ul", "admin-plain-list");
  list.append(...(games.length ? games.map(gameRow) : [el("li", "admin-empty", "Игр пока нет.")]));
  box.replaceChildren(statusLine(note), list);
}

function gameRow(game) {
  const item = el("li", `admin-plain-item${game.published ? "" : " is-muted"}`);
  const info = el("div", "admin-plain-info");
  const name = el("strong");
  name.append(game.published ? link(`/games/${game.slug}`, null, game.title) : document.createTextNode(game.title));
  const tags = el("span", "admin-tags");
  if (!game.published) tags.append(tag("Черновик", "is-blocked"));
  if (game.isUpcoming) tags.append(tag("Будущий проект"));
  tags.append(tag(GAME_STATUS_LABELS[game.status] || "Статус не указан"));
  if (!game.coverUrl) tags.append(tag("Без обложки"));
  info.append(name, tags, el("small", null, `/games/${game.slug} · порядок ${game.position}${game.platforms.length ? ` · ${game.platforms.join(", ")}` : ""}`));
  const actions = el("div", "admin-chapter-actions");
  actions.append(
    button("Изменить", "secondary-button", () => openGame(game.id)),
    button("Удалить", "danger-button", () => deleteGame(game))
  );
  item.append(info, actions);
  return item;
}

async function deleteGame(game) {
  if (!confirm(`Удалить игру «${game.title}» вместе с обложкой и скриншотами? Категория форума и публикации останутся.`)) return;
  const result = await api(`/api/admin/games/${game.id}`, { method: "DELETE" });
  loadGames(result.ok ? { text: `Игра «${game.title}» удалена.`, success: true } : { text: result.data?.error || "Не удалось удалить игру." });
}

async function openGame(id, note = null) {
  const box = $("#gamesContent");
  $("#newGameButton").hidden = true;
  let game = null;
  let media = [];
  if (id) {
    const result = await api(`/api/admin/games/${id}`);
    if (!result.ok) return loadGames({ text: result.data?.error || "Не удалось открыть игру." });
    ({ game, media } = result.data);
  }
  const message = statusLine(note);
  const form = el("form", "admin-grid admin-studio-form");
  form.noValidate = false;
  form.append(
    field("Название", input("title", game?.title, { maxLength: 80, required: true })),
    field("Адрес страницы", input("slug", game?.slug, { maxLength: 60, required: true }), { hint: SLUG_HINT }),
    field("Короткое описание", input("tagline", game?.tagline, { maxLength: 200 }), { wide: true }),
    field("Описание", textarea("description", game?.description, 10000, 8), { wide: true, hint: "Абзацы через пустую строку, «## » — заголовок, «- » — список." }),
    field("Статус", select("status", [["", "Не указан"], ...Object.entries(GAME_STATUS_LABELS)], game?.status)),
    field("Платформы", input("platforms", game?.platforms.join(", "), { maxLength: 200 }), { hint: "Через запятую, например: Браузер, Android." }),
    field("Сайт игры", input("websiteUrl", game?.websiteUrl, { type: "url", maxLength: 500 }), { hint: "Только https://. Пусто — ссылки нет." }),
    field("Порядок в списке", input("position", String(game?.position ?? games.length + 1), { type: "number", min: 0, max: 9999 })),
    field("Планы", textarea("roadmap", game?.roadmap, 5000, 4), { wide: true }),
    field("Известные проблемы", textarea("knownIssues", game?.knownIssues, 5000, 4), { wide: true })
  );
  const flags = el("div", "admin-wide admin-checks");
  flags.append(checkbox("published", "Опубликована (видна всем)", game ? game.published : false), checkbox("isUpcoming", "Будущий проект (раздел «Скоро»)", game?.isUpcoming));
  form.append(flags, submitRow(game ? "Сохранить" : "Создать игру", button("К списку", "secondary-button", () => loadGames())));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      title: value(form, "title"), slug: value(form, "slug").trim(), tagline: value(form, "tagline"), description: value(form, "description"),
      status: value(form, "status") || null, platforms: value(form, "platforms"), websiteUrl: value(form, "websiteUrl").trim(),
      position: numberValue(form, "position"), roadmap: value(form, "roadmap"), knownIssues: value(form, "knownIssues"),
      published: isChecked(form, "published"), isUpcoming: isChecked(form, "isUpcoming")
    };
    say(message, "Сохраняю…");
    const result = await api(game ? `/api/admin/games/${game.id}` : "/api/admin/games", { method: game ? "PUT" : "POST", body });
    if (!result.ok) return say(message, result.data?.error || "Не удалось сохранить игру.");
    openGame(result.data.game.id, { text: game ? "Игра сохранена." : "Игра создана. Теперь можно загрузить обложку и скриншоты.", success: true });
  });

  const parts = [el("h3", "admin-subheading", game ? `Игра «${game.title}»` : "Новая игра"), message, form];
  if (game) parts.push(coverBlock(game, message), shotsBlock(game, media, message));
  box.replaceChildren(...parts);
}

function coverBlock(game, message) {
  const block = el("fieldset", "admin-fieldset");
  block.append(el("legend", null, "Обложка"));
  if (game.coverUrl) block.append(preview(game.coverUrl, `Обложка ${game.title}`));
  else block.append(el("p", "admin-hint", "Обложки нет: на сайте показывается заглушка с подписью «Обложка скоро появится»."));
  const actions = el("div", "admin-actions");
  actions.append(fileInput(async (file) => {
    say(message, "Загружаю обложку…");
    const result = await upload(`/api/admin/games/${game.id}/cover`, "PUT", file);
    if (!result.ok) return say(message, result.data?.error || "Не удалось загрузить обложку.");
    openGame(game.id, { text: "Обложка загружена.", success: true });
  }));
  if (game.coverUrl) {
    actions.append(button("Убрать обложку", "danger-button", async () => {
      if (!confirm("Убрать обложку игры?")) return;
      const result = await api(`/api/admin/games/${game.id}/cover`, { method: "DELETE" });
      if (!result.ok) return say(message, result.data?.error || "Не удалось убрать обложку.");
      openGame(game.id, { text: "Обложка убрана.", success: true });
    }));
  }
  block.append(actions, el("small", "admin-hint", "JPEG, PNG, WebP или AVIF до 5 МБ, лучше 1280×720."));
  return block;
}

function shotsBlock(game, media, message) {
  const block = el("fieldset", "admin-fieldset");
  block.append(el("legend", null, `Скриншоты (${media.length} из 20)`));
  const list = el("ul", "admin-shots");
  for (const shot of media) {
    const item = el("li", "admin-shot");
    item.append(preview(shot.url, shot.caption || `Скриншот ${game.title}`), el("small", null, shot.caption || "Без подписи"),
      button("Удалить", "danger-button", async () => {
        if (!confirm("Удалить скриншот?")) return;
        const result = await api(`/api/admin/games/${game.id}/media/${shot.id}`, { method: "DELETE" });
        if (!result.ok) return say(message, result.data?.error || "Не удалось удалить скриншот.");
        openGame(game.id, { text: "Скриншот удалён.", success: true });
      }));
    list.append(item);
  }
  if (media.length) block.append(list);
  const caption = input("shotCaption", "", { maxLength: 200 });
  block.append(field("Подпись к новому скриншоту", caption));
  block.append(fileInput(async (file) => {
    say(message, "Загружаю скриншот…");
    const result = await upload(`/api/admin/games/${game.id}/media?caption=${encodeURIComponent(caption.value)}`, "POST", file);
    if (!result.ok) return say(message, result.data?.error || "Не удалось загрузить скриншот.");
    openGame(game.id, { text: "Скриншот добавлен.", success: true });
  }));
  return block;
}

// ==================== ПУБЛИКАЦИИ СТУДИИ ====================

let postFilter = "";

export async function loadStudioPosts(note = null) {
  const box = $("#studioContent");
  $("#newPostButton").hidden = false;
  const result = await api(`/api/admin/studio-posts?limit=100${postFilter ? `&status=${postFilter}` : ""}`);
  if (!result.ok) return box.replaceChildren(statusLine({ text: result.data?.error || "Не удалось загрузить публикации." }));
  const filter = select("postFilter", [["", "Все"], ...Object.entries(POST_STATUS_LABELS)], postFilter);
  filter.addEventListener("change", () => {
    postFilter = filter.value;
    loadStudioPosts();
  });
  const filters = el("div", "admin-filters");
  filters.append(field("Статус", filter));
  const list = el("ul", "admin-plain-list");
  const { posts, total } = result.data;
  list.append(...(posts.length ? posts.map(postRow) : [el("li", "admin-empty", "Публикаций пока нет.")]));
  const count = total > posts.length ? [el("p", "admin-hint", `Показаны последние ${posts.length} из ${total}.`)] : [];
  box.replaceChildren(filters, statusLine(note), list, ...count);
}

function postRow(post) {
  const item = el("li", `admin-plain-item${post.status === "published" ? "" : " is-muted"}`);
  const info = el("div", "admin-plain-info");
  const name = el("strong");
  name.append(post.status === "draft" ? document.createTextNode(post.title) : link(`/studio/${post.slug}`, null, post.title));
  const tags = el("span", "admin-tags");
  tags.append(tag(POST_STATUS_LABELS[post.status], post.status === "published" ? "is-admin" : ""), tag(POST_KIND_LABELS[post.kind]));
  if (post.game) tags.append(tag(post.game.title));
  const date = post.publishedAt ? `опубликована ${post.publishedAt.slice(0, 10)}` : `создана ${post.createdAt.slice(0, 10)}`;
  info.append(name, tags, el("small", null, `/studio/${post.slug} · ${date}${post.author ? ` · ${post.author.name}` : ""}`));
  const actions = el("div", "admin-chapter-actions");
  actions.append(button("Изменить", "secondary-button", () => openPost(post.id)), button("Удалить", "danger-button", () => deletePost(post)));
  item.append(info, actions);
  return item;
}

async function deletePost(post) {
  if (!confirm(`Удалить публикацию «${post.title}»? Чтобы убрать её из ленты без удаления, переведите в архив.`)) return;
  const result = await api(`/api/admin/studio-posts/${post.id}`, { method: "DELETE" });
  loadStudioPosts(result.ok ? { text: "Публикация удалена.", success: true } : { text: result.data?.error || "Не удалось удалить публикацию." });
}

async function openPost(id, note = null) {
  const box = $("#studioContent");
  $("#newPostButton").hidden = true;
  let post = null;
  if (id) {
    const result = await api(`/api/admin/studio-posts/${id}`);
    if (!result.ok) return loadStudioPosts({ text: result.data?.error || "Не удалось открыть публикацию." });
    post = result.data.post;
  }
  const message = statusLine(note);
  const form = el("form", "admin-grid admin-studio-form");
  form.append(
    field("Заголовок", input("title", post?.title, { maxLength: 160, required: true }), { wide: true }),
    field("Адрес страницы", input("slug", post?.slug, { maxLength: 80, required: true }), { hint: SLUG_HINT }),
    field("Вид", select("kind", Object.entries(POST_KIND_LABELS), post?.kind || "news")),
    field("Статус", select("status", Object.entries(POST_STATUS_LABELS), post?.status || "draft"), { hint: "Черновик и архив видны только в админке. Дата ставится при первой публикации." }),
    field("Игра", select("gameId", await gameOptions("Без игры"), post?.game?.id)),
    field("Краткое описание", textarea("summary", post?.summary, 400, 2), { wide: true, hint: "Показывается в карточке в ленте." }),
    field("Текст", textarea("body", post?.body, 50000, 14), { wide: true, hint: "Абзацы через пустую строку, «## » — заголовок, «- » — список. HTML не поддерживается." }),
    submitRow(post ? "Сохранить" : "Создать публикацию", button("К списку", "secondary-button", () => loadStudioPosts()))
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      title: value(form, "title"), slug: value(form, "slug").trim(), kind: value(form, "kind"), status: value(form, "status"),
      gameId: optionalId(form, "gameId"), summary: value(form, "summary"), body: value(form, "body")
    };
    say(message, "Сохраняю…");
    const result = await api(post ? `/api/admin/studio-posts/${post.id}` : "/api/admin/studio-posts", { method: post ? "PUT" : "POST", body });
    if (!result.ok) return say(message, result.data?.error || "Не удалось сохранить публикацию.");
    openPost(result.data.post.id, { text: post ? "Публикация сохранена." : "Публикация создана.", success: true });
  });
  const parts = [el("h3", "admin-subheading", post ? `Публикация «${post.title}»` : "Новая публикация"), message, form];
  if (post) parts.push(postImageBlock(post, message));
  box.replaceChildren(...parts);
}

function postImageBlock(post, message) {
  const block = el("fieldset", "admin-fieldset");
  block.append(el("legend", null, "Картинка"));
  // Картинку черновика сервер не отдаёт: превью появится после публикации
  if (post.imageUrl && post.status !== "draft") block.append(preview(post.imageUrl, ""));
  else if (post.imageUrl) block.append(el("p", "admin-hint", "Картинка загружена, она появится после публикации."));
  const actions = el("div", "admin-actions");
  actions.append(fileInput(async (file) => {
    say(message, "Загружаю картинку…");
    const result = await upload(`/api/admin/studio-posts/${post.id}/image`, "PUT", file);
    if (!result.ok) return say(message, result.data?.error || "Не удалось загрузить картинку.");
    openPost(post.id, { text: "Картинка загружена.", success: true });
  }));
  if (post.imageUrl) {
    actions.append(button("Убрать картинку", "danger-button", async () => {
      if (!confirm("Убрать картинку публикации?")) return;
      const result = await api(`/api/admin/studio-posts/${post.id}/image`, { method: "DELETE" });
      if (!result.ok) return say(message, result.data?.error || "Не удалось убрать картинку.");
      openPost(post.id, { text: "Картинка убрана.", success: true });
    }));
  }
  block.append(actions);
  return block;
}

// ==================== КАТЕГОРИИ ФОРУМА ====================

export async function loadForumCategories(note = null) {
  const box = $("#forumContent");
  const result = await api("/api/admin/forum-categories");
  if (!result.ok) return box.replaceChildren(statusLine({ text: result.data?.error || "Не удалось загрузить категории." }));
  const options = await gameOptions("Не связана с игрой");
  const { categories } = result.data;
  const message = statusLine(note);
  const parts = [message];
  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    const items = categories.filter((c) => c.section === key);
    parts.push(el("h3", "admin-subheading", label));
    const list = el("ul", "admin-plain-list");
    list.append(...(items.length ? items.map((c) => categoryRow(c, options, message)) : [el("li", "admin-empty", "Категорий нет.")]));
    parts.push(list);
  }
  const create = el("fieldset", "admin-fieldset");
  create.append(el("legend", null, "Новая категория"), categoryForm(null, options, message));
  parts.push(create);
  box.replaceChildren(...parts);
}

function categoryRow(category, options, message) {
  const item = el("li", "admin-plain-item");
  const info = el("div", "admin-plain-info");
  const name = el("strong");
  name.append(link(`/community/c/${category.slug}`, null, category.title));
  const tags = el("span", "admin-tags");
  if (category.staffOnly) tags.append(tag("Пишет команда", "is-admin"));
  if (category.gameSlug) tags.append(tag(`Игра: ${category.gameSlug}`));
  info.append(name, tags, el("small", null, `/community/c/${category.slug} · порядок ${category.position} · тем: ${category.topics}${category.allTopics > category.topics ? ` (удалённых: ${category.allTopics - category.topics})` : ""}`));
  const actions = el("div", "admin-chapter-actions");
  actions.append(button("Изменить", "secondary-button", () => {
    const editor = el("div", "admin-wide");
    editor.append(categoryForm(category, options, message));
    item.replaceChildren(editor);
  }));
  if (category.slug !== "general") {
    actions.append(button("Удалить", "danger-button", async () => {
      if (!confirm(`Удалить категорию «${category.title}»?`)) return;
      const result = await api(`/api/admin/forum-categories/${category.id}`, { method: "DELETE" });
      loadForumCategories(result.ok ? { text: "Категория удалена.", success: true } : { text: result.data?.error || "Не удалось удалить категорию." });
    }));
  }
  item.append(info, actions);
  return item;
}

function categoryForm(category, options, message) {
  const form = el("form", "admin-grid admin-studio-form");
  form.append(
    field("Название", input("title", category?.title, { maxLength: 80, required: true })),
    field("Адрес", input("slug", category?.slug, { maxLength: 60, required: true }), { hint: SLUG_HINT }),
    field("Раздел", select("section", Object.entries(SECTION_LABELS), category?.section || "general")),
    field("Порядок", input("position", String(category?.position ?? 0), { type: "number", min: 0, max: 9999 })),
    field("Описание", input("description", category?.description, { maxLength: 300 }), { wide: true }),
    field("Игра", select("gameId", options, category?.gameId))
  );
  const flags = el("div", "admin-checks");
  flags.append(checkbox("staffOnly", "Новые темы пишет только команда", category?.staffOnly));
  const buttons = category ? [button("Отмена", "secondary-button", () => loadForumCategories())] : [];
  form.append(flags, submitRow(category ? "Сохранить" : "Добавить категорию", ...buttons));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      title: value(form, "title"), slug: value(form, "slug").trim(), section: value(form, "section"), position: numberValue(form, "position"),
      description: value(form, "description"), gameId: optionalId(form, "gameId"), staffOnly: isChecked(form, "staffOnly")
    };
    const result = await api(category ? `/api/admin/forum-categories/${category.id}` : "/api/admin/forum-categories", { method: category ? "PUT" : "POST", body });
    if (!result.ok) return say(message, result.data?.error || "Не удалось сохранить категорию.");
    loadForumCategories({ text: category ? "Категория сохранена." : "Категория добавлена.", success: true });
  });
  return form;
}

// ==================== НАСТРОЙКИ САЙТА ====================

export async function loadSiteSettings(note = null) {
  const box = $("#settingsContent");
  const result = await api("/api/admin/site-settings");
  if (!result.ok) return box.replaceChildren(statusLine({ text: result.data?.error || "Не удалось загрузить настройки." }));
  const { settings, games: catalog } = result.data;
  const message = statusLine(note);
  const form = el("form", "admin-grid admin-studio-form");
  const published = catalog.filter((game) => game.published);
  form.append(
    field("Главная игра на главной странице", select("featuredGame", [["", "Не показывать"], ...published.map((game) => [game.slug, game.title])], settings.featuredGame), { wide: true }),
    field("Текст о студии", textarea("aboutText", settings.aboutText, 5000, 5), { wide: true, hint: "Пусто — блок не показывается." })
  );

  const links = el("fieldset", "admin-fieldset admin-wide");
  const rows = el("div", "admin-social-rows");
  const addRow = (item = { label: "", url: "" }) => {
    const row = el("div", "admin-social-row");
    const label = input("socialLabel", item.label, { maxLength: 40 });
    label.placeholder = "Discord";
    label.setAttribute("aria-label", "Название соцсети");
    const url = input("socialUrl", item.url, { type: "url", maxLength: 500 });
    url.placeholder = "https://…";
    url.setAttribute("aria-label", "Ссылка");
    row.append(label, url, button("Убрать", "secondary-button", () => row.remove()));
    rows.append(row);
  };
  settings.socialLinks.forEach(addRow);
  links.append(el("legend", null, "Соцсети в подвале сайта"), rows,
    button("+ Добавить ссылку", "secondary-button", () => addRow()),
    el("small", "admin-hint", "Только https-ссылки на настоящие страницы Endemion. Пусто — блок в подвале скрыт."));
  form.append(links, submitRow("Сохранить настройки"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const socialLinks = [...rows.querySelectorAll(".admin-social-row")]
      .map((row) => ({ label: row.querySelector('[name="socialLabel"]').value.trim(), url: row.querySelector('[name="socialUrl"]').value.trim() }))
      .filter((item) => item.label || item.url);
    say(message, "Сохраняю…");
    const response = await api("/api/admin/site-settings", {
      method: "PUT",
      body: { featuredGame: value(form, "featuredGame"), aboutText: value(form, "aboutText"), socialLinks }
    });
    if (!response.ok) return say(message, response.data?.error || "Не удалось сохранить настройки.");
    loadSiteSettings({ text: "Настройки сохранены.", success: true });
  });
  box.replaceChildren(message, form);
}

// ==================== КНОПКИ «НОВАЯ» ====================

export function initStudioAdmin() {
  $("#newGameButton")?.addEventListener("click", () => openGame(null));
  $("#newPostButton")?.addEventListener("click", () => openPost(null));
}
