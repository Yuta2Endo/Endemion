// Форум: категории, права на публикацию, закрепление и закрытие тем, экранирование, CSRF, профили и приватность активности

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "./helpers/app.mjs";

let app;

before(async () => {
  app = await createApp();
});

after(async () => {
  await app.close();
});

const topic = (subject, category = "general", extra = {}) => ({ kind: "discussion", subject, body: "Текст темы для проверки.", category, ...extra });

async function usernameOf(user) {
  const row = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(user.id).first();
  return row.username;
}

test("/community показывает категории, страница категории отвечает, неизвестная — 404", async () => {
  const guest = app.client();
  const index = await guest.call("GET", "/community");
  assert.equal(index.status, 200);
  assert.match(index.text, /href="\/community\/c\/general"/);
  assert.match(index.text, /href="\/community\/c\/bug-reports"/);
  assert.equal((await guest.call("GET", "/community/c/general")).status, 200);
  assert.equal((await guest.call("GET", "/community/c/nope")).status, 404);
});

test("тему создаёт только вошедший; без категории она попадает в General", async () => {
  assert.equal((await app.client().call("POST", "/api/threads", topic("Тема гостя"))).status, 401);
  const user = await app.user("Автор");
  const created = await user.call("POST", "/api/threads", { kind: "discussion", subject: "Тема без категории", body: "Текст." });
  assert.equal(created.status, 201);
  assert.equal(created.data.thread.category.slug, "general");
  assert.equal((await user.call("POST", "/api/threads", topic("Неизвестная категория", "nope"))).status, 404);
});

test("в категорию только для команды пишут модераторы", async () => {
  const user = await app.user("Игрок");
  const moderator = await app.user("Модератор", "moderator");
  assert.equal((await user.call("POST", "/api/threads", topic("Чужой devlog", "devlog"))).status, 403);
  const created = await moderator.call("POST", "/api/threads", topic("Запись devlog", "devlog"));
  assert.equal(created.status, 201);
  assert.equal(created.data.thread.category.slug, "devlog");
});

test("закреплять и закрывать могут только модераторы; закреплённая тема идёт первой", async () => {
  const author = await app.user("Автор закрепа");
  const moderator = await app.user("Модератор закрепа", "moderator");
  const first = await author.call("POST", "/api/threads", topic("Старая тема для закрепа", "events"));
  const second = await moderator.call("POST", "/api/threads", topic("Новая тема рядом", "events"));
  const id = first.data.thread.id;

  assert.equal((await app.client().call("PATCH", `/api/threads/${id}/moderation`, { pinned: true })).status, 401);
  assert.equal((await author.call("PATCH", `/api/threads/${id}/moderation`, { pinned: true })).status, 403);
  const pinned = await moderator.call("PATCH", `/api/threads/${id}/moderation`, { pinned: true });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.data.thread.pinned, true);

  const list = await app.client().call("GET", "/api/threads?category=events");
  assert.deepEqual(list.data.threads.map((t) => t.id).slice(0, 2), [id, second.data.thread.id]);
  const journal = await app.db.prepare("SELECT COUNT(*) AS n FROM moderation_actions WHERE action = 'thread.pin' AND target_id = ?").bind(id).first();
  assert.equal(journal.n, 1);
});

test("в закрытую тему отвечает только модератор, автор её не правит", async () => {
  const author = await app.user("Автор закрытой");
  const moderator = await app.user("Модератор закрытой", "moderator");
  const created = await author.call("POST", "/api/threads", topic("Тема, которую закроют", "off-topic"));
  const id = created.data.thread.id;
  const reply = (text) => ({ targetType: "thread", targetId: id, body: text });

  assert.equal((await author.call("POST", "/api/comments", reply("Ответ до закрытия"))).status, 201);
  const locked = await moderator.call("PATCH", `/api/threads/${id}/moderation`, { locked: true });
  assert.equal(locked.data.thread.locked, true);

  assert.equal((await author.call("POST", "/api/comments", reply("Ответ после закрытия"))).status, 409);
  assert.equal((await moderator.call("POST", "/api/comments", reply("Итог от модератора"))).status, 201);
  const edit = await author.call("PATCH", `/api/threads/${id}`, { subject: "Новый заголовок темы", body: "Новый текст." });
  assert.equal(edit.status, 409);

  await moderator.call("PATCH", `/api/threads/${id}/moderation`, { locked: false });
  assert.equal((await author.call("POST", "/api/comments", reply("Ответ после открытия"))).status, 201);
});

test("заголовок темы экранируется на странице категории, поиск находит тему", async () => {
  const user = await app.user("Автор поиска");
  const created = await user.call("POST", "/api/threads", topic("<img src=x onerror=alert(1)> редкоеслово", "creative"));
  assert.equal(created.status, 201);
  const page = await app.client().call("GET", "/community/c/creative");
  assert.doesNotMatch(page.text, /<img src=x/);
  assert.match(page.text, /&lt;img src=x/);
  const found = await app.client().call("GET", `/community/c/creative?q=${encodeURIComponent("редкоеслово")}`);
  assert.match(found.text, /редкоеслово/);
  const missing = await app.client().call("GET", `/community/c/creative?q=${encodeURIComponent("такогонет")}`);
  assert.match(missing.text, /Ничего не нашлось/);
});

test("запрос с чужого сайта отклоняется", async () => {
  const user = await app.user("Автор CSRF");
  const response = await user.call("POST", "/api/threads", topic("Тема с чужого сайта"), { origin: "https://evil.example" });
  assert.equal(response.status, 403);
});

test("/u/:username перенаправляет на /users/:username", async () => {
  const user = await app.user("Профильный");
  const username = await usernameOf(user);
  const redirect = await app.client().call("GET", `/u/${username}`);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), `/users/${username}`);
  assert.equal((await app.client().call("GET", `/users/${username}`)).status, 200);
});

test("активность на форуме видна в профиле, но скрывается настройками", async () => {
  const user = await app.user("Активный");
  const moderator = await app.user("Модератор профилей", "moderator");
  const username = await usernameOf(user);
  const created = await user.call("POST", "/api/threads", topic("Тема для профиля"));
  await user.call("POST", "/api/comments", { targetType: "thread", targetId: created.data.thread.id, body: "Ответ для профиля" });

  const open = await app.client().call("GET", `/api/users/${username}/forum`);
  assert.equal(open.status, 200);
  assert.equal(open.data.topicsCount, 1);
  assert.equal(open.data.postsCount, 1);
  assert.equal(open.data.topics[0].subject, "Тема для профиля");

  await app.db.prepare("UPDATE user_profiles SET show_activity = 0 WHERE user_id = ?").bind(user.id).run();
  assert.equal((await app.client().call("GET", `/api/users/${username}/forum`)).status, 403);
  assert.equal((await user.call("GET", `/api/users/${username}/forum`)).status, 200);
  assert.equal((await moderator.call("GET", `/api/users/${username}/forum`)).status, 200);

  await app.db.prepare("UPDATE user_profiles SET show_activity = 1, is_public = 0 WHERE user_id = ?").bind(user.id).run();
  assert.equal((await app.client().call("GET", `/api/users/${username}/forum`)).status, 403);
});
