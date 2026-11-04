// Публичные страницы портала: главная, меню, игры, разработка, «О студии». Черновики, заглушки, заголовки безопасности

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

const SEED_GAMES = ["Endemion Life", "TETRUS", "LIFE_CITY", "OS Developer Simulator", "Liforae"];

test("страницы портала отвечают 200, неизвестный адрес — 404 с noindex", async () => {
  const guest = app.client();
  for (const path of ["/", "/games", "/games/endemion-life", "/studio", "/studio?tab=devlog", "/studio?tab=history", "/about", "/community"]) {
    assert.equal((await guest.call("GET", path)).status, 200, path);
  }
  const missing = await guest.call("GET", "/games/no-such-game");
  assert.equal(missing.status, 404);
  assert.match(missing.text, /<meta name="robots" content="noindex/);
});

test("в меню нет энциклопедии, но её адреса и прежние разделы работают", async () => {
  const guest = app.client();
  const home = await guest.call("GET", "/");
  for (const href of ["/games", "/community", "/studio", "/about"]) assert.match(home.text, new RegExp(`href="${href}"`), href);
  assert.doesNotMatch(home.text, /href="\/encyclopedia"/);
  for (const path of ["/encyclopedia", "/anime", "/manga", "/reading", "/catalog"]) {
    assert.equal((await guest.call("GET", path)).status, 200, path);
  }
});

test("главная: приветствие, игры из каталога, ссылка на Endemion Life, без ссылок на магазины", async () => {
  const home = await app.client().call("GET", "/");
  assert.match(home.text, /Welcome to Endemion/);
  for (const title of SEED_GAMES) assert.ok(home.text.includes(title), title);
  assert.match(home.text, /href="https:\/\/life\.endemion\.online"/);
  // Обложек у игр из миграции нет: показывается подписанная заглушка, а не выдуманная картинка
  assert.match(home.text, /Обложка скоро появится/);
  assert.doesNotMatch(home.text, /play\.google\.com|apps\.apple\.com|store\.steampowered\.com/);
});

test("«Будущие проекты» появляются только для игр, отмеченных администратором", async () => {
  assert.doesNotMatch((await app.client().call("GET", "/")).text, /id="upcomingTitle"/);
  await app.db.prepare("UPDATE games SET is_upcoming = 1 WHERE slug = 'liforae'").run();
  try {
    const home = await app.client().call("GET", "/");
    assert.match(home.text, /id="upcomingTitle"/);
    assert.match((await app.client().call("GET", "/games")).text, /id="upcomingTitle"/);
  } finally {
    await app.db.prepare("UPDATE games SET is_upcoming = 0 WHERE slug = 'liforae'").run();
  }
});

test("неопубликованная игра скрыта от гостей и видна администратору", async () => {
  const admin = await app.user("Админ витрины", "admin");
  await app.db.prepare("UPDATE games SET published = 0 WHERE slug = 'tetrus'").run();
  try {
    const guest = app.client();
    assert.ok(!(await guest.call("GET", "/games")).text.includes('href="/games/tetrus"'));
    assert.equal((await guest.call("GET", "/games/tetrus")).status, 404);
    assert.equal((await guest.call("GET", "/community/c/tetrus")).status, 404);
    const own = await admin.call("GET", "/games/tetrus");
    assert.equal(own.status, 200);
    assert.match(own.text, /<meta name="robots" content="noindex/);
  } finally {
    await app.db.prepare("UPDATE games SET published = 1 WHERE slug = 'tetrus'").run();
  }
});

test("черновик публикации: гостю 404, администратору страница с пометкой", async () => {
  const admin = await app.user("Редактор", "admin");
  const created = await admin.call("POST", "/api/admin/studio-posts", { slug: "secret-plan", kind: "announcement", status: "draft", title: "Секретный анонс", summary: "", body: "Текст.", gameId: null });
  assert.equal(created.status, 201);
  assert.equal((await app.client().call("GET", "/studio/secret-plan")).status, 404);
  assert.doesNotMatch((await app.client().call("GET", "/")).text, /Секретный анонс/);
  const own = await admin.call("GET", "/studio/secret-plan");
  assert.equal(own.status, 200);
  assert.match(own.text, /Черновик: видна только администраторам/);
});

test("текст и ссылки из настроек экранируются на странице «О студии»", async () => {
  const admin = await app.user("Админ настроек", "admin");
  const saved = await admin.call("PUT", "/api/admin/site-settings", {
    featuredGame: "endemion-life",
    aboutText: "<script>alert(1)</script>",
    socialLinks: [{ label: "<b>Discord</b>", url: "https://discord.gg/endemion" }]
  });
  assert.equal(saved.status, 200);
  const about = await app.client().call("GET", "/about");
  assert.doesNotMatch(about.text, /<script>alert/);
  assert.match(about.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(about.text, /&lt;b&gt;Discord&lt;\/b&gt;/);
  assert.match(about.text, /href="https:\/\/discord\.gg\/endemion"/);
});

test("HTML-страницы отдаются с заголовками безопасности", async () => {
  for (const path of ["/", "/games", "/studio", "/community"]) {
    const { headers } = await app.client().call("GET", path);
    assert.match(headers.get("content-security-policy") || "", /default-src 'self'/, path);
    assert.match(headers.get("content-security-policy") || "", /script-src 'self'(?! 'unsafe-inline')/, path);
    assert.equal(headers.get("x-frame-options"), "DENY", path);
    assert.equal(headers.get("x-content-type-options"), "nosniff", path);
  }
});
