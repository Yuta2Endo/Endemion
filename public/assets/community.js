// ENDEMION COMMUNITY: лента обсуждений и теорий, поиск участников.
// Вкладка выбирается адресом: /community#theories, /community#readers

import {
  announceAchievements, api, avatar, button, checkbox, el, errorBox, field, formValue, initHeader, input, lineSkeletons,
  link, loginUrl, openDialog, stateBox, textarea, timeAgo, userLink
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
  const query = input("q", { type: "search", placeholder: "Поиск по темам…", maxLength: 80 });
  query.setAttribute("aria-label", "Поиск по темам");
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
        text: "Начните первым: задайте вопрос или поделитесь мыслями об играх Endemion.",
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
  const created = await openDialog({
    title: kind === "theory" ? "Новая теория" : "Новое обсуждение",
    submitText: "Опубликовать",
    build(form) {
      const kindSelect = el("select", "select");
      kindSelect.name = "kind";
      kindSelect.append(new Option("Обсуждение", "discussion"), new Option("Теория", "theory"));
      kindSelect.value = kind;
      form.append(
        field("Вид", kindSelect),
        field("Заголовок", input("subject", { maxLength: 140, placeholder: "Коротко о главном", required: true })),
        field("Текст", textarea("body", { maxLength: 10000, rows: 7, placeholder: "Ваши мысли, аргументы, вопросы…" })),
        checkbox("spoiler", "Есть спойлеры")
      );
    },
    async onSubmit(form) {
      const result = await api("/api/threads", {
        method: "POST",
        body: {
          kind: formValue(form, "kind"), subject: formValue(form, "subject"), body: formValue(form, "body"),
          spoiler: formValue(form, "spoiler")
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

// ==================== УЧАСТНИКИ ====================

async function showReaders() {
  const search = el("form", "search-box");
  search.setAttribute("role", "search");
  const query = input("q", { type: "search", placeholder: "Имя или @имя профиля…", maxLength: 40 });
  query.setAttribute("aria-label", "Поиск участников");
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
  if (current !== "readers") actions.append(button(current === "theories" ? "＋ Теория" : "＋ Обсуждение", "primary-btn", () => newThread(current === "theories" ? "theory" : "discussion")));
}

const VIEWS = {
  threads: () => showThreads("discussion"),
  theories: () => showThreads("theory"),
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
