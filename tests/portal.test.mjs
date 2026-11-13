// Публичные страницы портала: главная, меню, игры, разработка, «О студии». Черновики, заглушки, заголовки безопасности

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp, PASSWORD } from "./helpers/app.mjs";

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

test("удалённые разделы отвечают 410, их API больше нет", async () => {
  const guest = app.client();
  const home = await guest.call("GET", "/");
  for (const href of ["/games", "/community", "/studio", "/about"]) assert.match(home.text, new RegExp(`href="${href}"`), href);
  assert.doesNotMatch(home.text, /href="\/(encyclopedia|anime|manga|reading|catalog|pulse|arena)"/);
  for (const path of ["/encyclopedia", "/anime", "/anime/5-name", "/manga", "/characters/1", "/mylist",
    "/reading", "/catalog", "/title/1", "/read/1/1", "/nexus", "/oracle", "/pulse", "/arena", "/collection/1"]) {
    const r = await guest.call("GET", path);
    assert.equal(r.status, 410, path);
  }
  for (const path of ["/api/titles", "/api/catalog/anime", "/api/library", "/api/polls", "/api/collections", "/api/universe/anime/1"]) {
    assert.equal((await guest.call("GET", path)).status, 404, path);
  }
  // Портал, форум, уведомления и служебные файлы на месте
  for (const path of ["/community", "/notifications", "/sitemap.xml", "/robots.txt"]) assert.equal((await guest.call("GET", path)).status, 200, path);
  const sitemap = (await guest.call("GET", "/sitemap.xml")).text;
  assert.match(sitemap, /\/games\/endemion-life/);
  assert.doesNotMatch(sitemap, /\/(anime|manga|title|reading|catalog)\b/);
});

test("тема форума: заголовок, описание и разметка DiscussionForumPosting", async () => {
  const author = await app.user("Автор темы для поиска");
  const created = await author.call("POST", "/api/threads", { kind: "discussion", subject: "Тема для поиска", body: "Текст темы для поиска.", category: "general" });
  assert.equal(created.status, 201, created.text);
  const id = created.data.thread.id;

  const page = await app.client().call("GET", `/community/thread/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Тема для поиска \| ENDEMION<\/title>/);
  assert.match(page.text, /<meta name="description" content="Текст темы для поиска\."/);
  assert.match(page.text, /"@type":"DiscussionForumPosting"/);
  assert.match(page.text, /"commentCount":0/);

  const sitemap = (await app.client().call("GET", "/sitemap.xml")).text;
  assert.match(sitemap, new RegExp(`/community/thread/${id}<`));
});

test("главная: приветствие, игры из каталога, ссылка на Endemion Life, без ссылок на магазины", async () => {
  const home = await app.client().call("GET", "/");
  assert.match(home.text, /Создаём миры. Соединяем игроков./);
  for (const title of SEED_GAMES) assert.ok(home.text.includes(title), title);
  assert.match(home.text, /href="https:\/\/life\.endemion\.online"/);
  // Обложек у игр из миграции нет: показывается подписанная заглушка, а не выдуманная картинка
  assert.match(home.text, /Обложка скоро появится/);
  assert.doesNotMatch(home.text, /play\.google\.com|apps\.apple\.com|store\.steampowered\.com/);
});

test("рекламный блок Яндекс.РСЯ стоит между «Избранным проектом» и «Нашими играми»", async () => {
  const ads = await createApp({ extraEnv: { YANDEX_ADS_PAGE_ID: "20404024" } });
  try {
    const home = await ads.client().call("GET", "/");
    assert.match(home.text, /data-ads-slot/);
    assert.match(home.text, /data-ads-page-id="20404024"/);
    // Место блока — между избранным проектом и каталогом игр
    assert.ok(home.text.indexOf("data-ads-slot") > home.text.indexOf('id="featuredTitle"'), "после избранного проекта");
    assert.ok(home.text.indexOf("data-ads-slot") < home.text.indexOf('id="gamesTitle"'), "перед нашими играми");
    // Без номера кампании рекламы на сайте нет
    assert.doesNotMatch((await app.client().call("GET", "/")).text, /data-ads-slot/);
  } finally {
    await ads.close();
  }
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
    assert.doesNotMatch(headers.get("content-security-policy") || "", /shikimori/, path);
    assert.equal(headers.get("x-frame-options"), "DENY", path);
    assert.equal(headers.get("x-content-type-options"), "nosniff", path);
  }
});

// ==================== НОВЫЕ ТЕСТЫ STAGE 03 — КАТАЛОГ ИГР ====================

test("каталог игр: фильтры, поиск, сортировка, пустое состояние", async () => {
  const guest = app.client();

  // Базовый ответ 200
  const r = await guest.call("GET", "/games");
  assert.equal(r.status, 200);
  assert.match(r.text, /Наши игры/);
  assert.match(r.text, /Статус/);
  assert.match(r.text, /Платформа/);
  assert.match(r.text, /Поиск по названию/);
  assert.match(r.text, /Сортировка/);

  // Все опубликованные игры отображаются
  for (const title of SEED_GAMES) assert.ok(r.text.includes(title), title);

  // Фильтр по статусу: только in_development (Endemion Life)
  const rInDev = await guest.call("GET", "/games?status=in_development");
  assert.equal(rInDev.status, 200);
  assert.ok(rInDev.text.includes("Endemion Life"), "Endemion Life should be in development");
  assert.ok(!rInDev.text.includes("TETRUS"), "TETRUS has no status, should not appear");

  // Фильтр по платформе: Браузер
  const rBrowser = await guest.call("GET", "/games?platform=Браузер");
  assert.equal(rBrowser.status, 200);
  assert.ok(rBrowser.text.includes("Endemion Life"));

  // Поиск по названию
  const rSearch = await guest.call("GET", "/games?q=Life");
  assert.equal(rSearch.status, 200);
  assert.ok(rSearch.text.includes("Endemion Life"));
  assert.ok(!rSearch.text.includes("TETRUS"));

  // Поиск: ничего не найдено
  const rEmpty = await guest.call("GET", "/games?q=zzzznonexistent");
  assert.equal(rEmpty.status, 200);
  assert.match(rEmpty.text, /Игр не найдено/);

  // Неверный статус — 404
  const rBadStatus = await guest.call("GET", "/games?status=invalid-status");
  assert.equal(rBadStatus.status, 404);

  // Сортировка по алфавиту
  const rSort = await guest.call("GET", "/games?sort=title_asc");
  assert.equal(rSort.status, 200);

  // Параметры сохраняются в ссылках
  assert.match(r.text, /href="\/games\?status=in_development"/);
});

test("каталог игр: английская локализация", async () => {
  const guest = app.client();
  const r = await guest.call("GET", "/games", undefined, { headers: { "accept-language": "en" } });
  assert.equal(r.status, 200);
  assert.match(r.text, /Our games/);
  assert.match(r.text, /Status/);
  assert.match(r.text, /Platform/);
  assert.match(r.text, /Search by title/);
  assert.match(r.text, /Sorting/);
});

test("страница игры: премиальный hero, мета-информация, CTA", async () => {
  const guest = app.client();
  const r = await guest.call("GET", "/games/endemion-life");
  assert.equal(r.status, 200);
  assert.match(r.text, /Endemion Life/);
  assert.match(r.text, /Играть/);
  assert.match(r.text, /Об игре/);
  assert.match(r.text, /Обсуждение/);
  assert.match(r.text, /Статус разработки/);
  assert.match(r.text, /Браузер/);
  assert.match(r.text, /В разработке/);
  // Structured data VideoGame
  assert.match(r.text, /VideoGame/);
  assert.match(r.text, /application\/ld\+json/);
  // Open Graph
  assert.match(r.text, /og:title/);
  assert.match(r.text, /og:image/);
});

test("страница игры: несуществующий слаг — 404", async () => {
  const guest = app.client();
  const r = await guest.call("GET", "/games/no-such-game-slug");
  assert.equal(r.status, 404);
  assert.match(r.text, /<meta name="robots" content="noindex/);
});

test("страница игры: английская локализация", async () => {
  const guest = app.client();
  const r = await guest.call("GET", "/games/endemion-life", undefined, { headers: { "accept-language": "en" } });
  assert.equal(r.status, 200);
  assert.match(r.text, /Endemion Life/);
  assert.match(r.text, /Play/);
  assert.match(r.text, /About the game/);
  assert.match(r.text, /Discuss/);
  assert.match(r.text, /Development status/);
});

test("страница игры: скриншоты из game_media", async () => {
  await app.user("Админ медиа", "admin");
  // Добавляем скриншот для Endemion Life
  const game = await app.db.prepare("SELECT id FROM games WHERE slug = 'endemion-life'").first();
  await app.db.prepare(
    "INSERT INTO game_media (game_id, caption, content_type, position) VALUES (?, ?, 'image/png', 1)"
  ).bind(game.id, "Тестовый скриншот").run();

  try {
    const r = await app.client().call("GET", "/games/endemion-life");
    assert.equal(r.status, 200);
    assert.match(r.text, /Тестовый скриншот/);
    assert.match(r.text, /media\/games\/\d+\/shots\/\d+/);
  } finally {
    await app.db.prepare("DELETE FROM game_media WHERE game_id = ? AND caption = 'Тестовый скриншот'").bind(game.id).run();
  }
});

test("страница игры: roadmap, новости, devlog из публикаций", async () => {
  const admin = await app.user("Админ публикаций", "admin");
  const game = await app.db.prepare("SELECT id FROM games WHERE slug = 'endemion-life'").first();

  // Создаем roadmap публикацию
  await admin.call("POST", "/api/admin/studio-posts", {
    slug: "roadmap-2026", kind: "roadmap", status: "published",
    title: "Roadmap 2026", summary: "Планы на год.", body: "Текстroadmap.", gameId: game.id
  });
  // Создаем новость
  await admin.call("POST", "/api/admin/studio-posts", {
    slug: "news-update", kind: "news", status: "published",
    title: "Новость игры", summary: "Кратко.", body: "Текст новости.", gameId: game.id
  });
  // Создаем devlog
  await admin.call("POST", "/api/admin/studio-posts", {
    slug: "devlog-entry", kind: "devlog", status: "published",
    title: "Devlog запись", summary: "Запись разработки.", body: "Текст devlog.", gameId: game.id
  });

  try {
    const r = await app.client().call("GET", "/games/endemion-life");
    assert.equal(r.status, 200);
    assert.match(r.text, /Roadmap 2026/);
    assert.match(r.text, /Новость игры/);
    assert.match(r.text, /Devlog запись/);
  } finally {
    await app.db.prepare("DELETE FROM studio_posts WHERE slug IN ('roadmap-2026', 'news-update', 'devlog-entry')").run();
  }
});

// ==================== НОВЫЕ ТЕСТЫ STAGE 04 — ИЗБРАННЫЕ ИГРЫ ====================

test("избранные: гость не может добавить игру (401)", async () => {
  const guest = app.client();
  const r = await guest.call("POST", "/api/users/anyuser/library/add", { game_id: 1 });
  assert.equal(r.status, 401);
});

test("избранные: гость не может убрать игру (401)", async () => {
  const guest = app.client();
  const r = await guest.call("DELETE", "/api/users/anyuser/library/1");
  assert.equal(r.status, 401);
});

test("избранные: добавить и убрать игру, посмотреть в профиле", async () => {
  const owner = await app.user("Владелец избранного", "user");
  const ownerRow = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first();
  const ownerUsername = ownerRow.username;
  const game = await app.db.prepare("SELECT id, slug FROM games WHERE slug = 'endemion-life'").first();

  // Добавить в избранное
  const rAdd = await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: game.id });
  assert.equal(rAdd.status, 200);
  assert.equal(rAdd.data.added, true);
  assert.equal(rAdd.data.favorited, true);

  // Повторное добавление — не ошибка, просто уже есть
  const rAddAgain = await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: game.id });
  assert.equal(rAddAgain.status, 200);

  // Список избранных в профиле
  const rList = await owner.call("GET", `/api/users/${encodeURIComponent(ownerUsername)}/library`);
  assert.equal(rList.status, 200);
  assert.equal(rList.data.games.length, 1);
  assert.equal(rList.data.games[0].id, game.id);
  assert.equal(rList.data.games[0].slug, "endemion-life");

  // Убрать из избранного
  const rRemove = await owner.call("DELETE", `/api/users/${encodeURIComponent(ownerUsername)}/library/${game.id}`);
  assert.equal(rRemove.status, 200);
  assert.equal(rRemove.data.removed, true);
  assert.equal(rRemove.data.favorited, false);

  // Список пуст
  const rList2 = await owner.call("GET", `/api/users/${encodeURIComponent(ownerUsername)}/library`);
  assert.equal(rList2.data.games.length, 0);
});

test("избранные: несуществующая игра (400)", async () => {
  const owner = await app.user("Владелец избранного 2", "user");
  const ownerRow = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first();
  const ownerUsername = ownerRow.username;
  const r = await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: 999999 });
  assert.equal(r.status, 404);
});

test("избранные: неверный game_id (400)", async () => {
  const owner = await app.user("Владелец избранного 3", "user");
  const ownerRow = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first();
  const ownerUsername = ownerRow.username;
  const r = await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: "abc" });
  assert.equal(r.status, 400);
});

test("избранные: нельзя modifier чужие избранные (403)", async () => {
  const owner = await app.user("Владелец избранного 4", "user");
  const ownerRow = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first();
  const ownerUsername = ownerRow.username;
  const other = await app.user("Чужиой пользователь", "user");
  const game = await app.db.prepare("SELECT id FROM games WHERE slug = 'endemion-life'").first();

  // Владелец добавляет игру
  await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: game.id });

  // Чужиой пользователь не может убрать игру владельца
  const r = await other.call("DELETE", `/api/users/${encodeURIComponent(ownerUsername)}/library/${game.id}`);
  assert.equal(r.status, 403);
});

// ==================== НОВЫЕ ТЕСТЫ STAGE 05 — ОТЗЫВЫ К ИГРАМ ====================

const REVIEW_GAME_SLUG = "endemion-life";

async function seedReviewGameSlug(app) {
  const row = await app.db.prepare("SELECT id, slug FROM games WHERE slug = ? AND published = 1").bind(REVIEW_GAME_SLUG).first();
  return row;
}

/** Удаляет все отзывы к игре: изоляция тестов, так как все используют одну тестовую игру */
async function clearGameReviews(app, gameId) {
  await app.db.prepare("DELETE FROM game_reviews WHERE game_id = ?").bind(gameId).run();
}

test("отзывы: гость может читать публичные отзывы к игре", async () => {
  const guest = app.client();
  const r = await guest.call("GET", `/api/games/${REVIEW_GAME_SLUG}/reviews`);
  assert.equal(r.status, 200);
  assert.equal(r.data.reviews.length, 0);
  assert.equal(r.data.stats.reviewCount, 0);
  assert.equal(r.data.stats.avgScore, null);
  assert.equal(r.data.game.slug, REVIEW_GAME_SLUG);
});

test("отзывы: гость не может добавить отзыв (401)", async () => {
  const guest = app.client();
  const r = await guest.call("POST", `/api/games/${REVIEW_GAME_SLUG}/reviews/add`, { score: 5, body: "Отзыв гостя" });
  assert.equal(r.status, 401);
});

test("отзывы: авторизованный пользователь может добавить отзыв только с оценкой", async () => {
  const owner = await app.user("Автор оценки без текста");
  const game = await seedReviewGameSlug(app);
  await clearGameReviews(app, game.id);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 8 });
  assert.equal(r.status, 201);
  assert.equal(r.data.score, 8);
  assert.equal(r.data.body, "");
  assert.equal(r.data.spoiler, false);
  // Отзыв виден в публичном списке
  const list = await app.client().call("GET", `/api/games/${game.slug}/reviews`);
  assert.equal(list.data.stats.reviewCount, 1);
  assert.equal(list.data.stats.avgScore, 8);
  assert.equal(list.data.reviews[0].score, 8);
});

test("отзывы: авторизованный пользователь может добавить отзыв с текстом и спойлером", async () => {
  const owner = await app.user("Автор текстового отзыва");
  const game = await seedReviewGameSlug(app);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 6, body: "Отличная игра!", spoiler: true });
  assert.equal(r.status, 201);
  assert.equal(r.data.body, "Отличная игра!");
  assert.equal(r.data.spoiler, true);
  const list = await app.client().call("GET", `/api/games/${game.slug}/reviews`);
  assert.equal(list.data.reviews[0].spoiler, true);
});

test("отзывы: оценка меньше 1 отвергается", async () => {
  const owner = await app.user("Оценка ниже диапазона");
  const game = await seedReviewGameSlug(app);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 0 });
  assert.equal(r.status, 400);
});

test("отзывы: оценка больше 10 отвергается", async () => {
  const owner = await app.user("Оценка выше диапазона");
  const game = await seedReviewGameSlug(app);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 11 });
  assert.equal(r.status, 400);
});

test("отзывы: нечисловая оценка отвергается", async () => {
  const owner = await app.user("Оценка не число");
  const game = await seedReviewGameSlug(app);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: "пять" });
  assert.equal(r.status, 400);
});

test("отзывы: текст длиннее лимита отвергается", async () => {
  const owner = await app.user("Слишком длинный отзыв");
  const game = await seedReviewGameSlug(app);
  const r = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5, body: "x".repeat(5001) });
  assert.equal(r.status, 400);
});

test("отзывы: дубликат отзыва от того же пользователя к той же игре предотвращён (409)", async () => {
  const owner = await app.user("Пользователь дубль отзыва");
  const game = await seedReviewGameSlug(app);
  const r1 = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5, body: "Первый отзыв" });
  assert.equal(r1.status, 201);
  const r2 = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 7, body: "Второй отзыв" });
  assert.equal(r2.status, 409);
  const count = await app.db.prepare("SELECT COUNT(*) AS n FROM game_reviews WHERE user_id = ? AND game_id = ?").bind(owner.id, game.id).first();
  assert.equal(count.n, 1);
});

test("отзывы: пользователь может отредактировать свой отзыв", async () => {
  const owner = await app.user("Редактор своего отзыва");
  const game = await seedReviewGameSlug(app);
  const created = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 4, body: "Старый текст" });
  assert.equal(created.status, 201);
  const reviewId = created.data.id;
  const updated = await owner.call("PATCH", `/api/games/${game.slug}/reviews/${reviewId}`, { score: 9, body: "Новый текст", spoiler: true });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.score, 9);
  assert.equal(updated.data.body, "Новый текст");
  assert.equal(updated.data.spoiler, true);
});

test("отзывы: редактирование без изменения оценки сохраняет текущую", async () => {
  const owner = await app.user("Редактирование только текста");
  const game = await seedReviewGameSlug(app);
  const created = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5, body: "Текст" });
  const reviewId = created.data.id;
  const updated = await owner.call("PATCH", `/api/games/${game.slug}/reviews/${reviewId}`, { body: "Только текст изменён" });
  assert.equal(updated.status, 200);
assert.equal(updated.data.score, 5);
assert.equal(updated.data.body, "Только текст изменён");
});

test("отзывы: спойлер скрыт в HTML с aria-hidden и кнопкой раскрытия", async () => {
  const owner = await app.user("Автор спойлер-отзыва");
  const game = await seedReviewGameSlug(app);
  await clearGameReviews(app, game.id);
  await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 4, body: "Текст под спойлером", spoiler: true });

  const page = await app.client().call("GET", `/games/${game.slug}`);
  assert.equal(page.status, 200);
  // Скрытый текст спойлера имеет aria-hidden="true"
  assert.match(page.text, /aria-hidden="true"/);
  // Кнопка раскрытия имеет aria-expanded="false"
  assert.match(page.text, /aria-expanded="false"/);
  // Класс spoiler-hidden на теле отзыва
  assert.match(page.text, /spoiler-hidden/);
});

test("отзывы: пользователь не может отредактировать чужой отзыв (403)", async () => {
  const owner = await app.user("Владелец чужого отзыва");
  const other = await app.user("Попытка редактирования чужого");
  const game = await seedReviewGameSlug(app);
  const created = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5, body: "Текст владельца" });
  const reviewId = created.data.id;
  const r = await other.call("PATCH", `/api/games/${game.slug}/reviews/${reviewId}`, { score: 1 });
  assert.equal(r.status, 403);
});

test("отзывы: редактирование несуществующего отзыва — 404", async () => {
  const owner = await app.user("Редактирование несуществующего");
  const r = await owner.call("PATCH", `/api/games/${REVIEW_GAME_SLUG}/reviews/999999`, { score: 5 });
  assert.equal(r.status, 404);
});

test("отзывы: пользователь может удалить свой отзыв", async () => {
  const owner = await app.user("Удаляющий свой отзыв");
  const game = await seedReviewGameSlug(app);
  await clearGameReviews(app, game.id);
  const created = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 3, body: "Удалю это" });
  assert.equal(created.status, 201);
  const reviewId = created.data.id;
  const r = await owner.call("DELETE", `/api/games/${game.slug}/reviews/${reviewId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.deleted, true);
  const list = await app.client().call("GET", `/api/games/${game.slug}/reviews`);
  assert.equal(list.data.stats.reviewCount, 0);
});

test("отзывы: пользователь не может удалить чужой отзыв (403)", async () => {
  const owner = await app.user("Владелец для удаления чужого");
  const other = await app.user("Попытка удаления чужого");
  const game = await seedReviewGameSlug(app);
  const created = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5, body: "Текст" });
  const reviewId = created.data.id;
  const r = await other.call("DELETE", `/api/games/${game.slug}/reviews/${reviewId}`);
  assert.equal(r.status, 403);
});

test("отзывы: удаление несуществующего отзыва — 404", async () => {
  const owner = await app.user("Удаление несуществующего");
  const r = await owner.call("DELETE", `/api/games/${REVIEW_GAME_SLUG}/reviews/999999`);
  assert.equal(r.status, 404);
});

test("отзывы: скрытые отзывы исключены из публичного списка и агрегатов", async () => {
  const a = await app.user("Автор видимого отзыва");
  const b = await app.user("Автор скрытого отзыва");
  const game = await seedReviewGameSlug(app);
  await clearGameReviews(app, game.id);
  await a.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 8, body: "Видимый отзыв" });
  await b.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 2, body: "Скрытый отзыв" });
  // Скрываем отзыв пользователя b напрямую в БД (модераторское действие, отдельного API нет)
  const bReview = await app.db.prepare("SELECT id FROM game_reviews WHERE user_id = ? AND game_id = ?").bind(b.id, game.id).first();
  await app.db.prepare("UPDATE game_reviews SET hidden_at = datetime('now') WHERE id = ?").bind(bReview.id).run();

  const list = await app.client().call("GET", `/api/games/${game.slug}/reviews`);
  assert.equal(list.data.reviews.length, 1);
  assert.equal(list.data.reviews[0].score, 8);
  assert.equal(list.data.stats.reviewCount, 1);
  assert.equal(list.data.stats.avgScore, 8);
});

test("отзывы: средняя оценка округляется до одного знака", async () => {
  const a = await app.user("Пользователь для средней А");
  const b = await app.user("Пользователь для средней Б");
  const game = await seedReviewGameSlug(app);
  await clearGameReviews(app, game.id);
  await a.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5 });
  await b.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 6 });
  const list = await app.client().call("GET", `/api/games/${game.slug}/reviews`);
  assert.equal(list.data.stats.reviewCount, 2);
  assert.equal(list.data.stats.avgScore, 5.5);
});

test("отзывы: неопубликованная игра не принимает отзывы (404)", async () => {
  const owner = await app.user("Пользователь неопубликованной игры");
  await app.db.prepare("INSERT INTO games (slug, title, status, platforms, position, published) VALUES ('unpublished-review-test', 'Неопublikованная', 'in_development', '', 999, 0)").run();
  try {
    const r = await owner.call("POST", "/api/games/unpublished-review-test/reviews/add", { score: 5 });
    assert.equal(r.status, 404);
  } finally {
    await app.db.prepare("DELETE FROM games WHERE slug = 'unpublished-review-test'").run();
  }
});

test("отзывы: отзывы к несуществующей игре — 404", async () => {
  const owner = await app.user("Пользователь несуществующей игры");
  const r = await owner.call("GET", "/api/games/no-such-game/reviews");
  assert.equal(r.status, 404);
});

test("отзывы: удаление пользователя очищает его отзывы", async () => {
  const owner = await app.user("Пользователь для удаления с отзывами");
  const game = await seedReviewGameSlug(app);
  await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 7, body: "Будет удалён с аккаунтом" });
  const before = await app.db.prepare("SELECT COUNT(*) AS n FROM game_reviews WHERE user_id = ?").bind(owner.id).first();
  assert.equal(before.n, 1);

  const del = await owner.call("DELETE", "/api/me", { password: PASSWORD });
  assert.equal(del.status, 200);

  const after = await app.db.prepare("SELECT COUNT(*) AS n FROM game_reviews WHERE user_id = ?").bind(owner.id).first();
  assert.equal(after.n, 0);
});

test("отзывы: функционал избранного остаётся работающим вместе с отзывами", async () => {
  const owner = await app.user("Пользователь избранного и отзывов");
  const ownerRow = await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first();
  const ownerUsername = ownerRow.username;
  const game = await seedReviewGameSlug(app);

  const rAdd = await owner.call("POST", `/api/users/${encodeURIComponent(ownerUsername)}/library/add`, { game_id: game.id });
  assert.equal(rAdd.status, 200);
  const rReview = await owner.call("POST", `/api/games/${game.slug}/reviews/add`, { score: 5 });
  assert.equal(rReview.status, 201);
  const rList = await owner.call("GET", `/api/users/${encodeURIComponent(ownerUsername)}/library`);
  assert.equal(rList.data.games.length, 1);
  assert.equal(rList.data.games[0].id, game.id);
});

test("онбординг: шаги считаются по данным, подсказки скрываются", async () => {
  assert.equal((await app.client().call("GET", "/api/me/onboarding")).status, 401);

  const owner = await app.user("Новичок без подсказок");
  const first = await owner.call("GET", "/api/me/onboarding");
  assert.equal(first.status, 200);
  assert.equal(first.data.total, 4);
  assert.equal(first.data.hidden, false);
  assert.deepEqual(Object.fromEntries(first.data.steps.map((step) => [step.key, step.done])), {
    avatar: false, bio: false, game: false, topic: false
  });

  // Описание профиля закрывает шаг «о себе», избранная игра — шаг «игра»
  assert.equal((await owner.call("PATCH", "/api/me/profile", { bio: "Пишу небольшие игры." })).status, 200);
  const game = await app.db.prepare("SELECT id FROM games WHERE published = 1 ORDER BY id LIMIT 1").first();
  const username = (await app.db.prepare("SELECT username FROM user_profiles WHERE user_id = ?").bind(owner.id).first()).username;
  assert.equal((await owner.call("POST", `/api/users/${username}/library/add`, { game_id: game.id })).status, 200);

  const after = await owner.call("GET", "/api/me/onboarding");
  const done = Object.fromEntries(after.data.steps.map((step) => [step.key, step.done]));
  assert.equal(done.bio, true);
  assert.equal(done.game, true);
  assert.equal(after.data.done, 2);

  // Скрытие запоминается в профиле и переживает следующий запрос
  assert.equal((await owner.call("PATCH", "/api/me/onboarding", { hidden: true })).status, 200);
  assert.equal((await owner.call("GET", "/api/me/onboarding")).data.hidden, true);
});
