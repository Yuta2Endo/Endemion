// Категория форума /community/c/:slug: кнопка «Новая тема» и форма. Список тем, поиск и страницы рисует сервер.
// В категорию «только для команды» пишут модераторы и админы — это проверяет и сервер

import { announceAchievements, api, button, checkbox, field, formValue, goal, initHeader, input, loginUrl, openDialog, textarea, toast } from "./app.js";

const main = document.querySelector("main");
const slug = main.dataset.category;
const staffOnly = main.dataset.staffOnly === "1";
const actions = document.querySelector("#categoryActions");

function newTopic() {
  return openDialog({
    title: "Новая тема",
    submitText: "Опубликовать",
    build(form) {
      form.append(
        field("Заголовок", input("subject", { maxLength: 140, placeholder: "Коротко о главном", required: true })),
        field("Текст", textarea("body", { maxLength: 10000, rows: 7, placeholder: "Ваши мысли, вопросы, предложения…" })),
        checkbox("spoiler", "Есть спойлеры")
      );
    },
    async onSubmit(form) {
      const result = await api("/api/threads", {
        method: "POST",
        body: { kind: "discussion", category: slug, subject: formValue(form, "subject"), body: formValue(form, "body"), spoiler: formValue(form, "spoiler") }
      });
      if (!result.ok) return result.data?.error || "Не удалось опубликовать.";
      goal("thread_create");
      announceAchievements(result.data.achievements);
      location.href = `/community/thread/${result.data.thread.id}`;
      return null;
    }
  });
}

/** Подписка на раздел: уведомление о каждой новой теме. Гостю предлагаем войти */
async function subscription(user) {
  const result = await api(`/api/categories/${encodeURIComponent(slug)}/subscription`);
  if (!result.ok) return;
  let subscribed = Boolean(result.data.subscribed);
  const label = () => (subscribed ? "Не следить за разделом" : "Следить за разделом");
  const toggle = button(label(), "ghost-btn", async () => {
    if (!user) return (location.href = loginUrl());
    const method = subscribed ? "DELETE" : "PUT";
    const changed = await api(`/api/categories/${encodeURIComponent(slug)}/subscription`, { method });
    if (!changed.ok) return toast(changed.data?.error || "Не удалось сохранить подписку.");
    subscribed = Boolean(changed.data.subscribed);
    toggle.textContent = label();
    toggle.setAttribute("aria-pressed", String(subscribed));
  }, { pressed: subscribed });
  actions.append(toggle);
}

async function init() {
  const user = await initHeader();
  const staff = Boolean(user && (user.isModerator || user.role === "admin" || user.role === "moderator"));
  if (staffOnly && !staff) return;
  await subscription(user);
  actions.append(button("＋ Новая тема", "primary-btn", () => (user ? newTopic() : (location.href = loginUrl()))));
}

init();
