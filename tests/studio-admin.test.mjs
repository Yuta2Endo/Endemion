// Админка портала: игры, публикации студии, категории форума, настройки сайта. Права, черновики, картинки, журнал

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "./helpers/app.mjs";

let app;
let admin;
let moderator;
let user;

before(async () => {
  app = await createApp();
  admin = await app.user("Админ портала", "admin");
  moderator = await app.user("Модератор портала", "moderator");
  user = await app.user("Игрок портала");
});

after(async () => {
  await app.close();
});

// Картинка 1×1 PNG
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
const image = (bytes, type = "image/png") => ({ headers: { "Content-Type": type, "Content-Length": String(bytes.byteLength) } });

const game = (slug, extra = {}) => ({ slug, title: `Игра ${slug}`, tagline: "", description: "", status: null, platforms: "", websiteUrl: "", position: 50, published: true, isUpcoming: false, ...extra });
const post = (slug, extra = {}) => ({ slug, kind: "devlog", status: "draft", title: `Запись ${slug}`, summary: "", body: "Текст записи.", gameId: null, ...extra });

async function auditCount(action) {
  return (await app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").bind(action).first()).n;
}

test("разделы портала доступны только администратору: гость 401, игрок и модератор 403", async () => {
  const guest = app.client();
  const paths = ["/api/admin/games", "/api/admin/studio-posts", "/api/admin/forum-categories", "/api/admin/site-settings"];
  for (const path of paths) {
    assert.equal((await guest.call("GET", path)).status, 401, path);
    assert.equal((await user.call("GET", path)).status, 403, path);
    assert.equal((await moderator.call("GET", path)).status, 403, path);
    assert.equal((await admin.call("GET", path)).status, 200, path);
  }
  assert.equal((await moderator.call("POST", "/api/admin/games", game("mod-game"))).status, 403);
  assert.equal((await user.call("PUT", "/api/admin/site-settings", { featuredGame: "", socialLinks: [], aboutText: "" })).status, 403);
  assert.equal(await app.db.prepare("SELECT id FROM games WHERE slug = 'mod-game'").first(), null);
});

test("запись в админку с чужого сайта отклоняется (CSRF)", async () => {
  const r = await admin.call("POST", "/api/admin/games", game("csrf-game"), { origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal(await app.db.prepare("SELECT id FROM games WHERE slug = 'csrf-game'").first(), null);
});

test("игра: создание, проверка данных, черновик скрыт, категория форума, журнал", async () => {
  assert.equal((await admin.call("POST", "/api/admin/games", game("Bad Slug"))).status, 400);
  assert.equal((await admin.call("POST", "/api/admin/games", game("bad-url", { websiteUrl: "javascript:alert(1)" }))).status, 400);
  assert.equal((await admin.call("POST", "/api/admin/games", game("bad-status", { status: "hacked" }))).status, 400);
  assert.equal((await admin.call("POST", "/api/admin/games", game("tetrus"))).status, 409);

  const created = await admin.call("POST", "/api/admin/games", game("new-game", { published: false, title: "<b>Новая</b>" }));
  assert.equal(created.status, 201);
  const id = created.data.game.id;
  assert.equal(created.data.game.published, false);
  assert.equal((await app.client().call("GET", "/games/new-game")).status, 404);
  const category = await app.db.prepare("SELECT section FROM forum_categories WHERE game_id = ?").bind(id).first();
  assert.equal(category.section, "games");

  const published = await admin.call("PUT", `/api/admin/games/${id}`, game("new-game", { title: "<b>Новая</b>", published: true }));
  assert.equal(published.status, 200);
  const page = await app.client().call("GET", "/games/new-game");
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /<b>Новая<\/b>/);
  assert.match(page.text, /&lt;b&gt;Новая&lt;\/b&gt;/);
  assert.equal(await auditCount("game.create"), 1);
  assert.equal(await auditCount("game.update"), 1);
});

test("обложка и скриншоты игры: только картинки, отдаются по адресу, удаляются", async () => {
  const { id } = (await admin.call("POST", "/api/admin/games", game("shots-game"))).data.game;
  const fake = new Uint8Array(Buffer.from("<svg onload=alert(1)>"));
  assert.equal((await admin.call("PUT", `/api/admin/games/${id}/cover`, fake, image(fake))).status, 415);
  assert.equal((await user.call("PUT", `/api/admin/games/${id}/cover`, PNG, image(PNG))).status, 403);

  const cover = await admin.call("PUT", `/api/admin/games/${id}/cover`, PNG, image(PNG));
  assert.equal(cover.status, 200);
  assert.equal(cover.data.game.coverUrl, `/media/games/${id}/cover?v=1`);
  const served = await app.client().call("GET", `/media/games/${id}/cover?v=1`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");

  const shot = await admin.call("POST", `/api/admin/games/${id}/media?caption=${encodeURIComponent("Главное меню")}`, PNG, image(PNG));
  assert.equal(shot.status, 201);
  assert.equal(shot.data.media.length, 1);
  assert.equal(shot.data.media[0].caption, "Главное меню");
  const mediaId = shot.data.media[0].id;
  assert.equal((await app.client().call("GET", `/media/games/${id}/shots/${mediaId}`)).status, 200);

  assert.equal((await admin.call("DELETE", `/api/admin/games/${id}/media/${mediaId}`)).status, 200);
  assert.equal((await app.client().call("GET", `/media/games/${id}/shots/${mediaId}`)).status, 404);
  assert.equal((await admin.call("DELETE", `/api/admin/games/${id}/cover`)).status, 200);
  assert.equal((await app.client().call("GET", `/media/games/${id}/cover?v=1`)).status, 404);
});

test("игру с главной нельзя удалить; удаление игры оставляет категорию форума", async () => {
  const life = await app.db.prepare("SELECT id FROM games WHERE slug = 'endemion-life'").first();
  assert.equal((await admin.call("DELETE", `/api/admin/games/${life.id}`)).status, 409);

  const { id } = (await admin.call("POST", "/api/admin/games", game("doomed-game"))).data.game;
  assert.equal((await admin.call("DELETE", `/api/admin/games/${id}`)).status, 200);
  assert.equal(await app.db.prepare("SELECT id FROM games WHERE id = ?").bind(id).first(), null);
  const category = await app.db.prepare("SELECT game_id FROM forum_categories WHERE slug = 'doomed-game'").first();
  assert.equal(category.game_id, null);
  assert.equal(await auditCount("game.delete"), 1);
});

test("публикация: черновик не виден, дата ставится при первой публикации, архив", async () => {
  const empty = await admin.call("POST", "/api/admin/studio-posts", post("empty-post", { status: "published", body: "" }));
  assert.equal(empty.status, 400);

  const created = await admin.call("POST", "/api/admin/studio-posts", post("first-devlog"));
  assert.equal(created.status, 201);
  const { id } = created.data.post;
  assert.equal(created.data.post.publishedAt, null);
  assert.equal((await app.client().call("GET", "/studio/first-devlog")).status, 404);
  assert.doesNotMatch((await app.client().call("GET", "/studio")).text, /first-devlog/);

  // Картинка черновика не отдаётся
  assert.equal((await admin.call("PUT", `/api/admin/studio-posts/${id}/image`, PNG, image(PNG))).status, 200);
  assert.equal((await app.client().call("GET", `/media/posts/${id}?v=1`)).status, 404);

  const published = await admin.call("PUT", `/api/admin/studio-posts/${id}`, post("first-devlog", { status: "published" }));
  assert.equal(published.status, 200);
  const publishedAt = published.data.post.publishedAt;
  assert.ok(publishedAt);
  assert.equal((await app.client().call("GET", "/studio/first-devlog")).status, 200);
  assert.equal((await app.client().call("GET", `/media/posts/${id}?v=1`)).status, 200);

  await app.db.prepare("UPDATE studio_posts SET published_at = '2026-01-01 10:00:00' WHERE id = ?").bind(id).run();
  const archived = await admin.call("PUT", `/api/admin/studio-posts/${id}`, post("first-devlog", { status: "archived" }));
  assert.equal(archived.data.post.publishedAt, "2026-01-01 10:00:00");
  const again = await admin.call("PUT", `/api/admin/studio-posts/${id}`, post("first-devlog", { status: "published" }));
  assert.equal(again.data.post.publishedAt, "2026-01-01 10:00:00");

  assert.equal(await auditCount("post.published"), 2);
  assert.equal(await auditCount("post.archived"), 1);
  assert.equal((await admin.call("DELETE", `/api/admin/studio-posts/${id}`)).status, 200);
  assert.equal((await app.client().call("GET", "/studio/first-devlog")).status, 404);
});

test("категории форума: создание, нельзя удалить general и категорию с темами", async () => {
  const bad = await admin.call("POST", "/api/admin/forum-categories", { slug: "x", section: "general", title: "Коротко" });
  assert.equal(bad.status, 400);
  const created = await admin.call("POST", "/api/admin/forum-categories", { slug: "mods", section: "community", title: "Моды", description: "", position: 5, staffOnly: false });
  assert.equal(created.status, 201);
  const mods = created.data.categories.find((c) => c.slug === "mods");
  assert.ok(mods);
  assert.equal((await app.client().call("GET", "/community/c/mods")).status, 200);

  const general = created.data.categories.find((c) => c.slug === "general");
  assert.equal((await admin.call("DELETE", `/api/admin/forum-categories/${general.id}`)).status, 409);
  const renamed = await admin.call("PUT", `/api/admin/forum-categories/${general.id}`, { slug: "main", section: "general", title: "Общее", position: 1 });
  assert.equal(renamed.status, 409);

  assert.equal((await user.call("POST", "/api/threads", { kind: "discussion", subject: "Тема про моды", body: "Текст.", category: "mods" })).status, 201);
  assert.equal((await admin.call("DELETE", `/api/admin/forum-categories/${mods.id}`)).status, 409);
  assert.ok(await app.db.prepare("SELECT id FROM forum_categories WHERE slug = 'mods'").first());
});

test("настройки сайта: только https-ссылки, главная игра должна быть опубликована, ссылки попадают в /api/config", async () => {
  const base = { featuredGame: "endemion-life", aboutText: "", socialLinks: [] };
  const bad = await admin.call("PUT", "/api/admin/site-settings", { ...base, socialLinks: [{ label: "Discord", url: "javascript:alert(1)" }] });
  assert.equal(bad.status, 400);
  const plain = await admin.call("PUT", "/api/admin/site-settings", { ...base, socialLinks: [{ label: "Сайт", url: "http://example.com" }] });
  assert.equal(plain.status, 400);

  await app.db.prepare("UPDATE games SET published = 0 WHERE slug = 'liforae'").run();
  assert.equal((await admin.call("PUT", "/api/admin/site-settings", { ...base, featuredGame: "liforae" })).status, 400);
  assert.equal((await admin.call("PUT", "/api/admin/site-settings", { ...base, featuredGame: "no-such-game" })).status, 400);

  const saved = await admin.call("PUT", "/api/admin/site-settings", { ...base, socialLinks: [{ label: "Discord", url: "https://discord.gg/endemion" }] });
  assert.equal(saved.status, 200);
  const config = await app.client().call("GET", "/api/config");
  assert.deepEqual(config.data.socialLinks, [{ label: "Discord", url: "https://discord.gg/endemion" }]);
  assert.equal(await auditCount("settings.update"), 1);
});
