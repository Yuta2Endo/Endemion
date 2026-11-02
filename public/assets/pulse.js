// ENDEMION PULSE: «Читаю» с прогрессом, полка по статусам, календарь выхода глав, уведомления, история, настройки.
// Вкладка выбирается адресом: /pulse#calendar, /pulse#notifications

import {
  api, button, chaptersText, el, errorBox, initHeader, lineSkeletons, link, loginUrl, setUnread, stateBox, STATUS_LABELS,
  thumb, timeAgo, toast, TYPE_LABELS, updateLibrary
} from "./app.js";

const body = document.querySelector("#pulseBody");
const tabs = [...document.querySelectorAll("[data-tab]")];
const unreadPill = document.querySelector("#pulseUnread");
const TABS = tabs.map((tab) => tab.dataset.tab);
const DAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const NOTICE_ICONS = { chapter: "📖", reply: "💬", follow: "👤", achievement: "🏆", moderation: "🛡", system: "✦" };

let user = null;

function setUnreadEverywhere(count) {
  setUnread(count);
  unreadPill.hidden = count <= 0;
  unreadPill.textContent = String(count);
}

function loading() {
  body.replaceChildren(el("div", "stack"));
  body.firstChild.append(...lineSkeletons(4, 96));
}

/** Строка полки: обложка, название, прогресс и быстрые действия */
function shelfRow(item, { showNext = true } = {}) {
  const { title } = item;
  const row = el("article", "shelf-item");
  const thumbLink = link(`/title/${title.id}`, null, "");
  thumbLink.append(thumb(title, "shelf-thumb"));
  thumbLink.setAttribute("aria-label", title.title);

  const info = el("div");
  const heading = el("h3");
  heading.append(link(`/title/${title.id}`, null, title.title));
  const read = item.chapter || 0;
  info.append(heading, el("p", "t-meta", `${TYPE_LABELS[title.type]} · ${read} из ${title.chapters} · ${STATUS_LABELS[item.status] || "На полке"}`));
  if (title.chapters) {
    const progress = el("div", "t-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Прочитано глав");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(title.chapters));
    progress.setAttribute("aria-valuenow", String(read));
    const bar = el("span");
    bar.style.width = `${Math.round((read / title.chapters) * 100)}%`;
    progress.append(bar);
    info.append(progress);
  }

  const actions = el("div", "shelf-actions");
  if (showNext && title.chapters) {
    const next = item.position ? item.position.chapter : Math.min(read + 1, title.chapters);
    const href = item.position ? `/read/${title.id}/${item.position.chapter}#${item.position.page}` : `/read/${title.id}/${next}`;
    actions.append(link(href, "primary-btn small-btn", read >= title.chapters ? "Перечитать" : `Глава ${next}`));
  }
  if (title.chapters && read < title.chapters) {
    actions.append(button("+1", "ghost-btn small-btn", async () => {
      const saved = await updateLibrary(title.id, { chapter: read + 1 });
      if (saved) {
        item.chapter = saved.chapter;
        item.status = saved.status;
        row.replaceWith(shelfRow(item, { showNext }));
      }
    }, { label: `Отметить главу ${read + 1} прочитанной` }));
  }
  const select = el("select", "select small-btn");
  select.setAttribute("aria-label", `Статус «${title.title}»`);
  for (const [value, text] of Object.entries(STATUS_LABELS)) select.append(new Option(text, value));
  select.value = item.status || "reading";
  select.addEventListener("change", async () => {
    const saved = await updateLibrary(title.id, { status: select.value });
    if (saved) toast(`«${title.title}»: ${STATUS_LABELS[saved.status]}`);
  });
  actions.append(select);
  row.append(thumbLink, info, actions);
  return row;
}

// ==================== ВКЛАДКИ ====================

async function showReading() {
  loading();
  const result = await api("/api/continue");
  if (!result.ok) return body.replaceChildren(errorBox(result.data?.error || "Не удалось загрузить.", showReading));
  if (!result.data.items.length) {
    return body.replaceChildren(stateBox({
      icon: "📖", title: "Нечего продолжать",
      text: "Здесь появятся тайтлы со статусом «Читаю», в которых есть непрочитанные главы.",
      action: { href: "/oracle", text: "Подобрать историю" }
    }));
  }
  const list = el("div", "shelf-list");
  list.append(...result.data.items.map((item) => shelfRow({ ...item, status: "reading" })));
  body.replaceChildren(el("p", "muted small", `Осталось прочитать: ${chaptersText(result.data.items.reduce((sum, item) => sum + item.unread, 0))}`), list);
  list.style.marginTop = "14px";
}

let shelfFilter = "reading";

async function showShelf() {
  const chips = el("div", "chips");
  const filters = { ...STATUS_LABELS, favorites: "Избранное" };
  for (const [key, label] of Object.entries(filters)) {
    chips.append(button(label, "chip", () => {
      shelfFilter = key;
      showShelf();
    }, { pressed: key === shelfFilter }));
  }
  const list = el("div", "shelf-list section");
  list.append(...lineSkeletons(3, 96));
  body.replaceChildren(chips, list);
  const result = await api(`/api/titles?tab=${shelfFilter}&limit=100&sort=updated`);
  if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Полка не загрузилась.", showShelf));
  const entries = await api("/api/library");
  const byId = new Map((entries.ok ? entries.data.items : []).map((item) => [item.titleId, item]));
  if (!result.data.titles.length) {
    list.replaceChildren(stateBox({ icon: "📚", text: `На полке «${filters[shelfFilter]}» пока пусто.`, action: { href: "/catalog", text: "Открыть каталог" } }));
    return;
  }
  list.replaceChildren(...result.data.titles.map((title) => shelfRow({ title, ...byId.get(title.id) }, { showNext: shelfFilter !== "dropped" })));
}

let calendarMine = false;

async function showCalendar() {
  const switcher = el("div", "chips");
  for (const [mine, label] of [[false, "Весь каталог"], [true, "Только моя полка"]]) {
    switcher.append(button(label, "chip", () => {
      calendarMine = mine;
      showCalendar();
    }, { pressed: calendarMine === mine }));
  }
  if (!user) switcher.lastChild.disabled = true;
  const content = el("div");
  content.append(...lineSkeletons(2, 160));
  body.replaceChildren(switcher, content);
  const result = await api(`/api/calendar${calendarMine ? "?mine=1" : ""}`);
  if (!result.ok) return content.replaceChildren(errorBox(result.data?.error || "Календарь не загрузился.", showCalendar));

  const today = new Date().getDay();
  const week = el("div", "week");
  for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
    const day = (today + offset) % 7;
    const box = el("section", `week-day${offset === 0 ? " is-today" : ""}`);
    box.append(el("h3", null, offset === 0 ? `Сегодня · ${DAYS[day]}` : DAYS[day]));
    const titles = result.data.week[day].titles;
    if (!titles.length) box.append(el("p", "muted small", "—"));
    for (const title of titles) {
      const a = link(`/title/${title.id}`, null, "");
      a.append(thumb(title), document.createTextNode(title.title));
      box.append(a);
    }
    week.append(box);
  }
  const timeline = el("div", "timeline");
  if (!result.data.recent.length) timeline.append(el("p", "muted", "За последние две недели новых глав нет."));
  for (const day of result.data.recent) {
    const group = el("section", "timeline-day");
    group.append(el("h3", null, new Date(`${day.day}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })));
    const list = el("div", "update-list");
    for (const chapter of day.chapters) {
      const item = el("div", "update-item");
      const text = el("div");
      const name = el("strong");
      name.append(link(`/read/${chapter.title.id}/${chapter.number}`, null, chapter.title.title));
      text.append(name, el("span", null, `${chapter.sideStory ? "Экстра · " : ""}Глава ${chapter.number}${chapter.name ? `: ${chapter.name}` : ""}`));
      item.append(thumb(chapter.title), text);
      list.append(item);
    }
    group.append(list);
    timeline.append(group);
  }
  const weekSection = el("section");
  weekSection.append(el("h2", "section-head", "Расписание на неделю"), week);
  const recentSection = el("section", "section");
  recentSection.append(el("h2", "section-head", "Вышло за 14 дней"), timeline);
  content.replaceChildren(weekSection, recentSection);
}

let noticeOnlyUnread = false;

async function showNotifications(before = null, list = null) {
  if (!list) {
    const head = el("div", "comment-form-actions");
    const chips = el("div", "chips");
    for (const [only, label] of [[false, "Все"], [true, "Непрочитанные"]]) {
      chips.append(button(label, "chip", () => {
        noticeOnlyUnread = only;
        showNotifications();
      }, { pressed: noticeOnlyUnread === only }));
    }
    head.append(chips, button("Прочитать все", "ghost-btn small-btn", async () => {
      const result = await api("/api/notifications", { method: "POST", body: { all: true } });
      if (!result.ok) return toast(result.data?.error || "Не удалось отметить.");
      setUnreadEverywhere(result.data.unread);
      showNotifications();
    }));
    list = el("div", "notice-list section");
    list.append(...lineSkeletons(4, 60));
    body.replaceChildren(head, list);
  }
  const params = new URLSearchParams({ limit: "30" });
  if (before) params.set("before", String(before));
  if (noticeOnlyUnread) params.set("unread", "1");
  const result = await api(`/api/notifications?${params}`);
  if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Уведомления не загрузились.", () => showNotifications()));
  if (!before) list.replaceChildren();
  list.querySelector(".load-more")?.remove();
  setUnreadEverywhere(result.data.unread);
  const { notifications } = result.data;
  if (!before && !notifications.length) {
    list.append(stateBox({ icon: "🔔", title: "Уведомлений нет", text: "Здесь появятся новые главы тайтлов с вашей полки, ответы и новые подписчики." }));
    return;
  }
  for (const notice of notifications) {
    const row = el("article", `notice${notice.read ? "" : " is-unread"}`);
    const text = el("div");
    const main = notice.link ? link(notice.link, null, notice.text) : el("span", null, notice.text);
    main.addEventListener("click", () => {
      if (!notice.read) api("/api/notifications", { method: "POST", body: { ids: [notice.id] } });
    });
    text.append(main, el("small", null, ` · ${timeAgo(notice.createdAt)}`));
    row.append(el("span", "notice-icon", NOTICE_ICONS[notice.kind] || "✦"), text);
    if (!notice.read) {
      row.append(button("Прочитано", "link-btn small", async () => {
        const marked = await api("/api/notifications", { method: "POST", body: { ids: [notice.id] } });
        if (!marked.ok) return;
        notice.read = true;
        row.classList.remove("is-unread");
        row.lastChild.remove();
        setUnreadEverywhere(marked.data.unread);
      }));
    }
    list.append(row);
  }
  if (notifications.length === 30) {
    const more = el("div", "load-more");
    more.append(button("Ещё", "ghost-btn", () => showNotifications(notifications.at(-1).id, list)));
    list.append(more);
  }
}

async function showHistory() {
  loading();
  const result = await api("/api/me/history");
  if (!result.ok) return body.replaceChildren(errorBox(result.data?.error || "История не загрузилась.", showHistory));
  if (!result.data.items.length) {
    return body.replaceChildren(stateBox({ icon: "🕘", title: "История пуста", text: "Здесь появятся страницы тайтлов, которые вы открывали." }));
  }
  const head = el("div", "comment-form-actions");
  head.append(el("p", "muted small", "Последние открытые тайтлы. История видна только вам."), button("Очистить историю", "ghost-btn small-btn", async () => {
    if (!confirm("Очистить историю просмотра?")) return;
    const cleared = await api("/api/me/history", { method: "DELETE", body: {} });
    if (cleared.ok) showHistory();
  }));
  const list = el("div", "update-list section");
  for (const item of result.data.items) {
    const row = el("div", "update-item");
    const text = el("div");
    const name = el("strong");
    name.append(link(`/title/${item.title.id}`, null, item.title.title));
    text.append(name, el("span", null, `${TYPE_LABELS[item.title.type]} · ${timeAgo(item.viewedAt)}`));
    row.append(thumb(item.title), text);
    list.append(row);
  }
  body.replaceChildren(head, list);
}

async function showSettings() {
  loading();
  const result = await api("/api/me/profile");
  if (!result.ok) return body.replaceChildren(errorBox(result.data?.error || "Настройки не загрузились.", showSettings));
  const { notify } = result.data.settings;
  const form = el("form", "panel stack");
  form.append(el("h2", null, "Уведомления"), el("p", "muted small", "Выберите, о чём сообщать. Уведомления приходят на сайте, в колокольчике в шапке."));
  const options = {
    chapters: "Новые главы тайтлов с моей полки (кроме брошенных)",
    replies: "Ответы на мои комментарии и комментарии к моим обсуждениям",
    follows: "Новые подписчики",
    achievements: "Полученные достижения"
  };
  for (const [key, label] of Object.entries(options)) {
    const row = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.name = key;
    box.checked = notify[key];
    row.append(box, document.createTextNode(label));
    form.append(row);
  }
  const save = el("button", "primary-btn", "Сохранить");
  save.type = "submit";
  const message = el("p", "form-error");
  message.setAttribute("role", "status");
  form.append(save, message);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.keys(options).map((key) => [key, form.elements.namedItem(key).checked]));
    const saved = await api("/api/me/profile", { method: "PATCH", body: { notify: values } });
    message.classList.toggle("is-success", saved.ok);
    message.textContent = saved.ok ? "Сохранено." : saved.data?.error || "Не удалось сохранить.";
  });
  body.replaceChildren(form);
}

const VIEWS = { reading: showReading, shelf: showShelf, calendar: showCalendar, notifications: showNotifications, history: showHistory, settings: showSettings };

function open(name, push = true) {
  const tab = TABS.includes(name) ? name : "reading";
  tabs.forEach((node) => {
    node.setAttribute("aria-selected", String(node.dataset.tab === tab));
    node.tabIndex = node.dataset.tab === tab ? 0 : -1;
  });
  if (push) history.replaceState(null, "", `#${tab}`);
  VIEWS[tab]();
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
window.addEventListener("hashchange", () => open(location.hash.slice(1), false));

async function init() {
  user = await initHeader();
  if (!user) {
    // Календарь доступен и гостю, остальное — только вошедшим
    if (location.hash === "#calendar") return open("calendar", false);
    body.replaceChildren(stateBox({
      icon: "📖", title: "Войдите, чтобы вести полку",
      text: "Pulse хранит прогресс чтения, статусы и уведомления о новых главах в вашем аккаунте — на любом устройстве.",
      action: { href: loginUrl(), text: "Войти или зарегистрироваться" }
    }));
    tabs.forEach((tab) => {
      if (tab.dataset.tab !== "calendar") tab.disabled = true;
    });
    return;
  }
  const me = await api("/api/notifications/count");
  if (me.ok) setUnreadEverywhere(me.data.unread);
  open(location.hash.slice(1), false);
}

init();
