// Страница /search: запрос из адреса, результаты из /api/search по группам

import { api, el, errorBox, initHeader, link, stateBox } from "./app.js";

initHeader();

const KINDS = { news: "Новость", devlog: "Devlog", update: "Обновление", roadmap: "Roadmap", announcement: "Анонс" };

const root = document.querySelector("#searchResults");
const form = document.querySelector(".search-page-form");
const field = form?.querySelector("input[name=q]");
const query = new URLSearchParams(location.search).get("q")?.trim() || "";

function group(title, items, render) {
  const section = el("section", "search-group");
  section.append(el("h2", null, title));
  const list = el("div", "stack");
  list.append(...items.map(render));
  section.append(list);
  return section;
}

function item(href, title, snippet, meta) {
  const card = el("article", "panel search-item");
  const heading = el("h3");
  heading.append(link(href, null, title));
  card.append(heading);
  if (snippet) card.append(el("p", null, snippet));
  if (meta) card.append(el("small", "thread-meta", meta));
  return card;
}

async function run() {
  if (field instanceof HTMLInputElement) field.value = query;
  if ([...query].length < 2) {
    root.replaceChildren(stateBox({ icon: "🔎", title: "Введите хотя бы 2 символа", text: "Ищем по темам, ответам, играм и публикациям студии." }));
    return;
  }
  document.title = `${query} — поиск | ENDEMION`;
  root.replaceChildren(stateBox({ icon: "⏳", title: "Ищем…", text: "" }));
  const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
  if (!result.ok) {
    root.replaceChildren(errorBox(result.data?.error || "Поиск не ответил.", run));
    return;
  }
  const { threads, comments, games, posts } = result.data;
  if (!threads.length && !comments.length && !games.length && !posts.length) {
    root.replaceChildren(stateBox({ icon: "🔎", title: "Ничего не нашлось", text: `По запросу «${query}» нет тем, ответов, игр и публикаций.` }));
    return;
  }
  root.replaceChildren();
  if (games.length) root.append(group("Игры", games, (g) => item(g.url, g.title, g.snippet)));
  if (posts.length) root.append(group("Разработка", posts, (p) => item(p.url, p.title, p.snippet, KINDS[p.kind] || "")));
  if (threads.length) root.append(group("Темы форума", threads, (t) => item(t.url, t.subject, t.snippet, t.category?.title || "")));
  if (comments.length) root.append(group("Ответы", comments, (c) => item(c.url, c.thread.subject, c.snippet, "ответ в теме")));
}

run();
