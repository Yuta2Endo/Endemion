// Страница темы форума: текст, автор, категория, правка и удаление, жалоба, закрепление и закрытие (модераторы), ответы.
// Права проверяет сервер; кнопки здесь только отражают то, что он разрешит

import {
  api, button, checkbox, el, errorBox, field, formValue, initHeader, input, link, openDialog, reportContent,
  spoilerText, stateBox, textarea, timeAgo, toast, userLink
} from "./app.js";
import { mountComments } from "./comments.js";

const id = Number(document.querySelector("main").dataset.threadId);
const post = document.querySelector("#post");
const aside = document.querySelector("#threadAside");

let user = null;

function crumbs(thread) {
  const nav = document.querySelector(".breadcrumbs");
  const parts = [link("/community", null, "Сообщество")];
  if (thread.category) parts.push(link(`/community/c/${encodeURIComponent(thread.category.slug)}`, null, thread.category.title));
  const current = el("span", null, thread.subject);
  current.id = "crumb";
  parts.push(current);
  nav.replaceChildren();
  parts.forEach((part, i) => {
    if (i) {
      const sep = el("span", null, " / ");
      sep.setAttribute("aria-hidden", "true");
      nav.append(sep);
    }
    nav.append(part);
  });
}

async function moderate(change) {
  const result = await api(`/api/threads/${id}/moderation`, { method: "PATCH", body: change });
  if (!result.ok) return toast(result.data?.error || "Не удалось.");
  const wasLocked = post.dataset.locked === "1";
  render(result.data.thread);
  if (wasLocked !== result.data.thread.locked) mount(result.data.thread);
  toast("Сохранено.");
}

function render(thread) {
  document.title = `${thread.subject} | Endemion`;
  crumbs(thread);
  post.removeAttribute("aria-busy");
  post.dataset.locked = thread.locked ? "1" : "0";
  const badges = el("div", "thread-meta");
  if (thread.pinned) badges.append(el("span", "tag is-strong", "📌 Закреплена"));
  if (thread.locked) badges.append(el("span", "tag is-strong", "🔒 Закрыта"));
  if (thread.category) badges.append(link(`/community/c/${encodeURIComponent(thread.category.slug)}`, "tag", thread.category.title));
  else badges.append(el("span", `kind-badge${thread.kind === "theory" ? " is-theory" : ""}`, thread.kind === "theory" ? "Теория" : "Обсуждение"));
  if (thread.title) badges.append(link(`/title/${thread.title.id}`, "tag", thread.title.title));
  if (thread.spoiler) badges.append(el("span", "tag", "Спойлеры: нажмите на текст, чтобы открыть"));
  const author = el("div", "thread-meta");
  author.append(userLink(thread.author), el("span", null, timeAgo(thread.createdAt)));
  const text = el("p", "post-body", thread.body);
  const actions = el("div", "section-actions section");
  if (thread.canEdit) actions.append(button("Изменить", "ghost-btn small-btn", () => edit(thread)));
  if (thread.canDelete) {
    actions.append(button("Удалить", "danger-btn small-btn", async () => {
      if (!confirm(thread.author?.id === user?.id ? "Удалить тему?" : "Удалить тему как модератор?")) return;
      const result = await api(`/api/threads/${id}`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
      location.href = thread.category ? `/community/c/${encodeURIComponent(thread.category.slug)}` : "/community";
    }));
  }
  if (thread.canModerate) {
    actions.append(
      button(thread.pinned ? "Открепить" : "Закрепить", "ghost-btn small-btn", () => moderate({ pinned: !thread.pinned }), { pressed: thread.pinned }),
      button(thread.locked ? "Открыть тему" : "Закрыть тему", "ghost-btn small-btn", () => moderate({ locked: !thread.locked }), { pressed: thread.locked })
    );
  }
  if (user && thread.author?.id !== user.id) actions.append(button("Пожаловаться", "ghost-btn small-btn", () => reportContent("thread", id)));
  post.replaceChildren(badges, el("h1", null, thread.subject), author, spoilerText(text, thread.spoiler), actions);

  aside.replaceChildren();
  if (thread.title) {
    const panel = el("section", "panel");
    panel.append(el("h2", null, "О тайтле"), link(`/title/${thread.title.id}`, "ghost-btn", `«${thread.title.title}» →`));
    aside.append(panel);
  }
  const rules = el("section", "panel");
  rules.append(el("h2", null, "Правила"), el("p", "muted small",
    "Уважайте собеседников, прячьте спойлеры под пометкой, не публикуйте спам и чужие личные данные. Нарушения можно отправить модераторам кнопкой «Пожаловаться»."));
  aside.append(rules);
}

async function edit(thread) {
  await openDialog({
    title: "Изменить тему",
    build(form) {
      form.append(
        field("Заголовок", input("subject", { value: thread.subject, maxLength: 140 })),
        field("Текст", textarea("body", { value: thread.body, maxLength: 10000, rows: 8 })),
        checkbox("spoiler", "Есть спойлеры", thread.spoiler)
      );
    },
    async onSubmit(form) {
      const result = await api(`/api/threads/${id}`, {
        method: "PATCH",
        body: { subject: formValue(form, "subject"), body: formValue(form, "body"), spoiler: formValue(form, "spoiler") }
      });
      if (!result.ok) return result.data?.error || "Не удалось сохранить.";
      render(result.data.thread);
      return null;
    }
  });
}

function mount(thread) {
  mountComments(document.querySelector("#comments"), {
    targetType: "thread", targetId: id, placeholder: "Ваш ответ…", locked: thread.locked && !user?.isModerator
  });
}

async function init() {
  user = await initHeader();
  const result = await api(`/api/threads/${id}`);
  if (result.status === 404) {
    post.replaceChildren(stateBox({ icon: "🔭", title: "Тема не найдена", text: "Возможно, её удалили.", action: { href: "/community", text: "В сообщество" } }));
    document.querySelector("#comments").hidden = true;
    return;
  }
  if (!result.ok) return post.replaceChildren(errorBox(result.data?.error || "Не загрузилось.", init));
  render(result.data.thread);
  mount(result.data.thread);
}

init();
