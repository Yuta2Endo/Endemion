// Страница обсуждения или теории: текст, автор, правка и удаление, жалоба, комментарии с ответами

import {
  api, button, checkbox, el, errorBox, field, formValue, initHeader, input, link, openDialog, reportContent,
  spoilerText, stateBox, textarea, timeAgo, toast, userLink
} from "./app.js";
import { mountComments } from "./comments.js";

const id = Number(document.querySelector("main").dataset.threadId);
const post = document.querySelector("#post");
const aside = document.querySelector("#threadAside");

let user = null;

function render(thread) {
  document.title = `${thread.subject} | ENDEMION`;
  document.querySelector("#crumb").textContent = thread.subject;
  post.removeAttribute("aria-busy");
  const badges = el("div", "thread-meta");
  badges.append(el("span", `kind-badge${thread.kind === "theory" ? " is-theory" : ""}`, thread.kind === "theory" ? "Теория" : "Обсуждение"));
  if (thread.title) badges.append(link(`/title/${thread.title.id}`, "tag", thread.title.title));
  if (thread.spoiler) badges.append(el("span", "tag", "Спойлеры: нажмите на текст, чтобы открыть"));
  const author = el("div", "thread-meta");
  author.append(userLink(thread.author), el("span", null, timeAgo(thread.createdAt)));
  const text = el("p", "post-body", thread.body);
  const actions = el("div", "section-actions section");
  if (thread.canEdit) actions.append(button("Изменить", "ghost-btn small-btn", () => edit(thread)));
  if (thread.canDelete) {
    actions.append(button("Удалить", "danger-btn small-btn", async () => {
      if (!confirm(thread.canEdit ? "Удалить обсуждение?" : "Удалить обсуждение как модератор?")) return;
      const result = await api(`/api/threads/${id}`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
      location.href = "/community";
    }));
  }
  if (user && !thread.canEdit) actions.append(button("Пожаловаться", "ghost-btn small-btn", () => reportContent("thread", id)));
  post.replaceChildren(badges, el("h1", null, thread.subject), author, spoilerText(text, thread.spoiler), actions);

  aside.replaceChildren();
  if (thread.title) {
    const panel = el("section", "panel");
    panel.append(el("h2", null, "О тайтле"), link(`/title/${thread.title.id}`, "ghost-btn", `«${thread.title.title}» →`));
    const more = link(`/oracle?mood=similar&title=${thread.title.id}`, "link-btn small", "Найти похожее в Oracle");
    panel.append(el("p", "section"), more);
    aside.append(panel);
  }
  const rules = el("section", "panel");
  rules.append(el("h2", null, "Правила"), el("p", "muted small",
    "Уважайте собеседников, прячьте спойлеры под пометкой, не публикуйте ссылки на пиратские сайты. Нарушения можно отправить модераторам кнопкой «Пожаловаться»."));
  aside.append(rules);
}

async function edit(thread) {
  await openDialog({
    title: "Изменить обсуждение",
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

async function init() {
  user = await initHeader();
  const result = await api(`/api/threads/${id}`);
  if (result.status === 404) {
    post.replaceChildren(stateBox({ icon: "🔭", title: "Обсуждение не найдено", text: "Возможно, его удалили.", action: { href: "/community", text: "В сообщество" } }));
    document.querySelector("#comments").hidden = true;
    return;
  }
  if (!result.ok) return post.replaceChildren(errorBox(result.data?.error || "Не загрузилось.", init));
  render(result.data.thread);
  mountComments(document.querySelector("#comments"), { targetType: "thread", targetId: id, placeholder: "Ваш ответ…" });
}

init();
