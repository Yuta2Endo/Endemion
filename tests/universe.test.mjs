// Universe Explorer: карта вселенной, хронология и режим спойлеров — настоящими запросами через src/worker.js.
// Источник каталога подменён (CATALOG_FETCH), как в tests/encyclopedia.test.mjs: тесты не ходят в сеть.
// Сущности и связи ниже — тестовые записи, на рабочий сайт они не попадают

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp, PASSWORD } from "./helpers/app.mjs";

const poster = (id) => ({
  previewUrl: `https://shikimori.io/uploads/poster/${id}/preview.webp`,
  preview2xUrl: `https://shikimori.io/uploads/poster/${id}/preview2x.webp`,
  mainUrl: `https://shikimori.io/uploads/poster/${id}/main.webp`,
  main2xUrl: `https://shikimori.io/uploads/poster/${id}/main2x.webp`
});
const person = (id, name, russian) => ({ id: String(id), name, russian, poster: poster(id) });

const ANIME = {
  id: "16498", name: "Shingeki no Kyojin", russian: "Атака титанов", english: "Attack on Titan", japanese: "進撃の巨人", synonyms: [],
  kind: "tv", status: "released", score: 8.58, episodes: 25, episodesAired: 25, duration: 24, rating: "r", season: "spring_2013",
  airedOn: { year: 2013, month: 4, day: 7 }, releasedOn: { year: 2013, month: 9, day: 29 }, nextEpisodeAt: null,
  poster: poster(16498), url: "/animes/16498-shingeki-no-kyojin", description: "", externalLinks: [],
  genres: [{ id: "1", russian: "Экшен", kind: "genre" }],
  studios: [{ id: "858", name: "Wit Studio", imageUrl: "/system/studios/original/858.png" }],
  personRoles: [{ rolesRu: ["Режиссёр"], person: person(1117, "Tetsuro Araki", "Тэцуро Араки") }],
  characterRoles: [
    { rolesEn: ["Main"], character: person(40882, "Eren Yeager", "Эрен Йегер") },
    { rolesEn: ["Main"], character: person(40881, "Mikasa Ackerman", "Микаса Аккерман") },
    { rolesEn: ["Supporting"], character: person(46496, "Hannes", "Ханнес") }
  ],
  related: [{
    relationKind: "sequel", relationText: "Продолжение", manga: null,
    anime: { id: "25777", name: "Shingeki no Kyojin Season 2", russian: "Атака титанов 2", kind: "tv", status: "released", airedOn: { year: 2017 }, poster: poster(25777) }
  }]
};

function fakeCatalog() {
  return async (url, init = {}) => {
    if (new URL(url).pathname !== "/api/graphql") return new Response("{}", { status: 404 });
    const { query, variables = {} } = JSON.parse(String(init.body));
    const found = query.includes("items: animes") && String(variables.ids || "").split(",").includes(ANIME.id);
    return new Response(JSON.stringify({ data: { items: found ? [ANIME] : [] } }), { headers: { "Content-Type": "application/json" } });
  };
}

let app;
const E = {};

function addEntity(fields) {
  const row = { description: "", episode: null, chronology_order: null, spoiler_level: 0, source_reference: "Эпизод 1", ...fields };
  return app.db.prepare(
    `INSERT INTO universe_entities (kind, ext_id, entity_type, title, description, episode, chronology_order, spoiler_level, source_reference)
     VALUES ('anime', 16498, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(row.entity_type, row.title, row.description, row.episode, row.chronology_order, row.spoiler_level, row.source_reference).first("id");
}

function addRelation(fields) {
  const row = { description: "", episode: null, spoiler_level: 0, source_reference: "Эпизод 1", ...fields };
  return app.db.prepare(
    `INSERT INTO universe_relations (kind, ext_id, source_type, source_id, target_type, target_id, relation_type, description, episode, spoiler_level, source_reference)
     VALUES ('anime', 16498, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(row.source_type, row.source_id, row.target_type, row.target_id, row.relation_type, row.description, row.episode, row.spoiler_level, row.source_reference).first("id");
}

before(async () => {
  app = await createApp({ extraEnv: { CATALOG_FETCH: fakeCatalog(), CATALOG_RETRY_BASE_MS: "1" } });
  E.corps = await addEntity({ entity_type: "organization", title: "Разведкорпус" });
  E.wallMaria = await addEntity({ entity_type: "event", title: "Падение стены Мария", episode: 1, chronology_order: 1, spoiler_level: 1 });
  E.trost = await addEntity({ entity_type: "event", title: "Битва за Трост", episode: 5, chronology_order: 2, spoiler_level: 1, source_reference: "Эпизоды 5–13" });
  // Событие без эпизода, помеченное как финальный спойлер, и раньше всех в хронологии мира
  E.reveal = await addEntity({ entity_type: "event", title: "Тайна подвала", chronology_order: 0, spoiler_level: 2 });
  await addRelation({ source_type: "character", source_id: 40882, target_type: "character", target_id: 40881, relation_type: "family", description: "Выросли вместе" });
  await addRelation({ source_type: "character", source_id: 40881, target_type: "entity", target_id: E.wallMaria, relation_type: "participates_in", episode: 1 });
  await addRelation({ source_type: "character", source_id: 40882, target_type: "entity", target_id: E.trost, relation_type: "participates_in", episode: 5 });
  // Персонажа 99999 нет в этом произведении: связь не должна попасть на карту
  await addRelation({ source_type: "character", source_id: 99999, target_type: "character", target_id: 40882, relation_type: "friend" });
});

after(async () => {
  await app.close();
});

const nodeIds = (data) => new Set(data.nodes.map((node) => node.id));

describe("карта вселенной", () => {
  test("гость видит карту из каталога и сведения без спойлеров", async () => {
    const r = await app.client().call("GET", "/api/universe/anime/16498");
    assert.equal(r.status, 200);
    const ids = nodeIds(r.data);
    for (const id of ["work:anime:16498", "character:40882", "character:40881", "character:46496", "person:1117", "studio:858",
      "work:anime:25777", `entity:${E.corps}`]) {
      assert.ok(ids.has(id), id);
    }
    for (const key of ["wallMaria", "trost", "reveal"]) assert.ok(!ids.has(`entity:${E[key]}`), `${key} скрыт`);
    assert.equal(r.data.mode, "safe");
    assert.equal(r.data.hidden, 3);
    assert.equal(r.data.nodes.find((node) => node.center).url, "/anime/16498-shingeki-no-kyojin");
    assert.equal(r.data.nodes.find((node) => node.id === "character:40882").url, "/characters/40882-eren-yeager");
    assert.equal(r.data.nodes.find((node) => node.id === "character:40882").image, poster(40882).previewUrl);
    assert.equal(r.data.nodes.find((node) => node.id === "character:46496").role, "supporting");
    assert.equal(r.data.edges.filter((edge) => edge.type === "appears_in").length, 3);
    assert.ok(r.data.edges.some((edge) => edge.type === "family" && edge.source === "character:40882" && edge.target === "character:40881"));
    assert.ok(!r.data.edges.some((edge) => edge.source === "character:99999"), "связь с чужим персонажем отброшена");
    for (const edge of r.data.edges) assert.ok(ids.has(edge.source) && ids.has(edge.target), `у связи ${edge.type} есть оба конца`);
  });

  test("прогресс из списка открывает события до просмотренного эпизода", async () => {
    const viewer = await app.user("Зритель");
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/16498", { status: "current", progress: 5 })).status, 200);
    let r = await viewer.call("GET", "/api/universe/anime/16498");
    let ids = nodeIds(r.data);
    assert.ok(ids.has(`entity:${E.wallMaria}`) && ids.has(`entity:${E.trost}`));
    assert.ok(!ids.has(`entity:${E.reveal}`), "спойлер без эпизода скрыт до конца просмотра");
    assert.equal(r.data.progress, 5);
    assert.equal(r.data.hidden, 1);
    assert.equal(r.data.edges.filter((edge) => edge.type === "participates_in").length, 2);

    // Последний эпизод — «Просмотрено», видно всё
    assert.equal((await viewer.call("PUT", "/api/mylist/anime/16498", { progress: 25 })).data.item.status, "completed");
    r = await viewer.call("GET", "/api/universe/anime/16498");
    ids = nodeIds(r.data);
    assert.ok(ids.has(`entity:${E.reveal}`));
    assert.equal(r.data.hidden, 0);
  });

  test("режим «полная энциклопедия»: в адресе и сохранённый у зрителя", async () => {
    const guest = app.client();
    let r = await guest.call("GET", "/api/universe/anime/16498?mode=full");
    assert.equal(r.data.mode, "full");
    assert.equal(r.data.hidden, 0);
    assert.ok(nodeIds(r.data).has(`entity:${E.reveal}`));
    assert.equal((await guest.call("GET", "/api/universe/anime/16498?mode=all")).status, 400);
    assert.equal((await guest.call("PUT", "/api/universe/anime/16498/settings", { mode: "full" })).status, 401);

    const viewer = await app.user("Читатель энциклопедии");
    assert.equal((await viewer.call("PUT", "/api/universe/anime/16498/settings", { mode: "everything" })).status, 400);
    assert.equal((await viewer.call("PUT", "/api/universe/anime/123456/settings", { mode: "full" })).status, 404);
    r = await viewer.call("PUT", "/api/universe/anime/16498/settings", { mode: "full" });
    assert.equal(r.status, 200);
    r = await viewer.call("GET", "/api/universe/anime/16498");
    assert.equal(r.data.mode, "full");
    assert.equal(r.data.hidden, 0);
    // Параметр в адресе важнее сохранённого режима
    assert.equal((await viewer.call("GET", "/api/universe/anime/16498?mode=safe")).data.hidden, 3);
  });

  test("ошибки адреса", async () => {
    const guest = app.client();
    for (const url of ["/api/universe/anime/123456", "/api/universe/books/16498", "/api/universe/anime/abc", "/api/universe/anime/123456/timeline"]) {
      assert.equal((await guest.call("GET", url)).status, 404, url);
    }
    assert.equal((await guest.call("GET", "/api/universe/anime/16498/timeline?order=random")).status, 400);
  });
});

describe("хронология", () => {
  test("порядок показа и хронология мира, участники события", async () => {
    const guest = app.client();
    let r = await guest.call("GET", "/api/universe/anime/16498/timeline?mode=full");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.events.map((event) => event.title), ["Падение стены Мария", "Битва за Трост", "Тайна подвала"]);
    assert.equal(r.data.hasChronology, true);
    assert.deepEqual(r.data.events.find((event) => event.title === "Битва за Трост").participants.map((item) => item.name), ["Эрен Йегер"]);
    assert.equal(r.data.events[1].source, "Эпизоды 5–13");

    r = await guest.call("GET", "/api/universe/anime/16498/timeline?mode=full&order=chronology");
    assert.deepEqual(r.data.events.map((event) => event.title), ["Тайна подвала", "Падение стены Мария", "Битва за Трост"]);

    r = await guest.call("GET", "/api/universe/anime/16498/timeline");
    assert.deepEqual(r.data.events, [], "гостю без спойлеров события не показываются");
    assert.equal(r.data.hidden, 3);
  });
});

describe("целостность данных", () => {
  test("связь с самим собой, запись без источника и хронология не у события отклоняются", async () => {
    await assert.rejects(addRelation({ source_type: "character", source_id: 40882, target_type: "character", target_id: 40882, relation_type: "friend" }), /CHECK constraint failed/);
    await assert.rejects(addEntity({ entity_type: "event", title: "Без источника", source_reference: "" }), /CHECK constraint failed/);
    await assert.rejects(addEntity({ entity_type: "location", title: "Локация с хронологией", chronology_order: 3 }), /CHECK constraint failed/);
    await assert.rejects(addRelation({ source_type: "character", source_id: 40882, target_type: "entity", target_id: E.corps, relation_type: "appears_in" }), /CHECK constraint failed/);
  });

  test("удаление сущности удаляет её связи", async () => {
    const id = await addEntity({ entity_type: "location", title: "Шиганшина" });
    await addRelation({ source_type: "character", source_id: 40882, target_type: "entity", target_id: id, relation_type: "located_in" });
    await app.db.prepare("DELETE FROM universe_entities WHERE id = ?").bind(id).run();
    const left = await app.db.prepare("SELECT COUNT(*) AS n FROM universe_relations WHERE target_type = 'entity' AND target_id = ?").bind(id).first("n");
    assert.equal(left, 0);
  });

  test("удаление аккаунта удаляет его режим спойлеров", async () => {
    const viewer = await app.user("Уходящий зритель");
    await viewer.call("PUT", "/api/universe/anime/16498/settings", { mode: "full" });
    assert.equal((await viewer.call("DELETE", "/api/me", { password: PASSWORD })).status, 200);
    const left = await app.db.prepare("SELECT COUNT(*) AS n FROM user_spoiler_settings WHERE user_id = ?").bind(viewer.id).first("n");
    assert.equal(left, 0);
  });
});
