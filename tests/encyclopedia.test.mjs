// Энциклопедия: каталог, страницы произведений, списки, избранное, отзывы, комментарии, админка и поведение при сбое источника.
// Источник каталога подменён (CATALOG_FETCH): тесты не ходят в сеть и не зависят от данных Shikimori

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { bbcodeToHtml, bbcodeToText } from "../functions/_lib/catalog/bbcode.js";
import { RateGate } from "../functions/_lib/catalog/index.js";
import { parseSlugId, shiftSeason, slugify } from "../functions/_lib/catalog/model.js";
import { createApp } from "./helpers/app.mjs";

// ==================== ПОДДЕЛЬНЫЙ SHIKIMORI ====================

const poster = (id) => ({
  previewUrl: `https://shikimori.io/uploads/poster/animes/${id}/preview.webp`,
  preview2xUrl: `https://shikimori.io/uploads/poster/animes/${id}/preview2x.webp`,
  mainUrl: `https://shikimori.io/uploads/poster/animes/${id}/main.webp`,
  main2xUrl: `https://shikimori.io/uploads/poster/animes/${id}/main2x.webp`
});

const ANIME = {
  16498: {
    id: "16498", name: "Shingeki no Kyojin", russian: "Атака титанов", english: "Attack on Titan", japanese: "進撃の巨人", synonyms: [],
    kind: "tv", status: "released", score: 8.58, episodes: 25, episodesAired: 25, duration: 24, rating: "r", season: "spring_2013",
    airedOn: { year: 2013, month: 4, day: 7, date: "2013-04-07" }, releasedOn: { year: 2013, month: 9, day: 29, date: "2013-09-29" },
    poster: poster(16498), url: "/animes/16498-shingeki-no-kyojin", nextEpisodeAt: null,
    description: "Люди живут за [character=40882]стенами[/character]. [spoiler]Тайна[/spoiler] <script>alert(1)</script>",
    genres: [{ id: "1", russian: "Экшен", kind: "genre" }, { id: "27", russian: "Сёнен", kind: "demographic" }],
    studios: [{ id: "858", name: "Wit Studio", imageUrl: "/system/studios/original/858.png" }],
    externalLinks: [{ kind: "official_site", url: "https://shingeki.tv/" }, { kind: "unknown", url: "https://x.example" }],
    personRoles: [
      { rolesRu: ["Режиссёр"], person: { id: "1117", name: "Tetsuro Araki", russian: "Тэцуро Араки", poster: poster(1117) } },
      { rolesRu: ["Продюсер"], person: { id: "9", name: "Producer", russian: "Продюсер", poster: null } }
    ],
    characterRoles: [{ rolesEn: ["Main"], character: { id: "40882", name: "Eren Yeager", russian: "Эрен Йегер", poster: poster(40882) } }],
    related: [{ relationKind: "sequel", relationText: "Продолжение", anime: { id: "25777", name: "Shingeki no Kyojin Season 2", russian: "Атака титанов 2", kind: "tv", status: "released", airedOn: { year: 2017 }, poster: poster(25777) }, manga: null }]
  },
  // Произведение со скрытым по умолчанию жанром (12 — хентай): его не видно на сайте
  777: {
    id: "777", name: "Hidden", russian: "Скрытое", kind: "ova", status: "released", score: 6, episodes: 2, episodesAired: 2, duration: 30,
    rating: "rx", airedOn: { year: 2010 }, poster: poster(777), url: "/animes/777", genres: [{ id: "12", russian: "Хентай", kind: "genre" }],
    studios: [], externalLinks: [], personRoles: [], characterRoles: [], related: [], description: ""
  },
  // Выходящее: 5 эпизодов из 12
  60000: {
    id: "60000", name: "Ongoing Show", russian: "Онгоинг", kind: "tv", status: "ongoing", score: 7.9, episodes: 12, episodesAired: 5, duration: 24,
    rating: "pg_13", airedOn: { year: 2026 }, poster: poster(60000), url: "/animes/60000-ongoing-show", genres: [{ id: "1", russian: "Экшен", kind: "genre" }],
    studios: [], externalLinks: [], personRoles: [], characterRoles: [], related: [], description: "Идёт сейчас."
  }
};

const MANGA = {
  23390: {
    id: "23390", name: "Shingeki no Kyojin", russian: "Атака титанов", kind: "manga", status: "released", score: 8.56, chapters: 141, volumes: 34,
    airedOn: { year: 2009 }, poster: poster(23390), url: "/mangas/23390", genres: [{ id: "1", russian: "Экшен", kind: "genre" }],
    publishers: [{ id: "450", name: "Bessatsu Shounen Magazine" }], externalLinks: [], description: "Манга.",
    personRoles: [{ rolesRu: ["Сюжет и иллюстрации"], person: { id: "11705", name: "Hajime Isayama", russian: "Хадзимэ Исаяма", poster: poster(11705) } }],
    characterRoles: [], related: []
  }
};

const card = (node) => ({ ...node });

function createSource() {
  const state = { down: false, calls: [], lastVariables: null };
  async function fetchImpl(url, init = {}) {
    state.calls.push(url);
    if (state.down) throw new Error("сеть недоступна");
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const path = new URL(url).pathname;
    if (path === "/api/graphql") {
      const { query, variables = {} } = JSON.parse(String(init.body));
      state.lastVariables = variables;
      if (query.includes("genres(entryType")) {
        return reply({ data: { genres: [{ id: "1", russian: "Экшен", kind: "genre" }, { id: "12", russian: "Хентай", kind: "genre" }, { id: "27", russian: "Сёнен", kind: "demographic" }] } });
      }
      if (query.includes("hero:")) {
        const visible = [ANIME[16498], ANIME[60000]];
        return reply({ data: {
          hero: [ANIME[60000]], popularAnime: visible, popularManga: [MANGA[23390]], ongoing: [ANIME[60000]], anons: [],
          characterSource: [{ name: ANIME[16498].name, russian: ANIME[16498].russian, characterRoles: ANIME[16498].characterRoles }]
        } });
      }
      if (query.includes("characters(search: $q, limit: $limit)")) {
        return reply({ data: { anime: [ANIME[16498]], manga: [MANGA[23390]], characters: [ANIME[16498].characterRoles[0].character], people: [] } });
      }
      if (query.includes("animes(limit: 1)")) return reply({ data: { animes: [{ id: "1" }] } });
      if (query.includes("works:")) {
        return reply({ data: { works: [{ name: ANIME[16498].name, russian: ANIME[16498].russian, characterRoles: ANIME[16498].characterRoles }] } });
      }
      const source = query.includes("items: mangas") ? MANGA : query.includes("items: animes") ? ANIME : null;
      if (source && variables.ids) return reply({ data: { items: variables.ids.split(",").map((id) => source[id]).filter(Boolean) } });
      if (source) {
        // Источник сам отфильтровывает исключённые жанры («!12»)
        const excluded = String(variables.genre || "").split(",").filter((part) => part.startsWith("!")).map((part) => part.slice(1));
        const items = Object.values(source).filter((node) => !node.genres.some((genre) => excluded.includes(genre.id))).map(card);
        return reply({ data: { items: items.slice(0, variables.limit || 24) } });
      }
      return reply({ errors: [{ message: "неизвестный запрос в тесте" }] });
    }
    if (path === "/api/characters/40882") {
      return reply({
        id: 40882, name: "Eren Yeager", russian: "Эрен Йегер", altname: "Eren Jaeger", japanese: "エレン", description: "Главный герой.",
        image: { preview: "/system/characters/preview/40882.jpg", original: "/system/characters/original/40882.jpg" }, url: "/characters/40882",
        seyu: [{ id: 672, name: "Yuuki Kaji", russian: "Юки Кадзи", image: { preview: "/system/people/preview/672.jpg" } }],
        animes: [{ id: 16498, name: "Shingeki no Kyojin", russian: "Атака титанов", kind: "tv", score: "8.58", status: "released", aired_on: "2013-04-07", image: { preview: "/x.jpg" }, role: "Main" }],
        mangas: []
      });
    }
    if (path === "/api/people/1117") {
      return reply({
        id: 1117, name: "Tetsuro Araki", russian: "Тэцуро Араки", japanese: "荒木哲郎", job_title: "Режиссёр аниме",
        birth_on: { day: 5, month: 11, year: 1976 }, deceased_on: {}, website: "javascript:alert(1)", image: { preview: "/p.jpg" }, url: "/people/1117",
        groupped_roles: [["Режиссёр", 10]], roles: [],
        works: [{ anime: { id: 16498, name: "Shingeki no Kyojin", russian: "Атака титанов", kind: "tv", aired_on: "2013-04-07", image: { preview: "/x.jpg" } }, manga: null, role: "Режиссёр" }]
      });
    }
    if (path === "/api/studios") return reply([{ id: 858, name: "Wit Studio", real: true, image: "/system/studios/original/858.png" }]);
    return reply({}, 404);
  }
  return { state, fetchImpl };
}

let app;
let source;
before(async () => {
  source = createSource();
  app = await createApp({ extraEnv: { CATALOG_FETCH: source.fetchImpl, CATALOG_RETRY_BASE_MS: "1" } });
});
after(async () => {
  await app.close();
});

// ==================== ЮНИТ-ТЕСТЫ ====================

describe("модель и разметка", () => {
  test("адреса: slug, номер из адреса, соседние сезоны", () => {
    assert.equal(slugify("Shingeki no Kyojin: The Final Season"), "shingeki-no-kyojin-the-final-season");
    assert.equal(parseSlugId("16498-shingeki-no-kyojin"), 16498);
    assert.equal(parseSlugId("16498"), 16498);
    assert.equal(parseSlugId("abc"), null);
    assert.equal(parseSlugId("0"), null);
    assert.deepEqual(shiftSeason({ season: "winter", year: 2026 }, -1), { season: "fall", year: 2025 });
    assert.deepEqual(shiftSeason({ season: "fall", year: 2026 }, 1), { season: "winter", year: 2027 });
  });

  test("BBCode: текст экранируется, ссылки только на свои страницы, спойлеры раскрываются", () => {
    const out = bbcodeToHtml('<img onerror=x> [character=40882 "evil"]Эрен[/character] [url=javascript:alert(1)]ссылка[/url] [spoiler=Финал]тайна[/spoiler]');
    assert.ok(!out.includes("<img"));
    assert.ok(out.includes("&lt;img onerror=x&gt;"));
    assert.ok(out.includes('<a href="/characters/40882">Эрен</a>'));
    assert.ok(!out.includes("javascript"));
    assert.ok(out.includes('<details class="bb-spoiler"><summary>Финал</summary>тайна</details>'));
    assert.equal(bbcodeToText("Начало [spoiler]секрет[/spoiler] [b]конец[/b]"), "Начало конец");
  });

  test("очередь запросов держит лимит в секунду и отказывает, если ждать слишком долго", async () => {
    const gate = new RateGate({ perSecond: 2, perMinute: 100, maxWaitMs: 2000 });
    const started = Date.now();
    await Promise.all([gate.take(), gate.take(), gate.take()]);
    assert.ok(Date.now() - started >= 900, "третий запрос ждёт следующей секунды");
    const tight = new RateGate({ perSecond: 1, perMinute: 100, maxWaitMs: 100 });
    await tight.take();
    await assert.rejects(tight.take(), /очередь/i);
  });
});

// ==================== КАТАЛОГ И СТРАНИЦЫ ====================

describe("каталог и страницы", () => {
  test("список с фильтрами: скрытые жанры исключаются в запросе к источнику", async () => {
    const guest = app.client();
    const r = await guest.call("GET", "/api/catalog/anime?types=tv,special&status=released&genres=1&score=7&order=ranked&season=2013");
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((entry) => entry.id === 16498));
    assert.ok(!r.data.items.some((entry) => entry.id === 777), "скрытое произведение не попало в выдачу");
    assert.match(source.state.lastVariables.genre, /^1,.*!12/);
    assert.equal(source.state.lastVariables.kind, "tv,special,tv_special");
    assert.equal(source.state.lastVariables.season, "2013");
    for (const bad of ["types=xxx", "status=paused", "season=1800", "genres=a,b", "order=hack", "page=999", "score=11", "rating=rx"]) {
      assert.equal((await guest.call("GET", `/api/catalog/anime?${bad}`)).status, 400, bad);
    }
    assert.equal((await guest.call("GET", "/api/catalog/books")).status, 404);
  });

  test("ответ кешируется: повторный запрос не идёт в источник", async () => {
    const guest = app.client();
    await guest.call("GET", "/api/catalog/manga?order=popularity");
    const calls = source.state.calls.length;
    const r = await guest.call("GET", "/api/catalog/manga?order=popularity");
    assert.equal(r.status, 200);
    assert.equal(source.state.calls.length, calls);
  });

  test("страница произведения: канонический адрес, SEO, экранирование, связи", async () => {
    const guest = app.client();
    const short = await guest.call("GET", "/anime/16498");
    assert.equal(short.status, 301);
    assert.equal(short.headers.get("location"), "/anime/16498-shingeki-no-kyojin");
    const r = await guest.call("GET", "/anime/16498-shingeki-no-kyojin");
    assert.equal(r.status, 200);
    assert.match(r.text, /<title>Атака титанов \(2013\) — TV \| ENDEMION<\/title>/);
    assert.match(r.text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:9999\/anime\/16498-shingeki-no-kyojin">/);
    assert.match(r.text, /<meta property="og:type" content="video.tv_show">/);
    assert.match(r.text, /"@type":"TVSeries"/);
    assert.match(r.text, /"@type":"BreadcrumbList"/);
    assert.ok(!r.text.includes("<script>alert(1)</script>"), "описание экранировано");
    assert.match(r.text, /<a href="\/characters\/40882">стенами<\/a>/);
    assert.match(r.text, /href="\/studios\/858-wit-studio"/);
    assert.match(r.text, /Тэцуро Араки/);
    assert.ok(!r.text.includes(">Продюсер<"), "продюсеры не попадают в создателей");
    assert.match(r.text, /Продолжение/);
    assert.ok(!r.text.includes("x.example"), "неизвестные внешние ссылки не показываются");
    assert.match(r.headers.get("content-security-policy"), /img-src 'self' data: https:\/\/shikimori\.io/);
  });

  test("скрытое настройками и несуществующее — 404; манга со своими полями", async () => {
    const guest = app.client();
    assert.equal((await guest.call("GET", "/anime/777")).status, 404);
    assert.equal((await guest.call("GET", "/anime/123456")).status, 404);
    assert.equal((await guest.call("GET", "/anime/not-a-number")).status, 404);
    const manga = await guest.call("GET", "/manga/23390-shingeki-no-kyojin");
    assert.equal(manga.status, 200);
    assert.match(manga.text, /"@type":"Book"/);
    assert.match(manga.text, /Хадзимэ Исаяма/);
    assert.match(manga.text, /Bessatsu Shounen Magazine/);
  });

  test("главная, каталог, сезоны, рейтинги, студии, персонаж и человек открываются", async () => {
    const guest = app.client();
    for (const [url, text] of [
      ["/encyclopedia", "Популярное аниме"], ["/anime?type=tv&genre=1&year=2013&season=spring", "Атака титанов"], ["/manga", "Атака титанов"],
      ["/seasons/spring_2013", "Весна 2013"], ["/seasons", "Аниме:"], ["/rankings", "Лучшее аниме"], ["/rankings?source=endemion", "ENDEMION"],
      ["/studios", "Wit Studio"], ["/studios/858-wit-studio", "Атака титанов"], ["/characters", "Эрен Йегер"],
      ["/characters/40882-eren-yeager", "Юки Кадзи"], ["/people/1117-tetsuro-araki", "5 ноября 1976"], ["/search?q=титан", "Атака титанов"], ["/mylist", "Мой список"]
    ]) {
      const r = await guest.call("GET", url);
      assert.equal(r.status, 200, url);
      assert.ok(r.text.includes(text), `${url}: нет «${text}»`);
    }
    const person = await guest.call("GET", "/people/1117-tetsuro-araki");
    assert.ok(!person.text.includes("javascript:"), "сайт человека только http(s)");
    const filtered = await guest.call("GET", "/anime?genre=1");
    assert.match(filtered.text, /<meta name="robots" content="noindex">/);
    assert.equal((await guest.call("GET", "/seasons/summer_1800")).status, 404);
  });

  test("поиск: минимум 2 символа, находит произведения, персонажей и студии", async () => {
    const guest = app.client();
    assert.equal((await guest.call("GET", "/api/search?q=a")).status, 400);
    const r = await guest.call("GET", "/api/search?q=wit");
    assert.equal(r.status, 200);
    assert.equal(r.data.anime[0].id, 16498);
    assert.equal(r.data.characters[0].name, "Эрен Йегер");
    assert.equal(r.data.studios[0].name, "Wit Studio");
  });
});

// ==================== СПИСКИ ====================

describe("списки, оценки и избранное", () => {
  test("гостю списки недоступны", async () => {
    const guest = app.client();
    for (const url of ["/api/mylist", "/api/mylist/anime/16498", "/api/favorites", "/api/recommendations"]) {
      assert.equal((await guest.call("GET", url)).status, 401, url);
    }
    assert.equal((await guest.call("PUT", "/api/mylist/anime/16498", { status: "planned" })).status, 401);
  });

  test("статус, оценка, прогресс и статистика сохраняются", async () => {
    const viewer = await app.user("Зритель");
    let r = await viewer.call("PUT", "/api/mylist/anime/16498", { status: "current", progress: 3 });
    assert.equal(r.status, 200);
    assert.equal(r.data.item.status, "current");
    assert.equal(r.data.item.progress, 3);
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/16498", { progress: 26 })).status, 400, "больше, чем эпизодов");
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/16498", { score: 11 })).status, 400);
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/16498", { status: "watching" })).status, 400);
    // Последний эпизод — «Просмотрено»
    r = await viewer.call("PUT", "/api/mylist/anime/16498", { progress: 25, score: 9 });
    assert.equal(r.data.item.status, "completed");
    r = await viewer.call("PUT", "/api/mylist/manga/23390", { status: "completed" });
    assert.equal(r.data.item.progress, 141, "прочитано — значит все главы");
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/777", { status: "planned" })).status, 404, "скрытое не добавить");
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/123456", { status: "planned" })).status, 404);

    r = await viewer.call("GET", "/api/mylist?kind=anime");
    assert.equal(r.data.total, 1);
    assert.equal(r.data.stats.statuses.completed, 1);
    assert.equal(r.data.stats.units, 25);
    assert.equal(r.data.stats.hours, 10);
    assert.equal(r.data.stats.meanScore, 9);
    assert.equal(r.data.items[0].entry.title, "Атака титанов");
    assert.equal((await viewer.call("GET", "/api/mylist?kind=anime&status=planned")).data.total, 0);
    assert.equal((await viewer.call("GET", "/api/mylist?kind=anime&q=титан")).data.total, 1);

    assert.equal((await viewer.call("DELETE", "/api/mylist/anime/16498")).status, 200);
    assert.equal((await viewer.call("GET", "/api/mylist?kind=anime")).data.total, 0);
  });

  test("прогресс не больше общего числа эпизодов", async () => {
    const viewer = await app.user("Онгоинг");
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/60000", { status: "current", progress: 12 })).status, 200);
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/60000", { progress: 13 })).status, 400);
  });

  test("избранное: произведения и персонажи, имя берётся из источника", async () => {
    const viewer = await app.user("Фанат");
    assert.equal((await viewer.call("PUT", "/api/favorites/character/40882")).status, 200);
    assert.equal((await viewer.call("PUT", "/api/favorites/anime/16498")).status, 200);
    assert.equal((await viewer.call("PUT", "/api/favorites/robot/1")).status, 404);
    let r = await viewer.call("GET", "/api/favorites");
    assert.deepEqual(r.data.items.map((item) => item.name).sort(), ["Атака титанов", "Эрен Йегер"]);
    assert.equal((await viewer.call("GET", "/api/mylist/anime/16498")).data.favorite, true);
    await viewer.call("DELETE", "/api/favorites/character/40882");
    r = await viewer.call("GET", "/api/favorites?type=character");
    assert.equal(r.data.items.length, 0);
  });

  test("рекомендации по жанрам высоко оценённого, без того, что уже в списке", async () => {
    const viewer = await app.user("Вкус");
    await viewer.call("PUT", "/api/mylist/anime/16498", { status: "completed", score: 10 });
    const r = await viewer.call("GET", "/api/recommendations?kind=anime");
    assert.equal(r.status, 200);
    assert.ok(r.data.genres.some((genre) => genre.name === "Экшен"));
    assert.ok(!r.data.items.some((entry) => entry.id === 16498));
    assert.ok(r.data.items.some((entry) => entry.id === 60000));
  });

  test("списки в публичном профиле и их скрытие", async () => {
    const owner = await app.user("Владелец");
    await owner.call("PUT", "/api/mylist/anime/16498", { status: "current", progress: 1, note: "личная заметка" });
    const { username } = (await owner.call("GET", "/api/me")).data.user;
    const guest = app.client();
    let r = await guest.call("GET", `/api/users/${username}/mylist?kind=anime`);
    assert.equal(r.status, 200);
    assert.equal(r.data.items[0].note, "", "заметки не видны другим");
    assert.equal((await guest.call("GET", `/api/users/${username}/encyclopedia`)).data.stats.anime.total, 1);
    await owner.call("PATCH", "/api/me/profile", { showLibrary: false });
    r = await guest.call("GET", `/api/users/${username}/mylist?kind=anime`);
    assert.equal(r.status, 403);
  });
});

// ==================== ОТЗЫВЫ И КОММЕНТАРИИ ====================

describe("отзывы и комментарии", () => {
  const TEXT = "Отличное начало истории: напряжение держится до последней серии, музыка и постановка боёв на высоте.";

  test("отзыв: проверки, правка, удаление своего, оценка ENDEMION", async () => {
    const author = await app.user("Критик");
    const guest = app.client();
    assert.equal((await guest.call("PUT", "/api/catalog/anime/16498/reviews", { score: 9, body: TEXT })).status, 401);
    assert.equal((await author.call("PUT", "/api/catalog/anime/16498/reviews", { score: 9, body: "Коротко." })).status, 400);
    assert.equal((await author.call("PUT", "/api/catalog/anime/16498/reviews", { score: 0, body: TEXT })).status, 400);
    assert.equal((await author.call("PUT", "/api/catalog/anime/16498/reviews", { score: 9, body: `${TEXT} https://a.ru https://b.ru https://c.ru https://d.ru` })).status, 400);
    let r = await author.call("PUT", "/api/catalog/anime/16498/reviews", { score: 9, body: TEXT, spoiler: false });
    assert.equal(r.status, 200);
    assert.equal(r.data.review.score, 9);
    r = await author.call("PUT", "/api/catalog/anime/16498/reviews", { score: 8, body: `${TEXT} Исправлено.` });
    assert.equal(r.data.review.score, 8);
    r = await guest.call("GET", "/api/catalog/anime/16498/reviews");
    assert.ok(r.data.reviews.some((review) => review.body.endsWith("Исправлено.")));
    assert.ok(r.data.score.votes >= 1);
    assert.equal((await guest.call("GET", "/api/entry-reviews")).data.reviews[0].entry.title, "Атака титанов");
    assert.match((await guest.call("GET", "/encyclopedia")).text, /Последние отзывы[\s\S]*Атака титанов/);

    const other = await app.user("Чужой");
    const reviewId = r.data.reviews.find((review) => review.author.id === author.id).id;
    assert.equal((await other.call("DELETE", `/api/entry-reviews/${reviewId}`)).status, 403);
    assert.equal((await author.call("DELETE", "/api/catalog/anime/16498/reviews")).status, 200);
    assert.equal((await guest.call("GET", `/api/entry-reviews/${reviewId}`)).status, 404);
  });

  test("жалоба на отзыв и решение модератора скрывают его", async () => {
    const author = await app.user("Спорщик");
    const reporter = await app.user("Читатель жалоб");
    const moderator = await app.user("Модератор отзывов", "moderator");
    const r = await author.call("PUT", "/api/catalog/manga/23390/reviews", { score: 3, body: TEXT });
    const id = r.data.review.id;
    assert.equal((await reporter.call("POST", "/api/reports", { targetType: "entry_review", targetId: id, reason: "spam" })).status, 201);
    const queue = await moderator.call("GET", "/api/moderation/reports");
    const group = queue.data.groups.find((item) => item.targetType === "entry_review" && item.targetId === id);
    assert.ok(group);
    assert.equal(group.content.link, `/manga/23390#review-${id}`);
    assert.equal((await moderator.call("POST", "/api/moderation/actions", { targetType: "entry_review", targetId: id, action: "remove", reason: "реклама" })).status, 200);
    const list = await app.client().call("GET", "/api/catalog/manga/23390/reviews");
    assert.ok(!list.data.reviews.some((review) => review.id === id), "скрытый не виден");
    const own = await author.call("GET", "/api/catalog/manga/23390/reviews");
    assert.equal(own.data.mine.hidden, true, "автор видит, что отзыв скрыт");
    assert.equal((await moderator.call("GET", "/api/admin/entry-reviews?hidden=1")).data.reviews[0].id, id);
  });

  test("комментарии к произведению и персонажу только для вошедших", async () => {
    const guest = app.client();
    const user = await app.user("Комментатор");
    assert.equal((await guest.call("POST", "/api/comments", { targetType: "anime", targetId: 16498, body: "Привет" })).status, 401);
    let r = await user.call("POST", "/api/comments", { targetType: "anime", targetId: 16498, body: "Лучшее начало сезона" });
    assert.equal(r.status, 201);
    r = await user.call("POST", "/api/comments", { targetType: "character", targetId: 40882, body: "Любимый герой" });
    assert.equal(r.status, 201);
    assert.equal((await user.call("POST", "/api/comments", { targetType: "anime", targetId: 777, body: "Скрытое" })).status, 404);
    r = await guest.call("GET", "/api/comments?type=anime&id=16498");
    assert.equal(r.data.comments[0].body, "Лучшее начало сезона");
  });

  test("рейтинг ENDEMION учитывает оценки из списков и отзывов, одна на пользователя", async () => {
    const a = await app.user("Оценщик А");
    const b = await app.user("Оценщик Б");
    await a.call("PUT", "/api/mylist/anime/60000", { status: "current", score: 10 });
    await a.call("PUT", "/api/catalog/anime/60000/reviews", { score: 2, body: TEXT });
    await b.call("PUT", "/api/catalog/anime/60000/reviews", { score: 8, body: TEXT });
    const r = await app.client().call("GET", "/api/rankings?kind=anime&source=endemion");
    const entry = r.data.items.find((item) => item.id === 60000);
    assert.ok(entry, "попало в рейтинг с двумя оценками");
    assert.equal(entry.endemion.votes, 2);
    assert.equal(entry.endemion.average, 9, "оценка из списка важнее оценки в отзыве того же пользователя");
  });
});

// ==================== АДМИНКА И СБОИ ====================

describe("админка каталога и сбои источника", () => {
  test("раздел каталога только для администратора; настройки сохраняются и пишутся в журнал", async () => {
    const user = await app.user("Не админ");
    const moderator = await app.user("Модератор каталога", "moderator");
    const admin = await app.user("Админ каталога", "admin");
    assert.equal((await user.call("GET", "/api/admin/catalog")).status, 403);
    assert.equal((await moderator.call("GET", "/api/admin/catalog")).status, 403);
    assert.equal((await moderator.call("POST", "/api/admin/catalog/cache", {})).status, 403);
    assert.equal((await user.call("GET", "/api/admin/entry-reviews")).status, 403);
    let r = await admin.call("GET", "/api/admin/catalog");
    assert.equal(r.status, 200);
    assert.equal(r.data.ping.ok, true);
    assert.deepEqual(r.data.settings.hiddenGenres.anime, [12, 539, 33, 34]);

    assert.equal((await admin.call("PUT", "/api/admin/catalog/settings", { allowAdult: false, hiddenGenres: { anime: [999], manga: [] } })).status, 400);
    r = await admin.call("PUT", "/api/admin/catalog/settings", { allowAdult: false, hiddenGenres: { anime: [12, 27], manga: [] }, hero: { kind: "anime", id: 16498 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.settings.hiddenGenres.anime, [12, 27]);
    // Сёнен (27) теперь скрыт: «Атака титанов» пропадает
    assert.equal((await app.client().call("GET", "/anime/16498-shingeki-no-kyojin")).status, 404);
    const audit = await admin.call("GET", "/api/admin/audit?group=catalog");
    assert.ok(audit.data.entries.some((entry) => entry.action === "catalog.settings"));
    await admin.call("PUT", "/api/admin/catalog/settings", { allowAdult: false, hiddenGenres: { anime: [12, 539, 33, 34], manga: [602, 601, 65, 75] }, hero: null });
    assert.equal((await app.client().call("GET", "/anime/16498-shingeki-no-kyojin")).status, 200);
  });

  test("источник недоступен: показывается копия из кеша, без копии — понятная ошибка 503", async () => {
    const guest = app.client();
    await guest.call("GET", "/anime/16498-shingeki-no-kyojin");
    app.db.raw.exec("UPDATE catalog_cache SET expires_at = 0");
    source.state.down = true;
    try {
      const stale = await guest.call("GET", "/anime/16498-shingeki-no-kyojin");
      assert.equal(stale.status, 200, "просроченная копия лучше ошибки");
      const api = await guest.call("GET", "/api/catalog/anime?q=никогда-не-искали");
      assert.equal(api.status, 503);
      assert.match(api.data.error, /недоступен/);
      assert.equal(api.headers.get("retry-after"), "60");
      const page = await guest.call("GET", "/anime?q=никогда-не-искали");
      assert.equal(page.status, 503);
      assert.match(page.text, /Каталог временно недоступен/);
    } finally {
      source.state.down = false;
    }
    const admin = await app.user("Админ ошибок", "admin");
    const status = await admin.call("GET", "/api/admin/catalog");
    assert.ok(status.data.errors.some((item) => /сеть недоступна/.test(item.message)));
    assert.equal((await admin.call("DELETE", "/api/admin/catalog/errors")).status, 200);
    assert.ok((await admin.call("POST", "/api/admin/catalog/cache", {})).data.removed > 0);
  });

  test("sitemap включает разделы и произведения из списков, robots закрывает личное", async () => {
    const guest = app.client();
    const sitemap = await guest.call("GET", "/sitemap.xml");
    assert.match(sitemap.text, /<loc>http:\/\/127\.0\.0\.1:9999\/anime<\/loc>/);
    assert.match(sitemap.text, /\/anime\/16498-shingeki-no-kyojin<\/loc>/);
    assert.match(sitemap.text, /\/manga\/23390-shingeki-no-kyojin<\/loc>/);
    const robots = await guest.call("GET", "/robots.txt");
    assert.match(robots.text, /Disallow: \/mylist/);
  });

  test("удаление аккаунта удаляет списки, избранное и отзывы", async () => {
    const user = await app.user("Уходящий");
    await user.call("PUT", "/api/mylist/anime/16498", { status: "planned" });
    await user.call("PUT", "/api/favorites/anime/16498");
    await user.call("PUT", "/api/catalog/anime/16498/reviews", { score: 7, body: "Хорошее аниме, но вторая половина сезона показалась затянутой." });
    const { PASSWORD } = await import("./helpers/app.mjs");
    assert.equal((await user.call("DELETE", "/api/me", { password: PASSWORD })).status, 200);
    for (const table of ["user_list", "favorites", "entry_reviews"]) {
      const row = await app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(user.id).first();
      assert.equal(row.n, 0, table);
    }
  });
});
