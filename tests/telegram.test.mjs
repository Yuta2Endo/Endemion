// Анонсы обновлений в Телеграм: формат сообщения, защита от дублей,
// повременные ошибки, лимиты, сухой режим, защита токена.

import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { createApp } from "./helpers/app.mjs";
import {
  formatAnnouncement, releaseProblems, announceRelease,
  isPublishingAllowed, channelOf
} from "../functions/_lib/telegram-announce.js";
import { maskToken, sendTelegramMessage } from "../functions/_lib/telegram.js";

let app;
let admin;
let realFetch;
let fetchCalls;
let responseQueue;

const TOKEN = "123456:ABC-defGHI4JKL567mnop89qrstuXY";

function stubFetch() {
  fetchCalls = [];
  responseQueue = [];
  realFetch = globalThis.fetch;
  // @ts-ignore — подмена fetch в тестах
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: init && init.method, body: init && init.body });
    const next = responseQueue.shift() || okResponse();
    const headers = next.headers instanceof Headers ? next.headers : new Headers(next.headers || {});
    return {
      ok: Boolean(next.ok),
      status: next.status || 200,
      headers,
      json: next.json || (async () => ({}))
    };
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function okResponse(messageId = 1) {
  return {
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ ok: true, result: { message_id: messageId } })
  };
}

function failResponse(status = 500) {
  return { ok: false, status, headers: new Headers(), json: async () => ({ ok: false }) };
}

function rateLimitResponse(retryAfter) {
  return {
    ok: false, status: 429, headers: new Headers({ "Retry-After": String(retryAfter) }),
    json: async () => ({ ok: false })
  };
}

async function createUpdatePost(ctx = {}, overrides = {}) {
  const { app: a = app, adminUser: ad = admin } = ctx;
  const game = await a.db.prepare("SELECT id, website_url FROM games WHERE slug = 'endemion-life'").first();
  assert.ok(game, "игры endemion-life нет в базе");
  const body = {
    slug: `update-${Math.random().toString(36).slice(2, 10)}`,
    kind: "update",
    status: "published",
    title: "Обновление Endemion Life",
    summary: "",
    body: "Новые миры, исправления ошибок и улучшения производительности.",
    gameId: game.id,
    version: "1.2.0",
    ...overrides
  };
  const r = await ad.call("POST", "/api/admin/studio-posts", body);
  assert.equal(r.status, 201, r.text);
  return r.data.post;
}

before(async () => {
  app = await createApp({
    extraEnv: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHANNEL: "@EndemionOfficial",
      TELEGRAM_PUBLISH: "1"
    }
  });
  admin = await app.user("Администратор", "admin");
});

after(async () => {
  await app.close();
});

beforeEach(stubFetch);
afterEach(restoreFetch);

test("маска токена скрывает его середину", () => {
  const masked = maskToken(TOKEN);
  assert.notEqual(masked, TOKEN);
  assert.ok(masked.startsWith("1234"));
  assert.ok(masked.endsWith("tuXY"));
  assert.ok(!masked.includes(TOKEN));
});

test("технический канал по умолчанию — @EndemionOfficial", () => {
  assert.equal(channelOf({}), "@EndemionOfficial");
  assert.equal(channelOf({ TELEGRAM_CHANNEL: "@ЧужойКанал" }), "@ЧужойКанал");
  assert.equal(isPublishingAllowed({ TELEGRAM_PUBLISH: "1" }), true);
  assert.equal(isPublishingAllowed({ TELEGRAM_PUBLISH: "0" }), false);
  assert.equal(isPublishingAllowed({}), false);
});

test("формат анонса: версия, заголовок, заметки, дата, ссылка на игру, канал", () => {
  const text = formatAnnouncement({
    version: "1.2.0",
    title: "Обновление Endemion Life",
    notes: "Новые миры и исправления ошибок.",
    date: "2026-11-09",
    gameUrl: "https://life.endemion.online"
  });
  assert.match(text, /🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ/);
  assert.match(text, /Версия: 1\.2\.0/);
  assert.match(text, /Обновление Endemion Life/);
  assert.match(text, /✨ Что нового:/);
  assert.match(text, /Новые миры и исправления ошибок/);
  assert.match(text, /📅 9 ноября 2026/);
  assert.match(text, /🎮 Играть:/);
  assert.match(text, /https:\/\/life\.endemion\.online/);
  assert.match(text, /Официальный Телеграм:/);
  assert.match(text, /https:\/\/t\.me\/EndemionOfficial/);
  assert.ok(text.length <= 4000, `сообщение слишком длинное: ${text.length}`);
});

test("формат анонса без версии", () => {
  const text = formatAnnouncement({
    version: null,
    title: "Обновление",
    notes: "Заметки.",
    date: "",
    gameUrl: "https://life.endemion.online"
  });
  assert.ok(!/Версия:/.test(text));
  assert.match(text, /🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ/);
  assert.match(text, /https:\/\/t\.me\/EndemionOfficial/);
});

test("нехватка данных релиза определяется без отправки", () => {
  assert.equal(releaseProblems({ title: "", notes: "", gameUrl: "" }).length, 3);
  assert.equal(releaseProblems({ title: "Т", notes: "Н", gameUrl: "https://life.endemion.online" }).length, 0);
});

test("успешная публикация: сообщение ушло в канал, запись published, без дубля", async () => {
  responseQueue.push(okResponse(42));
  const post = await createUpdatePost();
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.messageId, 42);
  assert.equal(result.duplicate, undefined);

  const row = await app.db.prepare("SELECT * FROM telegram_posts WHERE post_id = ?").bind(post.id).first();
  assert.equal(row.status, "published");
  assert.equal(row.message_id, 42);
  assert.equal(row.chat_id, "@EndemionOfficial");
  assert.equal(row.error, null);

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /^https:\/\/api\.telegram\.org\/bot.+\/sendMessage$/);
  assert.match(fetchCalls[0].url, new RegExp(`bot${TOKEN}/sendMessage`));
  assert.equal(fetchCalls[0].method, "POST");
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.chat_id, "@EndemionOfficial");
  assert.equal(body.disable_web_page_preview, false);
  assert.ok(body.text.includes("Версия: 1.2.0"));
  assert.ok(body.text.includes("Обновление Endemion Life"));
  assert.ok(body.text.includes("Новые миры, исправления ошибок и улучшения производительности."));
  assert.ok(body.text.includes("https://life.endemion.online"));
  assert.ok(body.text.includes("https://t.me/EndemionOfficial"));
});

test("повторная публикация того же поста — дубль, повторной отправки нет", async () => {
  responseQueue.push(okResponse(42));
  const post = await createUpdatePost();
  const first = await announceRelease(app.env, post.id);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, undefined);

  const second = await announceRelease(app.env, post.id);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.messageId, 42);

  assert.equal(fetchCalls.length, 1, "до канала ушло ровно одно сообщение");
  const rows = await app.db.prepare("SELECT COUNT(*) AS n FROM telegram_posts WHERE post_id = ?").bind(post.id).all();
  assert.equal(rows.results[0].n, 1);
});

test("нехватка данных: публикация без ссылки на игру не уходит, записи нет", async () => {
  const gameNoUrl = await app.db.prepare("SELECT id FROM games WHERE slug = 'tetrus'").first();
  assert.ok(gameNoUrl);
  const insert = await app.db.prepare(
    `INSERT INTO studio_posts (slug, kind, status, title, summary, body, game_id, author_id, version, published_at)
     VALUES (?, 'update', 'published', 'Выпуск без ссылки на игру', '', 'Заметки есть.', ?, 1, '1.0', datetime('now'))`
  ).bind(`no-url-${Math.random().toString(36).slice(2, 10)}`, gameNoUrl.id).run();
  const postId = insert.meta.last_row_id;
  const result = await announceRelease(app.env, postId);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("Ссылка на игру не указана."));
  assert.equal(fetchCalls.length, 0);
  const n = await app.db.prepare("SELECT COUNT(*) AS n FROM telegram_posts WHERE post_id = ?").bind(postId).all();
  assert.equal(n.results[0].n, 0);
});

test("нехватка данных: публикация без заметок не уходит", async () => {
  const post = await createUpdatePost();
  await app.db.prepare("UPDATE studio_posts SET body = '' WHERE id = ?").bind(post.id).run();
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("Заметки к выпуску не указаны."));
  assert.equal(fetchCalls.length, 0);
});

test("неопубликованная запись не анонсируется", async () => {
  const post = await createUpdatePost({}, { status: "draft" });
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("не опубликована"));
  assert.equal(fetchCalls.length, 0);
});

test("запись не обновления не анонсируется", async () => {
  const post = await createUpdatePost({}, { kind: "news" });
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("только для обновлений"));
  assert.equal(fetchCalls.length, 0);
});

test("ошибка Telegram API: запись failed, ошибка без токена, источник не блокируется", async () => {
  responseQueue.push(failResponse(500), failResponse(500), failResponse(500));
  const post = await createUpdatePost();
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, false);
  assert.match(result.error, /Telegram API ответил 500/);
  assert.ok(!result.error.includes(TOKEN));

  const row = await app.db.prepare("SELECT * FROM telegram_posts WHERE post_id = ?").bind(post.id).first();
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.equal(row.message_id, null);
  assert.equal(fetchCalls.length, 3);
});

test("повтор после временной ошибки: 500, затем успех", async () => {
  responseQueue.push(failResponse(500), okResponse(77));
  const post = await createUpdatePost();
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, true);
  assert.equal(result.messageId, 77);
  assert.equal(fetchCalls.length, 2);
  const row = await app.db.prepare("SELECT status FROM telegram_posts WHERE post_id = ?").bind(post.id).first();
  assert.equal(row.status, "published");
});

test("лимит 429: все исчерпанные попытки, Retry-After в ошибке", async () => {
  responseQueue.push(rateLimitResponse(1), rateLimitResponse(1), rateLimitResponse(1));
  const post = await createUpdatePost();
  const result = await announceRelease(app.env, post.id);
  assert.equal(result.ok, false);
  assert.equal(result.retryAfter, 1);
  assert.ok(!result.error.includes(TOKEN));
  assert.equal(fetchCalls.length, 3);
  const row = await app.db.prepare("SELECT status FROM telegram_posts WHERE post_id = ?").bind(post.id).first();
  assert.equal(row.status, "failed");
});

test("сухой режим: текст без отправки и без записи в базу", async () => {
  const post = await createUpdatePost();
  const result = await announceRelease(app.env, post.id, { dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.text.includes("🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ"));
  assert.equal(fetchCalls.length, 0);
  const n = await app.db.prepare("SELECT COUNT(*) AS n FROM telegram_posts WHERE post_id = ?").bind(post.id).all();
  assert.equal(n.results[0].n, 0);
});

test("публикация выключена (TELEGRAM_PUBLISH=0): ошибка конфигурации, без отправки", async () => {
  const post = await createUpdatePost();
  const result = await announceRelease({ ...app.env, TELEGRAM_PUBLISH: "0" }, post.id);
  assert.equal(result.ok, false);
  assert.equal(result.configure, true);
  assert.ok(result.error.includes("TELEGRAM_PUBLISH=1"));
  assert.equal(fetchCalls.length, 0);
});

test("токен не попадает в логи при ошибке", async () => {
  responseQueue.push(failResponse(500), failResponse(500), failResponse(500));
  const post = await createUpdatePost();
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(String(args.join(" ")));
  const result = await announceRelease(app.env, post.id);
  console.error = realError;
  assert.equal(result.ok, false);
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes(TOKEN));
  assert.match(logged[0], /не доставлен/);
});

test("отсутствие токена: ошибка конфигурации, без исключения", async () => {
  const post = await createUpdatePost();
  const result = await announceRelease({ ...app.env, TELEGRAM_BOT_TOKEN: undefined }, post.id);
  assert.equal(result.ok, false);
  assert.equal(result.configure, true);
  assert.ok(result.error.includes("TELEGRAM_BOT_TOKEN"));
  assert.equal(fetchCalls.length, 0);
});

// ==================== АДМИН-АПИ ====================

test("превью анонса: админ видит текст, гость — 401, нехватка данных — 400", async () => {
  const post = await createUpdatePost();
  const r = await admin.call("GET", `/api/admin/studio-posts/${post.id}/telegram-preview`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.text.includes("🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ"));
  assert.equal(fetchCalls.length, 0);

  const guest = app.client();
  const g = await guest.call("GET", `/api/admin/studio-posts/${post.id}/telegram-preview`);
  assert.equal(g.status, 401);

  const bad = await createUpdatePost({}, { status: "draft" });
  await app.db.prepare("UPDATE studio_posts SET body = '' WHERE id = ?").bind(bad.id).run();
  const b = await admin.call("GET", `/api/admin/studio-posts/${bad.id}/telegram-preview`);
  assert.equal(b.status, 400);
  assert.ok(b.data.problems.join(" ").includes("Заметки"));
});

test("публикация через админ-API: сухой режим без отправки, реальная — с отправкой", async () => {
  const post = await createUpdatePost();

  const dry = await admin.call("POST", `/api/admin/studio-posts/${post.id}/telegram-publish`, { dryRun: true });
  assert.equal(dry.status, 201, dry.text);
  assert.equal(dry.data.ok, true);
  assert.equal(dry.data.dryRun, true);
  assert.equal(fetchCalls.length, 0);

  responseQueue.push(okResponse(9));
  const real = await admin.call("POST", `/api/admin/studio-posts/${post.id}/telegram-publish`, {});
  assert.equal(real.status, 201, real.text);
  assert.equal(real.data.ok, true);
  assert.equal(real.data.messageId, 9);
  assert.equal(fetchCalls.length, 1);

  const again = await admin.call("POST", `/api/admin/studio-posts/${post.id}/telegram-publish`, {});
  assert.equal(again.status, 200, again.text);
  assert.equal(again.data.duplicate, true);
  assert.equal(fetchCalls.length, 1);
});

test("публикация через админ-API без TELEGRAM_PUBLISH=1 — 409", async () => {
  const restricted = await createApp({
    extraEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHANNEL: "@EndemionOfficial", TELEGRAM_PUBLISH: "0" }
  });
  try {
    const restrictedAdmin = await restricted.user("Админ2", "admin");
    const post = await createUpdatePost({ app: restricted, adminUser: restrictedAdmin });
    const r = await restrictedAdmin.call("POST", `/api/admin/studio-posts/${post.id}/telegram-publish`, {});
    assert.equal(r.status, 409, r.text);
    assert.equal(r.data.configure, true);
  } finally {
    await restricted.close();
  }
});

test("список неопубликованных обновлений: есть до публикации, нет после", async () => {
  const before = await admin.call("GET", "/api/admin/telegram/pending");
  assert.equal(before.status, 200);

  const post = await createUpdatePost();
  const afterCreate = await admin.call("GET", "/api/admin/telegram/pending");
  assert.ok(afterCreate.data.pending.some((p) => p.slug === post.slug));

  responseQueue.push(okResponse(5));
  await announceRelease(app.env, post.id);

  const afterPublish = await admin.call("GET", "/api/admin/telegram/pending");
  assert.equal(afterPublish.data.pending.map((p) => p.id).includes(post.id), false);
});

test("отсутствующая публикация — 404", async () => {
  const r = await admin.call("GET", "/api/admin/studio-posts/999999/telegram-preview");
  assert.equal(r.status, 404);
  const p = await admin.call("POST", "/api/admin/studio-posts/999999/telegram-publish", {});
  assert.equal(p.status, 404);
  assert.equal(p.data.notFound, true);
});

test("режим посредника: сообщение уходит в воркер мониторинга, токен не нужен", async () => {
  const env = { TELEGRAM_RELAY_URL: "https://monitor.example.workers.dev/", TELEGRAM_RELAY_KEY: "k-123" };
  responseQueue.push(okResponse(77));
  const result = await sendTelegramMessage(env, "@EndemionOfficial", "Привет из теста");
  assert.equal(result.ok, true);
  assert.equal(result.messageId, 77);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://monitor.example.workers.dev/admin?key=k-123");
  const body = JSON.parse(fetchCalls[0].body);
  assert.equal(body.method, "sendMessage");
  assert.equal(body.params.chat_id, "@EndemionOfficial");
  assert.equal(body.params.text, "Привет из теста");
  assert.equal(body.params.link_preview_options.is_disabled, false);
});

test("ошибка Telegram через посредника берётся из тела ответа", async () => {
  const env = { TELEGRAM_RELAY_URL: "https://monitor.example.workers.dev", TELEGRAM_RELAY_KEY: "k-123" };
  responseQueue.push({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" })
  });
  const result = await sendTelegramMessage(env, "@nowhere", "текст");
  assert.equal(result.ok, false);
  assert.match(String(result.error), /chat not found/);
});
