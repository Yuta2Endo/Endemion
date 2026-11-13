// Категория форума /community/c/:slug: кнопка «Новая тема» и форма. Список тем, поиск и страницы рисует сервер.
// В категорию «только для команды» пишут модераторы и админы — это проверяет и сервер

import { announceAchievements, api, button, checkbox, field, formValue, goal, initHeader, input, loginUrl, openDialog, textarea } from "./app.js";

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

async function init() {
  const user = await initHeader();
  const staff = Boolean(user && (user.isModerator || user.role === "admin" || user.role === "moderator"));
  if (staffOnly && !staff) return;
  actions.append(button("＋ Новая тема", "primary-btn", () => (user ? newTopic() : (location.href = loginUrl()))));
}

init();
