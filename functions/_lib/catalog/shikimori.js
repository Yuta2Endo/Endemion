// Провайдер Shikimori (https://shikimori.io/api/doc). Списки и карточки произведений — через GraphQL,
// персонаж, человек и список студий — через REST: в GraphQL у них нет связанных произведений и сэйю.
// Ответы приводятся к модели каталога (model.js). Кеш, лимиты и повторы делает слой каталога (index.js):
// он передаёт сюда http(operation, url, init), который возвращает JSON или null при ответе 404

import { slugify } from "./model.js";

export const name = "shikimori";
export const label = "Shikimori";
export const BASE = "https://shikimori.io";

const GRAPHQL = `${BASE}/api/graphql`;
const POSTER = "poster { previewUrl preview2xUrl mainUrl main2xUrl }";
const LITE = `id name russian kind status airedOn { year } poster { previewUrl preview2xUrl }`;
const CARD = {
  anime: `id name russian kind status score episodes episodesAired airedOn { year } ${POSTER} genres { id russian kind }`,
  manga: `id name russian kind status score chapters volumes airedOn { year } ${POSTER} genres { id russian kind }`
};
const ROOT = { anime: "animes", manga: "mangas" };
const DATE = "{ year month day date }";

// Кого из создателей показывать на странице произведения, в этом порядке. Продюсеры и десятки других ролей не нужны
const STAFF_ROLES = [
  "Режиссёр", "Главный режиссёр", "Автор оригинала", "Сюжет и иллюстрации", "Сюжет", "Рисовка", "Автор", "Сценарий",
  "Композиция серии", "Дизайн персонажей", "Режиссёр анимации", "Музыка"
];
const STAFF_LIMIT = 14;
const CHARACTERS_LIMIT = 30;

const LINK_LABELS = {
  official_site: "Официальный сайт", wikipedia: "Википедия", myanimelist: "MyAnimeList", anime_news_network: "Anime News Network",
  anime_db: "AniDB", world_art: "World Art", kinopoisk: "Кинопоиск", mangaupdates: "MangaUpdates", mangadex: "MangaDex",
  crunchyroll: "Crunchyroll", netflix: "Netflix", amazon_prime_video: "Prime Video", hidive: "HIDIVE", youtube: "YouTube"
};

// ==================== ЗАПРОСЫ ====================

/** GraphQL-запрос. Ошибки GraphQL приходят с кодом 200: такой ответ тоже ошибка */
async function graphql(http, operation, query, variables = {}) {
  const result = await http(operation, GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (!result) throw new Error("GraphQL вернул 404");
  if (result.errors?.length) throw new Error(`GraphQL: ${String(result.errors[0].message).slice(0, 200)}`);
  return result.data;
}

const rest = (http, operation, path) => http(operation, `${BASE}${path}`, {});

// ==================== ПРИВЕДЕНИЕ К МОДЕЛИ ====================

/** Полный адрес картинки или null. У записей без картинки Shikimori отдаёт заглушку missing_* */
function absolute(url) {
  if (!url || /missing_/.test(url)) return null;
  return url.startsWith("http") ? url : `${BASE}${url}`;
}

function posterSet(poster) {
  if (!poster || !absolute(poster.previewUrl)) return null;
  return {
    small: absolute(poster.previewUrl),
    small2x: absolute(poster.preview2xUrl),
    medium: absolute(poster.mainUrl),
    medium2x: absolute(poster.main2xUrl)
  };
}

/** Картинка из REST: preview (160 px по ширине) и original */
function restImage(image) {
  if (!image || !absolute(image.preview)) return null;
  return { small: absolute(image.preview), small2x: absolute(image.original), medium: absolute(image.original) };
}

const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

function genresOf(list) {
  // Сначала жанры, затем темы и аудитория: «Экшен · Драма» полезнее, чем «Сёнен»
  const order = { genre: 0, theme: 1, demographic: 2 };
  return (list || [])
    .map((genre) => ({ id: Number(genre.id), name: genre.russian, kind: genre.kind }))
    .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
}

function card(kind, node) {
  const score = num(node.score);
  return {
    kind,
    id: Number(node.id),
    slug: slugify(node.name),
    title: node.russian || node.name,
    titleEn: node.name,
    type: node.kind || "",
    status: node.status || "",
    year: node.airedOn?.year || null,
    units: (kind === "anime" ? node.episodes : node.chapters) || 0,
    unitsAired: kind === "anime" ? node.episodesAired || 0 : 0,
    volumes: node.volumes || 0,
    score: score > 0 ? score : null,
    genres: genresOf(node.genres),
    poster: posterSet(node.poster)
  };
}

/** Короткая запись произведения для связей, работ человека и персонажа */
function lite(kind, node) {
  return {
    kind,
    id: Number(node.id),
    slug: slugify(node.name),
    title: node.russian || node.name,
    titleEn: node.name,
    type: node.kind || "",
    status: node.status || "",
    year: node.airedOn?.year || (node.aired_on ? Number(String(node.aired_on).slice(0, 4)) : null),
    score: num(node.score) > 0 ? num(node.score) : null,
    poster: node.poster ? posterSet(node.poster) : restImage(node.image)
  };
}

function personLite(node) {
  return {
    id: Number(node.id),
    slug: slugify(node.name),
    name: node.russian || node.name,
    nameEn: node.name,
    image: node.poster ? posterSet(node.poster) : restImage(node.image)
  };
}

function dateParts(value) {
  if (!value || !value.year) return null;
  return { year: value.year, month: value.month || null, day: value.day || null };
}

function staffOf(personRoles) {
  const rank = (roles) => Math.min(...roles.map((role) => STAFF_ROLES.indexOf(role)));
  return (personRoles || [])
    .map((item) => ({ ...personLite(item.person), roles: (item.rolesRu || []).filter((role) => STAFF_ROLES.includes(role)) }))
    .filter((person) => person.roles.length)
    .sort((a, b) => rank(a.roles) - rank(b.roles))
    .slice(0, STAFF_LIMIT);
}

function charactersOf(characterRoles) {
  const list = (characterRoles || []).map((item) => ({
    ...personLite(item.character),
    role: (item.rolesEn || []).includes("Main") ? "main" : "supporting"
  }));
  const main = list.filter((item) => item.role === "main");
  return [...main, ...list.filter((item) => item.role !== "main")].slice(0, Math.max(CHARACTERS_LIMIT, main.length));
}

function relatedOf(related) {
  return (related || [])
    .map((item) => {
      const node = item.anime || item.manga;
      return node ? { relation: item.relationText, relationKind: item.relationKind, entry: lite(item.anime ? "anime" : "manga", node) } : null;
    })
    .filter(Boolean)
    .slice(0, 40);
}

function linksOf(links) {
  return (links || [])
    .filter((link) => LINK_LABELS[link.kind] && /^https?:\/\//.test(link.url))
    .map((link) => ({ label: LINK_LABELS[link.kind], url: link.url }))
    .filter((link, i, all) => all.findIndex((other) => other.label === link.label) === i);
}

function detail(kind, node) {
  return {
    ...card(kind, node),
    english: node.english || "",
    japanese: node.japanese || "",
    synonyms: node.synonyms || [],
    description: node.description || "",
    ageRating: node.rating && node.rating !== "none" ? node.rating : "",
    duration: node.duration || 0,
    season: node.season || "",
    nextEpisodeAt: node.nextEpisodeAt || null,
    airedOn: dateParts(node.airedOn),
    releasedOn: dateParts(node.releasedOn),
    studios: (node.studios || []).map((studio) => ({ id: Number(studio.id), slug: slugify(studio.name), name: studio.name, image: absolute(studio.imageUrl) })),
    publishers: (node.publishers || []).map((publisher) => ({ id: Number(publisher.id), name: publisher.name })),
    staff: staffOf(node.personRoles),
    characters: charactersOf(node.characterRoles),
    related: relatedOf(node.related),
    links: linksOf(node.externalLinks),
    sourceUrl: absolute(node.url)
  };
}

// ==================== ПРОИЗВЕДЕНИЯ ====================

const LIST_ARGS = {
  anime: { page: "PositiveInt", limit: "PositiveInt", order: "OrderEnum", kind: "AnimeKindString", status: "AnimeStatusString",
    season: "SeasonString", score: "Int", genre: "String", studio: "String", search: "String", censored: "Boolean",
    rating: "RatingString", ids: "String", excludeIds: "String" },
  manga: { page: "PositiveInt", limit: "PositiveInt", order: "OrderEnum", kind: "MangaKindString", status: "MangaStatusString",
    season: "SeasonString", score: "Int", genre: "String", search: "String", censored: "Boolean", ids: "String", excludeIds: "String" }
};

/**
 * Страница списка. filters уже проверены слоем каталога:
 * { page, limit, order, types[], status, season, score, genres[], excludeGenres[], studio, search, rating, censored }
 */
export async function listEntries(http, kind, filters) {
  const genre = [...(filters.genres || []), ...(filters.excludeGenres || []).map((id) => `!${id}`)].join(",");
  const variables = {
    page: filters.page || 1,
    limit: filters.limit || 24,
    order: filters.order || "popularity",
    kind: filters.types?.length ? filters.types.join(",") : null,
    status: filters.status || null,
    season: filters.season || null,
    score: filters.score || null,
    genre: genre || null,
    search: filters.search || null,
    censored: filters.censored,
    ids: filters.ids?.length ? filters.ids.join(",") : null,
    ...(kind === "anime" ? { studio: filters.studio ? String(filters.studio) : null, rating: filters.rating || null } : {})
  };
  const args = LIST_ARGS[kind];
  const used = Object.keys(variables).filter((key) => args[key] && variables[key] !== null && variables[key] !== undefined);
  const query = `query(${used.map((key) => `$${key}: ${args[key]}`).join(", ")}) {
    items: ${ROOT[kind]}(${used.map((key) => `${key}: $${key}`).join(", ")}) { ${CARD[kind]} } }`;
  const data = await graphql(http, `${kind}.list`, query, Object.fromEntries(used.map((key) => [key, variables[key]])));
  const items = data.items.map((node) => card(kind, node));
  return { items, page: variables.page, hasMore: items.length >= variables.limit };
}

const DETAIL = {
  anime: `${CARD.anime} english japanese synonyms rating duration season nextEpisodeAt description url
    airedOn ${DATE} releasedOn ${DATE} studios { id name imageUrl } externalLinks { kind url }
    personRoles { rolesRu person { id name russian ${POSTER} } }
    characterRoles { rolesEn character { id name russian ${POSTER} } }
    related { relationKind relationText anime { ${LITE} } manga { ${LITE} } }`,
  manga: `${CARD.manga} english japanese synonyms description url
    airedOn ${DATE} releasedOn ${DATE} publishers { id name } externalLinks { kind url }
    personRoles { rolesRu person { id name russian ${POSTER} } }
    characterRoles { rolesEn character { id name russian ${POSTER} } }
    related { relationKind relationText anime { ${LITE} } manga { ${LITE} } }`
};

/** Произведение целиком или null, если такого нет */
export async function getEntry(http, kind, id) {
  const data = await graphql(http, `${kind}.get`, `query($ids: String) { items: ${ROOT[kind]}(ids: $ids, limit: 1) { ${DETAIL[kind]} } }`, { ids: String(id) });
  return data.items[0] ? detail(kind, data.items[0]) : null;
}

export async function genres(http, kind) {
  const data = await graphql(http, `${kind}.genres`, `query { genres(entryType: ${kind === "anime" ? "Anime" : "Manga"}) { id russian kind } }`);
  return data.genres.map((genre) => ({ id: Number(genre.id), name: genre.russian, kind: genre.kind }));
}

// ==================== ГЛАВНАЯ И ПОИСК ====================

const MAIN_CHARACTERS = `characterRoles { rolesEn character { id name russian ${POSTER} } }`;

function mainCharacters(works, limit) {
  const seen = new Set();
  const result = [];
  for (const work of works) {
    for (const item of work.characterRoles || []) {
      if (!(item.rolesEn || []).includes("Main") || seen.has(item.character.id)) continue;
      seen.add(item.character.id);
      result.push({ ...personLite(item.character), from: work.russian || work.name });
    }
  }
  // По очереди из каждого произведения: иначе первые места займут герои одного тайтла
  const byWork = new Map();
  for (const item of result) byWork.set(item.from, [...(byWork.get(item.from) || []), item]);
  const mixed = [];
  for (let i = 0; mixed.length < result.length; i++) for (const list of byWork.values()) if (list[i]) mixed.push(list[i]);
  return mixed.slice(0, limit);
}

/** Подборки главной одним запросом: популярное за последние два года, манга, онгоинги, анонсы, герои */
export async function home(http, { censored, year, excludeGenres }) {
  const genre = excludeGenres.anime.map((id) => `!${id}`).join(",") || null;
  const mangaGenre = excludeGenres.manga.map((id) => `!${id}`).join(",") || null;
  const data = await graphql(http, "home", `query($censored: Boolean, $season: SeasonString, $genre: String, $mangaGenre: String) {
    hero: animes(status: "ongoing", order: popularity, limit: 6, censored: $censored, genre: $genre) { ${CARD.anime} description }
    popularAnime: animes(season: $season, order: popularity, limit: 12, censored: $censored, genre: $genre) { ${CARD.anime} }
    popularManga: mangas(order: popularity, limit: 12, censored: $censored, genre: $mangaGenre) { ${CARD.manga} }
    ongoing: animes(status: "ongoing", order: popularity, limit: 12, censored: $censored, genre: $genre) { ${CARD.anime} }
    anons: animes(status: "anons", order: popularity, limit: 12, censored: $censored, genre: $genre) { ${CARD.anime} }
    characterSource: animes(order: popularity, limit: 6, censored: true) { name russian ${MAIN_CHARACTERS} }
  }`, { censored, season: `${year - 1}_${year}`, genre, mangaGenre });
  return {
    hero: data.hero.map((node) => ({ ...card("anime", node), description: node.description || "" })),
    popularAnime: data.popularAnime.map((node) => card("anime", node)),
    popularManga: data.popularManga.map((node) => card("manga", node)),
    ongoing: data.ongoing.map((node) => card("anime", node)),
    anons: data.anons.map((node) => card("anime", node)),
    characters: mainCharacters(data.characterSource, 18)
  };
}

/** Поиск сразу по аниме, манге, персонажам и людям */
export async function search(http, { query, limit, censored }) {
  const data = await graphql(http, "search", `query($q: String, $limit: PositiveInt, $censored: Boolean) {
    anime: animes(search: $q, limit: $limit, censored: $censored) { ${LITE} score }
    manga: mangas(search: $q, limit: $limit, censored: $censored) { ${LITE} score }
    characters: characters(search: $q, limit: $limit) { id name russian ${POSTER} }
    people: people(search: $q, limit: $limit) { id name russian ${POSTER} }
  }`, { q: query, limit, censored });
  return {
    anime: data.anime.map((node) => lite("anime", node)),
    manga: data.manga.map((node) => lite("manga", node)),
    characters: data.characters.map(personLite),
    people: data.people.map(personLite)
  };
}

// ==================== ПЕРСОНАЖИ ====================

export async function listCharacters(http, { search: query, page, limit }) {
  const data = await graphql(http, "characters.list", `query($q: String, $page: PositiveInt, $limit: PositiveInt) {
    items: characters(search: $q, page: $page, limit: $limit) { id name russian isAnime isManga ${POSTER} } }`, { q: query || null, page, limit });
  const items = data.items.map((node) => ({ ...personLite(node), isAnime: node.isAnime, isManga: node.isManga }));
  return { items, page, hasMore: items.length >= limit };
}

/** Главные герои популярных аниме или манги: список персонажей без поиска */
export async function popularCharacters(http, kind) {
  const data = await graphql(http, `characters.popular.${kind}`, `query {
    works: ${ROOT[kind]}(order: popularity, limit: 12, censored: true) { name russian ${MAIN_CHARACTERS} } }`);
  return mainCharacters(data.works, 60);
}

function roleText(role) {
  return role === "Main" ? "Главная роль" : role === "Supporting" ? "Второстепенная роль" : role || "";
}

export async function getCharacter(http, id) {
  const node = await rest(http, "character.get", `/api/characters/${id}`);
  if (!node || !node.id) return null;
  const works = [
    ...(node.animes || []).map((item) => ({ entry: lite("anime", item), role: roleText(item.role) })),
    ...(node.mangas || []).map((item) => ({ entry: lite("manga", item), role: roleText(item.role) }))
  ];
  return {
    id: Number(node.id),
    slug: slugify(node.name),
    name: node.russian || node.name,
    nameEn: node.name,
    japanese: node.japanese || "",
    altNames: [node.altname].filter((alt) => alt && alt !== node.name),
    description: node.description || "",
    image: restImage(node.image),
    seyu: (node.seyu || []).map(personLite),
    works,
    sourceUrl: absolute(node.url)
  };
}

// ==================== ЛЮДИ ====================

const PEOPLE_ROLES = { seyu: "isSeyu", mangaka: "isMangaka", producer: "isProducer" };

export async function listPeople(http, { search: query, role, page, limit }) {
  const flag = PEOPLE_ROLES[role];
  const data = await graphql(http, "people.list", `query($q: String, $page: PositiveInt, $limit: PositiveInt${flag ? ", $flag: Boolean" : ""}) {
    items: people(search: $q, page: $page, limit: $limit${flag ? `, ${flag}: $flag` : ""}) { id name russian isSeyu isMangaka isProducer ${POSTER} } }`,
  { q: query || null, page, limit, ...(flag ? { flag: true } : {}) });
  const items = data.items.map((node) => ({
    ...personLite(node),
    roles: [node.isSeyu && "seyu", node.isMangaka && "mangaka", node.isProducer && "producer"].filter(Boolean)
  }));
  return { items, page, hasMore: items.length >= limit };
}

export async function getPerson(http, id) {
  const node = await rest(http, "person.get", `/api/people/${id}`);
  if (!node || !node.id) return null;
  const voiced = [];
  for (const role of node.roles || []) {
    const work = (role.animes || [])[0] || (role.mangas || [])[0];
    for (const character of role.characters || []) {
      voiced.push({ character: personLite(character), entry: work ? lite(role.animes?.length ? "anime" : "manga", work) : null });
    }
  }
  return {
    id: Number(node.id),
    slug: slugify(node.name),
    name: node.russian || node.name,
    nameEn: node.name,
    japanese: node.japanese || "",
    jobTitle: node.job_title || "",
    birthOn: dateParts(node.birth_on),
    deceasedOn: dateParts(node.deceased_on),
    website: /^https?:\/\//.test(node.website || "") ? node.website : "",
    image: restImage(node.image),
    roleGroups: (node.groupped_roles || []).slice(0, 10).map(([role, count]) => ({ role, count })),
    works: (node.works || [])
      .map((work) => ({ entry: work.anime ? lite("anime", work.anime) : work.manga ? lite("manga", work.manga) : null, role: work.role }))
      .filter((work) => work.entry)
      .slice(0, 120),
    voiced: voiced.slice(0, 80),
    sourceUrl: absolute(node.url)
  };
}

// ==================== СТУДИИ ====================

export async function listStudios(http) {
  const list = await rest(http, "studios.list", "/api/studios");
  return (list || []).map((studio) => ({
    id: Number(studio.id),
    slug: slugify(studio.name),
    name: studio.name,
    image: absolute(studio.image),
    real: Boolean(studio.real)
  }));
}

// ==================== ПРОВЕРКА ====================

export async function ping(http) {
  await graphql(http, "ping", "query { animes(limit: 1) { id } }");
}
