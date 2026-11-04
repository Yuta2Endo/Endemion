// ENDEMION COMMUNITY: лента обсуждений и теорий, подборки читателей, поиск читателей.
// Вкладка выбирается адресом: /community#theories, /community#collections, /community#readers

import {
  announceAchievements, api, avatar, button, checkbox, el, errorBox, field, formValue, initHeader, input, lineSkeletons,
  link, loginUrl, openDialog, posterBackground, stateBox, textarea, timeAgo, titlePicker, userLink, entryUrl, remoteImage, spoilerText
} from "./app.js";

const body = document.querySelector("#communityBody");
const actions = document.querySelector("#communityActions");
const tabs = [...document.querySelectorAll("[data-tab]")];
const TABS = tabs.map((tab) => tab.dataset.tab);

let user = null;
let current = "threads";

// ==================== ОБСУЖДЕНИЯ И ТЕОРИИ ====================

function threadItem(thread) {
  const item = el("article", "thread-item");
  const main = el("div");
  const badges = el("div", "thread-meta");
  badges.append(el("span", `kind-badge${thread.kind === "theory" ? " is-theory" : ""}`, thread.kind === "theory" ? "Теория" : "Обсуждение"));
  if (thread.title) badges.append(link(`/title/${thread.title.id}`, "tag", thread.title.title));
  if (thread.spoiler) badges.append(el("span", "tag", "Спойлеры"));
  const heading = el("h3");
  heading.append(link(`/community/thread/${thread.id}`, null, thread.subject));
  main.append(badges, heading);
  if (!thread.spoiler) main.append(el("p", null, thread.body));
  const meta = el("div", "thread-meta");
  meta.append(userLink(thread.author, { size: "avatar-sm" }), el("span", null, `активность ${timeAgo(thread.lastActivityAt)}`));
  main.append(meta);
  const count = el("div", "thread-count");
  count.append(el("strong", null, String(thread.comments)), el("small", null, "ответов"));
  item.append(main, count);
  return item;
}

async function showThreads(kind) {
  const bar = el("div", "catalog-bar");
  const search = el("form", "search-box");
  search.setAttribute("role", "search");
  const query = input("q", { type: "search", placeholder: "Поиск по заголовкам…", maxLength: 80 });
  query.setAttribute("aria-label", "Поиск по заголовкам");
  search.append(query);
  const sort = el("select", "select");
  sort.setAttribute("aria-label", "Сортировка");
  sort.append(new Option("Сначала активные", "active"), new Option("Сначала новые", "new"));
  bar.append(search);
  bar.append(sort);
  const list = el("div", "thread-list");
  const more = el("div", "load-more");
  body.replaceChildren(bar, list, more);
  let offset = 0;

  async function load(reset) {
    if (reset) {
      offset = 0;
      list.replaceChildren(...lineSkeletons(4, 96));
    }
    const params = new URLSearchParams({ kind, offset: String(offset), sort: sort.value });
    if (query.value.trim()) params.set("q", query.value.trim());
    const result = await api(`/api/threads?${params}`);
    if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Лента не загрузилась.", () => load(true)));
    if (reset) list.replaceChildren();
    if (reset && !result.data.threads.length) {
      list.append(stateBox({
        icon: kind === "theory" ? "🔮" : "💬",
        title: query.value.trim() ? "Ничего не нашлось" : kind === "theory" ? "Теорий пока нет" : "Обсуждений пока нет",
        text: "Начните первым — расскажите, что думаете о прочитанном.",
        action: { text: kind === "theory" ? "Выдвинуть теорию" : "Начать обсуждение", onClick: () => newThread(kind) }
      }));
    }
    list.append(...result.data.threads.map(threadItem));
    offset += result.data.threads.length;
    more.replaceChildren();
    if (offset < result.data.total) more.append(button("Показать ещё", "ghost-btn", () => load(false)));
  }

  let timer = null;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(true), 300);
  });
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    load(true);
  });
  sort.addEventListener("change", () => load(true));
  await load(true);
}

async function newThread(kind = "discussion") {
  if (!user) return (location.href = loginUrl());
  let titleId = null;
  const created = await openDialog({
    title: kind === "theory" ? "Новая теория" : "Новое обсуждение",
    submitText: "Опубликовать",
    build(form) {
      const kindSelect = el("select", "select");
      kindSelect.name = "kind";
      kindSelect.append(new Option("Обсуждение", "discussion"), new Option("Теория", "theory"));
      kindSelect.value = kind;
      const picked = el("div", "picked");
      const picker = titlePicker({
        placeholder: "О каком тайтле? (необязательно)",
        onPick(title) {
          titleId = title.id;
          const tag = el("span", "tag is-strong", title.title);
          tag.append(button("✕", null, () => {
            titleId = null;
            picked.replaceChildren();
          }, { label: "Убрать тайтл" }));
          picked.replaceChildren(tag);
        }
      });
      form.append(
        field("Вид", kindSelect),
        field("Заголовок", input("subject", { maxLength: 140, placeholder: "Коротко о главном", required: true })),
        field("Тайтл", picker.root),
        picked,
        field("Текст", textarea("body", { maxLength: 10000, rows: 7, placeholder: "Ваши мысли, аргументы, вопросы…" })),
        checkbox("spoiler", "Есть спойлеры")
      );
    },
    async onSubmit(form) {
      const result = await api("/api/threads", {
        method: "POST",
        body: {
          kind: formValue(form, "kind"), subject: formValue(form, "subject"), body: formValue(form, "body"),
          spoiler: formValue(form, "spoiler"), titleId
        }
      });
      if (!result.ok) return result.data?.error || "Не удалось опубликовать.";
      announceAchievements(result.data.achievements);
      location.href = `/community/thread/${result.data.thread.id}`;
      return null;
    }
  });
  return created;
}

// ==================== ПОДБОРКИ ====================

export function collectionCard(collection) {
  const card = el("article", "collection-card");
  const stack = el("div", "collection-stack");
  stack.setAttribute("aria-hidden", "true");
  for (const title of collection.preview || []) {
    const cover = el("span", null, title.cover ? "" : title.symbol);
    cover.style.setProperty("--poster", posterBackground(title));
    stack.append(cover);
  }
  if (!collection.preview?.length) stack.append(el("span", null, "✦"));
  const name = el("strong");
  name.append(link(`/collection/${collection.id}`, null, collection.name));
  const meta = [`${collection.size} тайтлов`, collection.author.name];
  if (!collection.isPublic) meta.push("скрыта");
  card.append(stack, name, el("small", null, meta.join(" · ")));
  if (collection.featured) card.append(el("span", "tag is-strong", "★ Выбор редакции"));
  if (collection.description) card.append(el("p", "t-desc", collection.description));
  return card;
}

async function showCollections() {
  const chips = el("div", "chips");
  const grid = el("div", "collection-cards section");
  body.replaceChildren(chips, grid);
  const load = async (mine) => {
    chips.querySelectorAll("button").forEach((chip, i) => chip.setAttribute("aria-pressed", String(i === (mine ? 1 : 0))));
    grid.replaceChildren(...lineSkeletons(3, 180));
    const result = await api(`/api/collections${mine ? "?mine=1" : ""}`);
    if (!result.ok) return grid.replaceChildren(errorBox(result.data?.error || "Подборки не загрузились.", () => load(mine)));
    if (!result.data.collections.length) {
      return grid.replaceChildren(stateBox({
        icon: "🎨", title: mine ? "У вас нет подборок" : "Подборок пока нет",
        text: "Соберите свою: «Лучшие тёмные фэнтези», «Читать под дождь» — что угодно.",
        action: { text: "Создать подборку", onClick: newCollection }
      }));
    }
    grid.replaceChildren(...result.data.collections.map(collectionCard));
  };
  chips.append(button("Все подборки", "chip", () => load(false)));
  if (user) chips.append(button("Мои", "chip", () => load(true)));
  await load(false);
}

async function newCollection() {
  if (!user) return (location.href = loginUrl());
  await openDialog({
    title: "Новая подборка",
    submitText: "Создать",
    build(form) {
      const visibility = checkbox("isPublic", "Открытая: её видят все", true);
      form.append(
        field("Название", input("name", { maxLength: 80, placeholder: "Например, «Для дождливого вечера»", required: true })),
        field("Описание", textarea("description", { maxLength: 1000, rows: 3 })),
        visibility
      );
    },
    async onSubmit(form) {
      const result = await api("/api/collections", {
        method: "POST",
        body: { name: formValue(form, "name"), description: formValue(form, "description"), isPublic: formValue(form, "isPublic") }
      });
      if (!result.ok) return result.data?.error || "Не удалось создать подборку.";
      location.href = `/collection/${result.data.collection.id}`;
      return null;
    }
  });
}

// ==================== ЧИТАТЕЛИ ====================

async function showReaders() {
  const search = el("form", "search-box");
  search.setAttribute("role", "search");
  const query = input("q", { type: "search", placeholder: "Имя или @имя профиля…", maxLength: 40 });
  query.setAttribute("aria-label", "Поиск читателей");
  search.append(query);
  const list = el("div", "collection-cards section");
  body.replaceChildren(search, list);
  const load = async () => {
    list.replaceChildren(...lineSkeletons(3, 90));
    const result = await api(`/api/users?${new URLSearchParams({ q: query.value.trim().replace(/^@/, "") })}`);
    if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Не загрузилось.", load));
    if (!result.data.users.length) return list.replaceChildren(stateBox({ icon: "🔭", text: "Никого не нашлось." }));
    list.replaceChildren(...result.data.users.map((reader) => {
      const card = el("article", "collection-card");
      const head = el("div", "user-chip");
      const text = el("div");
      const name = el("strong");
      name.append(link(`/users/${encodeURIComponent(reader.username)}`, null, reader.name));
      text.append(name, el("small", null, `@${reader.username} · подписчиков: ${reader.followers}`));
      head.append(avatar(reader), text);
      card.append(head);
      if (reader.bio) card.append(el("p", "t-desc", reader.bio));
      return card;
    }));
  };
  let timer = null;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    load();
  });
  await load();
}

// ==================== ВКЛАДКИ ====================

function renderActions() {
  actions.replaceChildren();
  if (current === "collections") actions.append(button("＋ Подборка", "primary-btn", newCollection));
  else if (current !== "readers" && current !== "reviews") actions.append(button(current === "theories" ? "＋ Теория" : "＋ Обсуждение", "primary-btn", () => newThread(current === "theories" ? "theory" : "discussion")));
}

// ==================== ОТЗЫВЫ О ПРОИЗВЕДЕНИЯХ ====================

async function showReviews() {
  const filter = el("div", "tabs-bar");
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "Раздел");
  const list = el("div", "review-teasers");
  const more = el("div", "load-more");
  body.replaceChildren(filter, list, more);
  let kind = "";
  let offset = 0;
  for (const [key, label] of [["", "Все"], ["anime", "Аниме"], ["manga", "Манга"]]) {
    const node = button(label, null, () => {
      kind = key;
      filter.querySelectorAll("button").forEach((other) => other.setAttribute("aria-pressed", String(other === node)));
      load(true);
    }, { pressed: key === "" });
    filter.append(node);
  }

  async function load(reset) {
    if (reset) {
      offset = 0;
      list.replaceChildren(...lineSkeletons(3, 110));
    }
    const result = await api(`/api/entry-reviews?offset=${offset}${kind ? `&kind=${kind}` : ""}`);
    if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Отзывы не загрузились.", () => load(true)));
    if (reset) list.replaceChildren();
    if (reset && !result.data.reviews.length) {
      list.append(stateBox({ icon: "✍", title: "Отзывов пока нет", text: "Откройте любое аниме или мангу и напишите первый.", action: { href: "/anime", text: "Каталог аниме" } }));
    }
    for (const review of result.data.reviews) {
      const card = el("article", "review-teaser");
      const href = `${entryUrl(review.entry)}#review-${review.id}`;
      const poster = link(href, "review-teaser-poster", null);
      poster.tabIndex = -1;
      poster.setAttribute("aria-hidden", "true");
      poster.append(remoteImage(review.entry.poster?.small, ""));
      const main = el("div");
      const head = el("p", "review-teaser-head");
      head.append(link(href, null, review.entry.title), el("span", "review-score", `${review.score}/10`));
      const text = el("p", "review-teaser-text", review.body.length > 400 ? `${review.body.slice(0, 400)}…` : review.body);
      main.append(head, spoilerText(text, review.spoiler), userLink(review.author, { size: "avatar-sm", small: timeAgo(review.createdAt) }));
      card.append(poster, main);
      list.append(card);
    }
    offset += result.data.reviews.length;
    more.replaceChildren(...(result.data.hasMore ? [button("Показать ещё", "ghost-btn", () => load(false))] : []));
  }
  load(true);
}

const VIEWS = {
  reviews: showReviews,
  threads: () => showThreads("discussion"),
  theories: () => showThreads("theory"),
  collections: showCollections,
  readers: showReaders
};

function open(name) {
  current = TABS.includes(name) ? name : "threads";
  tabs.forEach((node) => {
    node.setAttribute("aria-selected", String(node.dataset.tab === current));
    node.tabIndex = node.dataset.tab === current ? 0 : -1;
  });
  history.replaceState(null, "", `#${current}`);
  renderActions();
  VIEWS[current]();
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => open(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    open(next.dataset.tab);
  });
});

async function init() {
  user = await initHeader();
  open(location.hash.slice(1));
}

init();
