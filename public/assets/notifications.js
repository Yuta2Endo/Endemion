// Уведомления /notifications: ответы на форуме, подписчики, достижения, решения модераторов и настройки уведомлений

import { api, button, el, errorBox, initHeader, lineSkeletons, link, loginUrl, setUnread, stateBox, timeAgo, toast } from "./app.js";

const body = document.querySelector("#noticeBody");
const NOTICE_ICONS = { reply: "💬", mention: "💬", follow: "👤", achievement: "🏆", moderation: "🛡", system: "✦" };
const PAGE = 30;

let onlyUnread = false;

async function showNotifications(before = null, list = null) {
  if (!list) {
    const head = el("div", "comment-form-actions");
    const chips = el("div", "chips");
    for (const [only, label] of [[false, "Все"], [true, "Непрочитанные"]]) {
      chips.append(button(label, "chip", () => {
        onlyUnread = only;
        showNotifications();
      }, { pressed: onlyUnread === only }));
    }
    head.append(chips, button("Прочитать все", "ghost-btn small-btn", async () => {
      const result = await api("/api/notifications", { method: "POST", body: { all: true } });
      if (!result.ok) return toast(result.data?.error || "Не удалось отметить.");
      setUnread(result.data.unread);
      showNotifications();
    }));
    list = el("div", "notice-list section");
    list.append(...lineSkeletons(4, 60));
    body.replaceChildren(head, list, settingsForm());
  }
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (before) params.set("before", String(before));
  if (onlyUnread) params.set("unread", "1");
  const result = await api(`/api/notifications?${params}`);
  if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Уведомления не загрузились.", () => showNotifications()));
  if (!before) list.replaceChildren();
  list.querySelector(".load-more")?.remove();
  setUnread(result.data.unread);
  const { notifications } = result.data;
  if (!before && !notifications.length) {
    list.append(stateBox({ icon: "🔔", title: "Уведомлений нет", text: "Здесь появятся ответы на ваши темы и сообщения, новые подписчики и достижения." }));
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
        setUnread(marked.data.unread);
      }));
    }
    list.append(row);
  }
  if (notifications.length === PAGE) {
    const more = el("div", "load-more");
    more.append(button("Ещё", "ghost-btn", () => showNotifications(notifications.at(-1).id, list)));
    list.append(more);
  }
}

/** Какие уведомления присылать. Настройки хранятся в профиле, сервер проверяет их при создании уведомления */
function settingsForm() {
  const form = el("form", "panel stack section");
  form.append(el("h2", null, "Настройки"), el("p", "muted small", "Уведомления приходят на сайте, в колокольчике в шапке."));
  const options = {
    replies: "Ответы на мои темы и сообщения",
    follows: "Новые подписчики",
    achievements: "Полученные достижения"
  };
  const boxes = {};
  for (const [key, label] of Object.entries(options)) {
    const row = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.name = key;
    boxes[key] = box;
    row.append(box, document.createTextNode(label));
    form.append(row);
  }
  const save = el("button", "primary-btn", "Сохранить");
  save.type = "submit";
  const message = el("p", "form-error");
  message.setAttribute("role", "status");
  form.append(save, message);
  api("/api/me/profile").then((result) => {
    if (!result.ok) return;
    for (const [key, box] of Object.entries(boxes)) box.checked = result.data.settings.notify[key];
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const notify = Object.fromEntries(Object.entries(boxes).map(([key, box]) => [key, box.checked]));
    const saved = await api("/api/me/profile", { method: "PATCH", body: { notify } });
    message.classList.toggle("is-success", saved.ok);
    message.textContent = saved.ok ? "Сохранено." : saved.data?.error || "Не удалось сохранить.";
  });
  return form;
}

async function init() {
  const user = await initHeader();
  if (!user) {
    body.replaceChildren(stateBox({
      icon: "🔔", title: "Войдите, чтобы видеть уведомления",
      text: "Уведомления об ответах, подписчиках и достижениях хранятся в вашем аккаунте.",
      action: { href: loginUrl(), text: "Войти или зарегистрироваться" }
    }));
    return;
  }
  showNotifications();
}

init();
