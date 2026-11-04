// Страницы энциклопедии: главная, каталоги аниме и манги, страница произведения, персонажи, люди, студии,
// сезоны, рейтинги, поиск и «Мой список». Содержимое каталога собирается на сервере: страницы видят поисковики,
// а фильтры, поиск и страницы работают обычными ссылками и формами даже без скриптов.
// Скрипты (public/assets/ency.js, entry.js, mylist.js) добавляют личное: списки, оценки, избранное, отзывы, комментарии.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { parseCatalogFilters } from "./api/encyclopedia.js";
import { bbcodeToHtml, bbcodeToText } from "./_lib/catalog/bbcode.js";
import {
  getCharacter, getEntry, getGenres, getPerson, getSettings, getStudio, homeData, isHidden, listCharacters, listEntries,
  listPeople, listStudios, popularCharacters, searchAll
} from "./_lib/catalog/index.js";
import { endemionScore, endemionTop, recentEntryReviews } from "./_lib/catalog/lists.js";
import {
  AGE_RATING_FILTERS, AGE_RATINGS, ANIME_TYPE_FILTERS, ANIME_TYPES, characterPath, currentSeason, entryPath, KIND_LABELS,
  MANGA_TYPES, ORDERS, parseSeasonCode, parseSlugId, personPath, seasonCode, seasonLabel, SEASONS, shiftSeason, STATUSES, studioPath
} from "./_lib/catalog/model.js";
import {
  ageLabel, entryCard, fact, genreLink, grid, isoDate, partialDate, personCard, personLink, portraitImg, posterImg, rail, statusLabel,
  studioLink, typeLabel, unitsText
} from "./_lib/catalog/render.js";
import { escapeHtml as e, notFound } from "./_lib/html.js";
import { renderPage, sectionHeading } from "./_lib/layout.js";
import { cleanLine } from "./_lib/validate.js";

const STYLES = ["ency.css"];
// HTML каталога одинаков для всех: личное дорисовывает скрипт. Пять минут в браузере, дальше — заново
const CACHE = "public, max-age=300";

const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;

function breadcrumbs(origin, items) {
  const nav = `<nav class="breadcrumbs" aria-label="Навигация">${items.map(([label, path], i) =>
    i === items.length - 1 ? `<span>${e(label)}</span>` : `<a href="${e(path)}">${e(label)}</a> <span aria-hidden="true">/</span> `).join("")}</nav>`;
  const data = ld({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([label, path], i) => ({ "@type": "ListItem", position: i + 1, name: label, item: `${origin}${path}` }))
  });
  return { nav, data };
}

/** Мета-теги Open Graph и Twitter для страницы с картинкой */
function ogHead({ type = "website", title, description, url, image, imageAlt = "" }) {
  return `<meta property="og:type" content="${type}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(url)}">
  <meta property="og:image" content="${e(image)}">
  ${imageAlt ? `<meta property="og:image:alt" content="${e(imageAlt)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">`;
}

/** Каталог недоступен (источник не ответил, копии нет): страница с кодом 503 и предложением обновить */
function unavailable(request, active) {
  const body = `<div class="container page"><div class="state state-error" role="alert">
    <span class="state-icon">⚠</span><strong>Каталог временно недоступен</strong>
    <p>Источник данных не ответил. Обычно это проходит за минуту.</p>
    <a class="ghost-btn" href="${e(new URL(request.url).pathname)}">Обновить страницу</a></div></div>`;
  return renderPage(request, { title: "Каталог недоступен", active, body, styles: STYLES, scripts: ["ency.js"], noindex: true, status: 503, cache: "no-store" });
}

/** Страница из каталога: ошибка источника превращается в понятную страницу 503 */
function catalogPage(active, handler) {
  return {
    async onRequestGet(context) {
      try {
        return await handler(context);
      } catch (err) {
        if (err?.name === "CatalogError") return unavailable(context.request, active);
        throw err;
      }
    }
  };
}

function redirect(location, status = 301) {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "public, max-age=3600" } });
}

/** Номер страницы списка из адреса */
const pageNumber = (search) => Math.min(200, Math.max(1, Number.parseInt(search.get("page") || "1", 10) || 1));

/** Ссылки «Назад» и «Дальше». Остальные параметры адреса сохраняются */
function pager(url, page, hasMore) {
  if (page <= 1 && !hasMore) return "";
  const link = (number) => {
    const params = new URLSearchParams(url.search);
    if (number > 1) params.set("page", String(number));
    else params.delete("page");
    return `${url.pathname}${params.size ? `?${params}` : ""}`;
  };
  return `<nav class="pager" aria-label="Страницы">
    ${page > 1 ? `<a class="ghost-btn" href="${e(link(page - 1))}" rel="prev">← Назад</a>` : "<span></span>"}
    <span class="pager-page">Страница ${page}</span>
    ${hasMore ? `<a class="ghost-btn" href="${e(link(page + 1))}" rel="next">Дальше →</a>` : "<span></span>"}
  </nav>`;
}

const options = (entries, selected) => entries.map(([value, label]) =>
  `<option value="${e(value)}"${String(value) === String(selected) ? " selected" : ""}>${e(label)}</option>`).join("");

// ==================== ГЛАВНАЯ ====================

function heroSlide(entry, index) {
  const genres = entry.genres.slice(0, 4).map((genre) => genreLink(entry.kind, genre)).join("");
  const meta = [typeLabel(entry.kind, entry.type), entry.year, unitsText(entry), statusLabel(entry.kind, entry.status)].filter(Boolean).join(" · ");
  return `<article class="hero-slide${index ? "" : " is-active"}" data-slide="${index}"${index ? " hidden" : ""} aria-roledescription="слайд" aria-label="${index + 1}">
      <div class="hero-backdrop" aria-hidden="true">${posterImg(entry.poster, "", { lazy: index > 0, sizes: "100vw", className: "hero-backdrop-img" })}</div>
      <div class="container hero-inner">
        <a class="hero-poster" href="${e(entryPath(entry))}" tabindex="-1" aria-hidden="true">${posterImg(entry.poster, "", { lazy: index > 0, priority: index === 0, sizes: "(max-width: 680px) 40vw, 260px" })}</a>
        <div class="hero-copy">
          <div class="eyebrow">Сейчас в эфире · популярное</div>
          <h2 class="hero-title"><a href="${e(entryPath(entry))}">${e(entry.title)}</a></h2>
          <p class="hero-meta">${entry.score ? `<span class="hero-score">★ ${entry.score.toFixed(2)}</span>` : ""}<span>${e(meta)}</span></p>
          <div class="tags">${genres}</div>
          <p class="hero-desc">${e(bbcodeToText(entry.description, 260))}</p>
          <div class="hero-actions">
            <a class="primary-btn" href="${e(entryPath(entry))}">Подробнее</a>
            <button class="ghost-btn" type="button" data-list-add data-kind="${entry.kind}" data-id="${entry.id}" data-title="${e(entry.title)}">＋ Добавить в список</button>
          </div>
        </div>
      </div>
    </article>`;
}

function reviewTeaser(review) {
  const author = review.author.username
    ? `<a href="/users/${e(encodeURIComponent(review.author.username))}">${e(review.author.name)}</a>`
    : e(review.author.name);
  return `<article class="review-teaser">
    <a class="review-teaser-poster" href="${e(entryPath(review.entry))}#review-${review.id}" tabindex="-1" aria-hidden="true">${posterImg(review.entry.poster, "", { sizes: "64px" })}</a>
    <div>
      <p class="review-teaser-head"><a href="${e(entryPath(review.entry))}#review-${review.id}">${e(review.entry.title)}</a> <span class="review-score">${review.score}/10</span></p>
      <p class="review-teaser-text">${review.spoiler ? '<span class="muted">Отзыв со спойлерами — откройте, чтобы прочитать.</span>' : e(review.body.slice(0, 220))}${!review.spoiler && review.body.length > 220 ? "…" : ""}</p>
      <p class="muted small">${author}</p>
    </div>
  </article>`;
}

// Главная энциклопедии. С 2026-11-04 на / портал студии, энциклопедия живёт на /encyclopedia и в меню не входит
export const home = catalogPage("encyclopedia", async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const [data, reviews] = await Promise.all([homeData(env), recentEntryReviews(env, null, { limit: 6 })]);
  const slides = data.hero.map(heroSlide).join("");
  const dots = data.hero.length > 1
    ? `<div class="container hero-dots" role="group" aria-label="Выбор слайда">${data.hero.map((entry, i) =>
      `<button type="button" data-slide-to="${i}" aria-label="${e(entry.title)}" aria-pressed="${i === 0}"></button>`).join("")}</div>`
    : "";
  const section = (title, eyebrow, link, items, render, id) => `
      <section class="section" aria-labelledby="${id}">
        ${sectionHeading({ eyebrow, title, id, actions: link ? `<a class="ghost-btn small-btn" href="${link}">Все →</a>` : "" })}
        ${items.length ? rail(items, render) : '<p class="muted">Пока пусто.</p>'}
      </section>`;
  const { season, year } = currentSeason();
  const body = `
    <section class="hero" aria-roledescription="карусель" aria-label="Популярное сейчас">${slides}${dots}</section>
    <div class="container">
      <form class="search-box home-search" action="/search" method="get" role="search">
        <label class="visually-hidden" for="homeSearch">Поиск по энциклопедии</label>
        <input id="homeSearch" name="q" type="search" placeholder="Найти аниме, мангу, персонажа, автора или студию…" maxlength="100" autocomplete="off">
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      <section class="section" id="forYou" aria-labelledby="forYouTitle" hidden>
        ${sectionHeading({ eyebrow: "По вашему списку и оценкам", title: "Рекомендации для вас", id: "forYouTitle" })}
        <div id="forYouBody"></div>
      </section>
      ${section("Популярное аниме", `Последние два года`, "/anime?order=popularity", data.popularAnime, (entry) => entryCard(entry), "popAnime")}
      ${section("Популярная манга", "Манга, манхва, маньхуа", "/manga?order=popularity", data.popularManga, (entry) => entryCard(entry), "popManga")}
      ${section("Сейчас выходит", seasonLabel({ season, year }), `/seasons/${seasonCode({ season, year })}`, data.ongoing, (entry) => entryCard(entry), "ongoing")}
      ${section("Скоро выйдет", "Анонсы", "/anime?status=anons", data.anons, (entry) => entryCard(entry), "anons")}
      ${section("Популярные персонажи", "Главные герои", "/characters", data.characters, (item) => personCard(item, { note: item.from }), "chars")}
      <section class="section" aria-labelledby="reviewsTitle">
        ${sectionHeading({ eyebrow: "Сообщество", title: "Последние отзывы", id: "reviewsTitle", actions: '<a class="ghost-btn small-btn" href="/community#reviews">Все отзывы →</a>' })}
        ${reviews.length ? `<div class="review-teasers">${reviews.map(reviewTeaser).join("")}</div>`
    : '<p class="muted">Отзывов пока нет. Откройте любое произведение и напишите первый.</p>'}
      </section>
    </div>`;
  const head = ogHead({
    title: "ENDEMION — энциклопедия аниме и манги",
    description: "Аниме и манга: каталог с фильтрами, персонажи, авторы, студии, сезоны и рейтинги. Личные списки, оценки и отзывы.",
    url: `${origin}/encyclopedia`, image: `${origin}/assets/og-image.png`
  }) + ld({
    "@context": "https://schema.org", "@type": "WebSite", name: "ENDEMION", url: `${origin}/encyclopedia`,
    potentialAction: { "@type": "SearchAction", target: `${origin}/search?q={search_term_string}`, "query-input": "required name=search_term_string" }
  });
  return renderPage(request, {
    title: "Энциклопедия аниме и манги",
    path: "/encyclopedia", active: "encyclopedia", body, styles: STYLES, scripts: ["ency.js"], head, cache: CACHE, mainAttrs: 'data-page="home"',
    description: "ENDEMION — энциклопедия аниме и манги: каталог с фильтрами, персонажи, авторы, студии, сезоны, рейтинги, личные списки и отзывы."
  });
});

// ==================== КАТАЛОГ ====================

/** Параметры формы каталога → параметры фильтров API. Год и сезон из формы складываются в один параметр season */
function formToFilters(kind, search) {
  const params = new URLSearchParams();
  for (const key of ["q", "status", "score", "order", "page", "rating", "studio"]) if (search.get(key)) params.set(key, search.get(key));
  const types = search.getAll("type");
  if (types.length) params.set("types", types.join(","));
  const genres = [...search.getAll("genre"), ...(search.get("genres") ? search.get("genres").split(",") : [])];
  if (genres.length) params.set("genres", genres.join(","));
  const year = search.get("year");
  const season = search.get("season");
  if (search.get("season") && parseSeasonCode(season)) params.set("season", season);
  else if (season && SEASONS[season]) params.set("season", `${season}_${year || new Date().getUTCFullYear()}`);
  else if (year) params.set("season", year);
  if (kind === "manga") params.delete("rating");
  return params;
}

function catalogFilters(kind, search, genres) {
  const types = kind === "anime" ? Object.keys(ANIME_TYPE_FILTERS).map((key) => [key, ANIME_TYPES[key]]) : Object.entries(MANGA_TYPES);
  const chosenTypes = new Set(search.getAll("type"));
  const chosenGenres = new Set([...search.getAll("genre"), ...(search.get("genres") || "").split(",")].filter(Boolean));
  const now = new Date().getUTCFullYear();
  const years = Array.from({ length: now + 2 - 1960 }, (_, i) => now + 1 - i).map((year) => [year, year]);
  const check = (name, value, label, checked) =>
    `<label class="check-chip"><input type="checkbox" name="${name}" value="${e(value)}"${checked ? " checked" : ""}><span>${e(label)}</span></label>`;
  const genreGroups = [["genre", "Жанры"], ["theme", "Темы"], ["demographic", "Аудитория"]].map(([groupKind, label]) => {
    const list = genres.filter((genre) => genre.kind === groupKind);
    return list.length ? `<p class="filter-sub">${label}</p><div class="check-chips">${list.map((genre) => check("genre", genre.id, genre.name, chosenGenres.has(String(genre.id)))).join("")}</div>` : "";
  }).join("");
  return `<form class="filters ency-filters" id="filters" method="get" action="/${kind}" aria-label="Фильтры">
      <div class="filters-head"><h2>Фильтры</h2><a class="link-btn" href="/${kind}">Сбросить</a></div>
      <div class="field"><label for="fq">Название</label>
        <input class="input" id="fq" name="q" type="search" value="${e(search.get("q") || "")}" maxlength="100" placeholder="Например, «Атака титанов»"></div>
      <div class="field"><label for="forder">Сортировка</label><select class="select" id="forder" name="order">${options(Object.entries(ORDERS), search.get("order") || "popularity")}</select></div>
      <fieldset class="field"><legend>Тип</legend><div class="check-chips">${types.map(([key, label]) => check("type", key, label, chosenTypes.has(key))).join("")}</div></fieldset>
      <div class="field"><label for="fstatus">Статус</label><select class="select" id="fstatus" name="status">${options([["", "Любой"], ...Object.entries(STATUSES[kind])], search.get("status") || "")}</select></div>
      <div class="field-row">
        <div class="field"><label for="fyear">Год</label><select class="select" id="fyear" name="year">${options([["", "Любой"], ...years], search.get("year") || "")}</select></div>
        <div class="field"><label for="fseason">Сезон</label><select class="select" id="fseason" name="season">${options([["", "Любой"], ...Object.entries(SEASONS)], SEASONS[search.get("season")] ? search.get("season") : "")}</select></div>
      </div>
      <div class="field"><label for="fscore">Оценка не ниже</label><select class="select" id="fscore" name="score">${options([["", "Любая"], ...[9, 8, 7, 6, 5].map((n) => [n, `${n}+`])], search.get("score") || "")}</select></div>
      ${kind === "anime" ? `<div class="field"><label for="frating">Возрастной рейтинг</label><select class="select" id="frating" name="rating">${options([["", "Любой"], ...AGE_RATING_FILTERS.map((key) => [key, AGE_RATINGS[key]])], search.get("rating") || "")}</select></div>` : ""}
      ${search.get("studio") ? `<input type="hidden" name="studio" value="${e(search.get("studio"))}">` : ""}
      <details class="field genre-filter"${chosenGenres.size ? " open" : ""}><summary>Жанры${chosenGenres.size ? ` · выбрано ${chosenGenres.size}` : ""}</summary>${genreGroups || '<p class="muted small">Жанры не загрузились.</p>'}</details>
      <div class="filters-actions"><button class="primary-btn" type="submit">Показать</button><button class="ghost-btn filters-close" type="button">Закрыть</button></div>
    </form>`;
}

function catalogHandler(kind) {
  return catalogPage(kind, async ({ request, env }) => {
    const url = new URL(request.url);
    const search = url.searchParams;
    const { filters, problem } = parseCatalogFilters(kind, formToFilters(kind, search));
    const [genres, result] = await Promise.all([
      getGenres(env, kind).catch(() => []),
      problem ? Promise.resolve({ items: [], hasMore: false }) : listEntries(env, kind, filters)
    ]);
    const page = filters?.page || 1;
    const filtered = [...search.keys()].some((key) => key !== "page" && key !== "order" && search.get(key));
    const label = KIND_LABELS[kind];
    const title = filtered ? `${label}: результаты поиска` : `${label} — каталог`;
    const body = `
    <div class="container page" >
      <div class="page-head"><div>
        <div class="eyebrow">Каталог</div>
        <h1>${e(label)}</h1>
        <p class="section-text">${kind === "anime"
    ? "TV-сериалы, фильмы, OVA, ONA и спешлы. Фильтры по жанру, году, сезону, типу, статусу и оценке."
    : "Манга, манхва, маньхуа и ранобэ. Фильтры по жанру, году, типу, статусу и оценке."}</p>
      </div><button class="ghost-btn filters-open" type="button" aria-controls="filters" aria-expanded="false">Фильтры</button></div>
      <div class="catalog-layout">
        ${catalogFilters(kind, search, genres)}
        <section aria-label="Результаты">
          ${problem ? `<div class="state state-error" role="alert"><strong>${e(problem)}</strong><a class="ghost-btn" href="/${kind}">Сбросить фильтры</a></div>`
    : result.items.length ? `<div class="e-grid">${result.items.map((entry, i) => entryCard(entry, { lazy: i >= 8 })).join("")}</div>`
      : `<div class="state"><span class="state-icon">🔭</span><strong>Ничего не найдено</strong><p>Попробуйте убрать часть фильтров.</p><a class="ghost-btn" href="/${kind}">Сбросить фильтры</a></div>`}
          ${pager(url, page, result.hasMore)}
        </section>
      </div>
    </div>`;
    // Страницы с фильтрами не индексируются: в поиске нужен один адрес каталога
    const canonicalPath = filtered ? null : `/${kind}${page > 1 ? `?page=${page}` : ""}`;
    return renderPage(request, {
      title, path: canonicalPath, active: kind, body, styles: STYLES, scripts: ["ency.js"], noindex: filtered, cache: CACHE,
      mainAttrs: 'data-page="catalog"',
      description: kind === "anime"
        ? "Каталог аниме: поиск по названию и фильтры по жанрам, году, сезону, типу, статусу и рейтингу."
        : "Каталог манги, манхвы и маньхуа: поиск по названию и фильтры по жанрам, году, типу, статусу и рейтингу."
    });
  });
}

export const animeCatalog = catalogHandler("anime");
export const mangaCatalog = catalogHandler("manga");

// ==================== ПРОИЗВЕДЕНИЕ ====================

const DIRECTOR_ROLES = ["Режиссёр", "Главный режиссёр"];
const AUTHOR_ROLES = ["Автор оригинала", "Сюжет и иллюстрации", "Сюжет", "Автор", "Рисовка"];

function staffWith(entry, roles) {
  return entry.staff.filter((person) => person.roles.some((role) => roles.includes(role)));
}

function entryStructuredData(entry, url, score) {
  const isMovie = entry.kind === "anime" && entry.type === "movie";
  const type = entry.kind === "manga" ? "Book" : isMovie ? "Movie" : "TVSeries";
  const authors = staffWith(entry, AUTHOR_ROLES).map((person) => ({ "@type": "Person", name: person.name }));
  const directors = staffWith(entry, DIRECTOR_ROLES).map((person) => ({ "@type": "Person", name: person.name }));
  return {
    "@context": "https://schema.org",
    "@type": type,
    name: entry.title,
    alternateName: [entry.titleEn, entry.english, entry.japanese].filter((name) => name && name !== entry.title),
    url,
    description: bbcodeToText(entry.description, 500) || undefined,
    image: entry.poster?.medium2x || entry.poster?.medium || undefined,
    genre: entry.genres.map((genre) => genre.name),
    inLanguage: "ja",
    ...(entry.airedOn?.year ? { datePublished: isoDate(entry.airedOn) } : {}),
    ...(authors.length ? { author: authors } : {}),
    ...(directors.length ? { director: directors } : {}),
    ...(entry.kind === "anime" && !isMovie && entry.units ? { numberOfEpisodes: entry.units } : {}),
    ...(entry.studios?.length ? { productionCompany: entry.studios.map((studio) => ({ "@type": "Organization", name: studio.name })) } : {}),
    ...(entry.ageRating ? { contentRating: AGE_RATINGS[entry.ageRating] } : {}),
    // Только настоящие оценки пользователей Endemion: без оценок блока нет
    ...(score ? { aggregateRating: { "@type": "AggregateRating", ratingValue: score.average, ratingCount: score.votes, bestRating: 10, worstRating: 1 } } : {})
  };
}

function entryPage(kind) {
  return catalogPage(kind, async ({ request, env, params }) => {
    const id = parseSlugId(params.slug);
    if (!id) return notFound(env, request);
    const [entry, settings] = await Promise.all([getEntry(env, kind, id), getSettings(env)]);
    if (!entry || isHidden(entry, settings)) return notFound(env, request);
    const path = entryPath(entry);
    // Один адрес у страницы: старый или неполный адрес ведёт на канонический
    if (new URL(request.url).pathname !== path) return redirect(path);

    const origin = new URL(request.url).origin;
    const url = `${origin}${path}`;
    const score = await endemionScore(env, kind, id);
    const label = KIND_LABELS[kind];
    const typeName = typeLabel(kind, entry.type);
    const crumbs = breadcrumbs(origin, [["Главная", "/"], [label, `/${kind}`], [entry.title, path]]);
    const summary = bbcodeToText(entry.description, 160);
    const description = `${entry.title}${entry.titleEn && entry.titleEn !== entry.title ? ` (${entry.titleEn})` : ""} — ${typeName.toLowerCase() || label.toLowerCase()}${entry.year ? `, ${entry.year}` : ""}. ${summary || "Информация, персонажи, отзывы и оценки на ENDEMION."}`;
    const altNames = [...new Set([entry.titleEn, entry.english, entry.japanese].filter((name) => name && name !== entry.title))];

    const directors = staffWith(entry, DIRECTOR_ROLES);
    const authors = staffWith(entry, AUTHOR_ROLES);
    const facts = [
      fact("Тип", e(typeName)),
      fact(kind === "anime" ? "Эпизоды" : "Главы", e(kind === "anime"
        ? (entry.status === "ongoing" ? `${entry.unitsAired} из ${entry.units || "?"}` : entry.units || "")
        : entry.units || (entry.status === "ongoing" ? "выходит" : ""))),
      kind === "manga" ? fact("Тома", e(entry.volumes || "")) : "",
      kind === "anime" ? fact("Длительность эпизода", entry.duration ? `${entry.duration} мин.` : "") : "",
      fact("Статус", e(statusLabel(kind, entry.status))),
      fact(kind === "anime" ? "Выход" : "Публикация", e([partialDate(entry.airedOn), partialDate(entry.releasedOn)].filter(Boolean).join(" — "))),
      kind === "anime" && entry.season && parseSeasonCode(entry.season)
        ? fact("Сезон", `<a href="/seasons/${e(entry.season)}">${e(seasonLabel(parseSeasonCode(entry.season)))}</a>`) : "",
      kind === "anime" && entry.nextEpisodeAt
        ? fact("Следующий эпизод", `<time datetime="${e(entry.nextEpisodeAt)}" data-local-time>${e(entry.nextEpisodeAt.slice(0, 10))}</time>`) : "",
      fact("Студия", entry.studios?.map(studioLink).join(", ")),
      fact(directors.length > 1 ? "Режиссёры" : "Режиссёр", directors.slice(0, 3).map(personLink).join(", ")),
      fact(authors.length > 1 ? "Авторы" : "Автор", authors.slice(0, 3).map(personLink).join(", ")),
      kind === "manga" ? fact("Издатель", e(entry.publishers?.map((publisher) => publisher.name).join(", ") || "")) : "",
      fact("Возрастной рейтинг", e(ageLabel(entry.ageRating)))
    ].join("");

    const main = entry.characters.filter((item) => item.role === "main");
    const supporting = entry.characters.filter((item) => item.role !== "main");
    const relatedHtml = entry.related.length ? `<section class="section" aria-labelledby="relatedTitle">
        <h2 id="relatedTitle">Связанные произведения</h2>
        <div class="related-grid">${entry.related.map((item) => `<a class="related-card" href="${e(entryPath(item.entry))}">
          ${posterImg(item.entry.poster, "", { sizes: "56px" })}
          <span><small>${e(item.relation)} · ${e([typeLabel(item.entry.kind, item.entry.type), item.entry.year].filter(Boolean).join(", "))}</small><strong>${e(item.entry.title)}</strong></span></a>`).join("")}</div>
      </section>` : "";

    const body = `
    <div class="container entry-page" data-kind="${kind}" data-id="${entry.id}" data-units="${entry.units || 0}" data-units-aired="${entry.unitsAired || 0}"
      data-status="${e(entry.status)}" data-title="${e(entry.title)}" id="entryRoot">
      ${crumbs.nav}
      <section class="entry-hero">
        <div class="entry-poster">${posterImg(entry.poster, `Постер «${entry.title}»`, { lazy: false, priority: true, sizes: "(max-width: 680px) 60vw, 300px" })}</div>
        <div class="entry-info">
          <div class="eyebrow">${e([label, typeName, entry.year].filter(Boolean).join(" · "))}</div>
          <h1 class="entry-title">${e(entry.title)}</h1>
          ${altNames.length ? `<p class="entry-alt">${altNames.map((name) => `<span>${e(name)}</span>`).join("")}</p>` : ""}
          <div class="entry-scores">
            <div class="score-box"><strong>${entry.score ? `★ ${entry.score.toFixed(2)}` : "—"}</strong><span>Shikimori</span></div>
            <div class="score-box" id="endemionScore"><strong>${score ? `★ ${score.average.toFixed(2)}` : "—"}</strong><span>${score ? `ENDEMION · ${score.votes}` : "ENDEMION · нет оценок"}</span></div>
            ${entry.status ? `<div class="score-box"><strong class="status-${e(entry.status)}">${e(statusLabel(kind, entry.status))}</strong><span>статус</span></div>` : ""}
            ${entry.ageRating ? `<div class="score-box"><strong>${e(ageLabel(entry.ageRating))}</strong><span>возраст</span></div>` : ""}
          </div>
          <div class="tags">${entry.genres.map((genre) => genreLink(kind, genre)).join("")}</div>
          ${summary ? `<p class="entry-lead">${e(bbcodeToText(entry.description, 320))}</p>` : ""}
          <div class="entry-actions" id="entryActions" aria-live="polite">
            <a class="primary-btn" href="/auth?next=${e(encodeURIComponent(path))}">＋ Добавить в список</a>
            <a class="ghost-btn" href="#reviews">Отзывы</a>
          </div>
          <div class="entry-actions ux-hero">
            <a class="ux-hero-btn" href="#universe" data-universe-open>✦ Путешествие по вселенной</a>
          </div>
        </div>
      </section>

      <div class="entry-layout">
        <div class="entry-main">
          ${entry.description ? `<section class="section prose" aria-labelledby="aboutTitle"><h2 id="aboutTitle">Описание</h2>${bbcodeToHtml(entry.description)}</section>` : ""}
          <section class="section ux" id="universe" aria-labelledby="universeTitle">
            <div class="section-head"><div>
              <h2 id="universeTitle">Universe Explorer</h2>
              <p class="section-text">Карта связей вселенной: персонажи, создатели, студии и связанные произведения из каталога,
                организации, локации и события с указанием источника. Спойлеры скрыты по вашему прогрессу в списке.</p>
            </div></div>
            <div id="universeRoot" data-kind="${kind}" data-id="${entry.id}">
              <button class="primary-btn" type="button" data-universe-open>Открыть карту вселенной</button>
              <noscript><p class="muted">Карта вселенной работает со включённым JavaScript.</p></noscript>
            </div>
          </section>
          ${main.length || supporting.length ? `<section class="section" aria-labelledby="charsTitle">
            <h2 id="charsTitle">Персонажи</h2>
            ${main.length ? `<p class="filter-sub">Главные роли</p><div class="p-grid">${main.map((item) => personCard(item, { note: "Главная роль" })).join("")}</div>` : ""}
            ${supporting.length ? `<details class="more-block"${main.length ? "" : " open"}><summary>Второстепенные роли · ${supporting.length}</summary><div class="p-grid">${supporting.map((item) => personCard(item, { note: "Второстепенная роль" })).join("")}</div></details>` : ""}
          </section>` : ""}
          ${entry.staff.length ? `<section class="section" aria-labelledby="staffTitle"><h2 id="staffTitle">Создатели</h2>
            <div class="p-grid">${entry.staff.map((person) => personCard(person, { type: "person", note: person.roles.join(", ") })).join("")}</div></section>` : ""}
          ${relatedHtml}
          <section class="section" id="reviews" aria-labelledby="reviewsTitle">
            <h2 id="reviewsTitle">Отзывы</h2>
            <div id="reviewsBody"><noscript><p class="muted">Отзывы загружаются скриптом.</p></noscript></div>
          </section>
          <section class="section" aria-labelledby="commentsTitle">
            <h2 id="commentsTitle">Обсуждение</h2>
            <div id="commentsBody"></div>
          </section>
        </div>
        <aside class="entry-side">
          <section class="panel"><h2>Информация</h2><dl class="facts">${facts}</dl></section>
          ${entry.links.length ? `<section class="panel"><h2>Ссылки</h2><ul class="link-list">${entry.links.map((link) =>
    `<li><a href="${e(link.url)}" rel="noopener nofollow" target="_blank">${e(link.label)} ↗</a></li>`).join("")}</ul></section>` : ""}
          ${entry.sourceUrl ? `<p class="muted small">Источник данных: <a href="${e(entry.sourceUrl)}" rel="noopener nofollow" target="_blank">Shikimori</a></p>` : ""}
        </aside>
      </div>
    </div>`;
    const head = ogHead({
      type: kind === "manga" ? "book" : entry.type === "movie" ? "video.movie" : "video.tv_show",
      title: `${entry.title} — ${typeName || label}`, description, url,
      image: entry.poster?.medium2x || entry.poster?.medium || `${origin}/assets/og-image.png`, imageAlt: `Постер «${entry.title}»`
    }) + ld(entryStructuredData(entry, url, score)) + crumbs.data;
    return renderPage(request, {
      title: `${entry.title}${entry.year ? ` (${entry.year})` : ""} — ${typeName || label}`, description: description.slice(0, 300), path,
      active: kind, body, styles: STYLES, scripts: ["entry.js"], head, cache: CACHE, mainAttrs: 'data-page="entry"'
    });
  });
}

export const animePage = entryPage("anime");
export const mangaPage = entryPage("manga");

// ==================== ПЕРСОНАЖИ ====================

export const characters = catalogPage("characters", async ({ request, env }) => {
  const url = new URL(request.url);
  const query = cleanLine(url.searchParams.get("q") || "").slice(0, 100);
  const from = url.searchParams.get("from") === "manga" ? "manga" : "anime";
  const page = pageNumber(url.searchParams);
  const result = query
    ? await listCharacters(env, { search: query, page, limit: 24 })
    : { items: await popularCharacters(env, from), hasMore: false };
  const tabs = query ? "" : `<div class="tabs-bar" role="tablist" aria-label="Откуда герои">
      <a role="tab" href="/characters" aria-selected="${from === "anime"}">Из аниме</a>
      <a role="tab" href="/characters?from=manga" aria-selected="${from === "manga"}">Из манги</a></div>`;
  const body = `
    <div class="container page">
      <div class="page-head"><div>
        <div class="eyebrow">Энциклопедия</div><h1>Персонажи</h1>
        <p class="section-text">${query ? `Результаты по запросу «${e(query)}».` : "Главные герои самых популярных произведений. Найдите любого персонажа по имени."}</p>
      </div></div>
      <form class="search-box" action="/characters" method="get" role="search">
        <label class="visually-hidden" for="charQ">Имя персонажа</label>
        <input id="charQ" name="q" type="search" value="${e(query)}" placeholder="Имя персонажа на русском, английском или японском" maxlength="100">
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      ${tabs}
      <div class="section">${result.items.length
    ? `<div class="p-grid is-wide">${result.items.map((item, i) => personCard(item, { note: item.from || "", lazy: i >= 12 })).join("")}</div>`
    : `<div class="state"><span class="state-icon">🔭</span><strong>Никого не нашли</strong><p>Проверьте написание или попробуйте английское имя.</p></div>`}
        ${pager(url, page, result.hasMore)}</div>
    </div>`;
  return renderPage(request, {
    title: query ? `Персонажи: «${query}»` : "Персонажи аниме и манги", path: query ? null : "/characters", noindex: Boolean(query),
    active: "characters", body, styles: STYLES, scripts: ["ency.js"], cache: CACHE,
    description: "Персонажи аниме и манги: биографии, произведения, роли и сэйю."
  });
});

export const characterPage = catalogPage("characters", async ({ request, env, params }) => {
  const id = parseSlugId(params.slug);
  const character = id ? await getCharacter(env, id) : null;
  if (!character) return notFound(env, request);
  const path = characterPath(character);
  if (new URL(request.url).pathname !== path) return redirect(path);
  const origin = new URL(request.url).origin;
  const settings = await getSettings(env);
  const works = character.works.filter((work) => !isHidden(work.entry, settings));

  // Связанные персонажи: другие главные герои первого произведения, где персонаж в главной роли
  const home = works.find((work) => work.role === "Главная роль") || works[0];
  let companions = [];
  if (home) {
    try {
      const entry = await getEntry(env, home.entry.kind, home.entry.id);
      companions = (entry?.characters || []).filter((item) => item.id !== character.id).slice(0, 12);
    } catch {}
  }
  const names = [...new Set([character.nameEn, character.japanese, ...character.altNames].filter((name) => name && name !== character.name))];
  const crumbs = breadcrumbs(origin, [["Главная", "/"], ["Персонажи", "/characters"], [character.name, path]]);
  const bio = bbcodeToText(character.description, 200);
  const body = `
    <div class="container entry-page" id="personRoot" data-type="character" data-id="${character.id}" data-title="${e(character.name)}">
      ${crumbs.nav}
      <section class="entry-hero is-person">
        <div class="entry-poster is-portrait">${portraitImg(character.image, `Изображение: ${character.name}`, { lazy: false })}</div>
        <div class="entry-info">
          <div class="eyebrow">Персонаж</div>
          <h1 class="entry-title">${e(character.name)}</h1>
          ${names.length ? `<p class="entry-alt">${names.map((name) => `<span>${e(name)}</span>`).join("")}</p>` : ""}
          <div class="entry-actions" id="entryActions"></div>
          ${character.description ? `<div class="prose">${bbcodeToHtml(character.description)}</div>` : '<p class="muted">Биографии пока нет.</p>'}
        </div>
      </section>
      ${works.length ? `<section class="section" aria-labelledby="worksTitle"><h2 id="worksTitle">Произведения</h2>
        <div class="e-grid">${works.map((work, i) => entryCard(work.entry, { lazy: i >= 6, extra: `<p class="e-role">${e(work.role)}</p>` })).join("")}</div></section>` : ""}
      ${character.seyu.length ? `<section class="section" aria-labelledby="seyuTitle"><h2 id="seyuTitle">Сэйю</h2>
        <div class="p-grid">${character.seyu.map((person) => personCard(person, { type: "person" })).join("")}</div></section>` : ""}
      ${companions.length ? `<section class="section" aria-labelledby="companionsTitle"><h2 id="companionsTitle">Связанные персонажи</h2>
        <p class="muted small">Из «${e(home.entry.title)}»</p>
        <div class="p-grid">${companions.map((item) => personCard(item, { note: item.role === "main" ? "Главная роль" : "Второстепенная роль" })).join("")}</div></section>` : ""}
      <section class="section" aria-labelledby="commentsTitle"><h2 id="commentsTitle">Обсуждение</h2><div id="commentsBody"></div></section>
    </div>`;
  const head = ogHead({
    type: "profile", title: `${character.name} — персонаж`, description: bio || `${character.name}: произведения, роли и сэйю.`,
    url: `${origin}${path}`, image: character.image?.medium || `${origin}/assets/og-image.png`
  }) + crumbs.data;
  return renderPage(request, {
    title: `${character.name} — персонаж${home ? ` «${home.entry.title}»` : ""}`, path, active: "characters", body, styles: STYLES,
    scripts: ["entry.js"], head, cache: CACHE, mainAttrs: 'data-page="character"',
    description: (bio || `${character.name}: биография, произведения, роли и сэйю.`).slice(0, 300)
  });
});

// ==================== ЛЮДИ ====================

const PEOPLE_ROLES = { "": "Все", seyu: "Сэйю", mangaka: "Мангаки", producer: "Режиссёры и продюсеры" };

export const people = catalogPage("people", async ({ request, env }) => {
  const url = new URL(request.url);
  const query = cleanLine(url.searchParams.get("q") || "").slice(0, 100);
  const role = PEOPLE_ROLES[url.searchParams.get("role") || ""] ? url.searchParams.get("role") || "" : "";
  const page = pageNumber(url.searchParams);
  const result = await listPeople(env, { search: query, role, page, limit: 24 });
  const roleLabels = { seyu: "Сэйю", mangaka: "Мангака", producer: "Режиссёр, продюсер" };
  const tabs = `<div class="tabs-bar" role="tablist" aria-label="Роль">${Object.entries(PEOPLE_ROLES).map(([key, label]) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (key) params.set("role", key);
    return `<a role="tab" href="/people${params.size ? `?${params}` : ""}" aria-selected="${key === role}">${e(label)}</a>`;
  }).join("")}</div>`;
  const body = `
    <div class="container page">
      <div class="page-head"><div><div class="eyebrow">Энциклопедия</div><h1>Люди</h1>
        <p class="section-text">Авторы манги, режиссёры, сценаристы, композиторы и актёры озвучивания.</p></div></div>
      <form class="search-box" action="/people" method="get" role="search">
        <label class="visually-hidden" for="peopleQ">Имя</label>
        <input id="peopleQ" name="q" type="search" value="${e(query)}" placeholder="Имя автора, режиссёра или сэйю" maxlength="100">
        ${role ? `<input type="hidden" name="role" value="${e(role)}">` : ""}
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      ${tabs}
      <div class="section">${result.items.length
    ? `<div class="p-grid is-wide">${result.items.map((person, i) => personCard(person, { type: "person", note: person.roles.map((key) => roleLabels[key]).join(", "), lazy: i >= 12 })).join("")}</div>`
    : '<div class="state"><span class="state-icon">🔭</span><strong>Никого не нашли</strong></div>'}
        ${pager(url, page, result.hasMore)}</div>
    </div>`;
  const indexable = !query && !role && page === 1;
  return renderPage(request, {
    title: query ? `Люди: «${query}»` : "Люди аниме и манги", path: indexable ? "/people" : null, noindex: !indexable, active: "people", body,
    styles: STYLES, scripts: ["ency.js"], cache: CACHE, description: "Авторы манги, режиссёры, сценаристы и сэйю: биографии и работы."
  });
});

export const personPage = catalogPage("people", async ({ request, env, params }) => {
  const id = parseSlugId(params.slug);
  const person = id ? await getPerson(env, id) : null;
  if (!person) return notFound(env, request);
  const path = personPath(person);
  if (new URL(request.url).pathname !== path) return redirect(path);
  const origin = new URL(request.url).origin;
  const settings = await getSettings(env);
  const works = person.works.filter((work) => !isHidden(work.entry, settings));
  const names = [...new Set([person.nameEn, person.japanese].filter((name) => name && name !== person.name))];
  const crumbs = breadcrumbs(origin, [["Главная", "/"], ["Люди", "/people"], [person.name, path]]);
  const facts = [
    fact("Род деятельности", e(person.jobTitle)),
    fact("Дата рождения", e(partialDate(person.birthOn))),
    fact("Дата смерти", e(partialDate(person.deceasedOn))),
    fact("Сайт", person.website ? `<a href="${e(person.website)}" rel="noopener nofollow" target="_blank">${e(person.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""),
    fact("Чаще всего", e(person.roleGroups.slice(0, 4).map((group) => `${group.role} (${group.count})`).join(", ")))
  ].join("");
  const body = `
    <div class="container entry-page" id="personRoot" data-type="person" data-id="${person.id}" data-title="${e(person.name)}">
      ${crumbs.nav}
      <section class="entry-hero is-person">
        <div class="entry-poster is-portrait">${portraitImg(person.image, `Фото: ${person.name}`, { lazy: false })}</div>
        <div class="entry-info">
          <div class="eyebrow">${e(person.jobTitle || "Человек")}</div>
          <h1 class="entry-title">${e(person.name)}</h1>
          ${names.length ? `<p class="entry-alt">${names.map((name) => `<span>${e(name)}</span>`).join("")}</p>` : ""}
          <div class="entry-actions" id="entryActions"></div>
          ${facts ? `<dl class="facts is-inline">${facts}</dl>` : ""}
        </div>
      </section>
      ${works.length ? `<section class="section" aria-labelledby="worksTitle"><h2 id="worksTitle">Работы · ${works.length}</h2>
        <div class="e-grid">${works.map((work, i) => entryCard(work.entry, { lazy: i >= 6, extra: `<p class="e-role">${e(work.role)}</p>` })).join("")}</div></section>` : ""}
      ${person.voiced.length ? `<section class="section" aria-labelledby="voicedTitle"><h2 id="voicedTitle">Озвученные персонажи · ${person.voiced.length}</h2>
        <div class="p-grid">${person.voiced.map((item, i) => personCard(item.character, { note: item.entry?.title || "", lazy: i >= 12 })).join("")}</div></section>` : ""}
      <section class="section" aria-labelledby="commentsTitle"><h2 id="commentsTitle">Обсуждение</h2><div id="commentsBody"></div></section>
    </div>`;
  const description = `${person.name}${person.jobTitle ? ` — ${person.jobTitle.toLowerCase()}` : ""}. Работы в аниме и манге${person.voiced.length ? ", озвученные персонажи" : ""}.`;
  const head = ogHead({ type: "profile", title: person.name, description, url: `${origin}${path}`, image: person.image?.medium || `${origin}/assets/og-image.png` })
    + ld({
      "@context": "https://schema.org", "@type": "Person", name: person.name, alternateName: names, url: `${origin}${path}`,
      ...(person.image?.medium ? { image: person.image.medium } : {}),
      ...(person.jobTitle ? { jobTitle: person.jobTitle } : {}),
      ...(person.birthOn?.day ? { birthDate: isoDate(person.birthOn) } : {})
    }) + crumbs.data;
  return renderPage(request, {
    title: `${person.name}${person.jobTitle ? ` — ${person.jobTitle}` : ""}`, path, active: "people", body, styles: STYLES,
    scripts: ["entry.js"], head, cache: CACHE, description, mainAttrs: 'data-page="person"'
  });
});

// ==================== СТУДИИ ====================

export const studios = catalogPage("studios", async ({ request, env }) => {
  const url = new URL(request.url);
  const query = cleanLine(url.searchParams.get("q") || "").slice(0, 100).toLowerCase();
  const all = await listStudios(env);
  const list = (query ? all.filter((studio) => studio.name.toLowerCase().includes(query)) : all.filter((studio) => studio.real || studio.image))
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)) || a.name.localeCompare(b.name))
    .slice(0, 240);
  const body = `
    <div class="container page">
      <div class="page-head"><div><div class="eyebrow">Энциклопедия</div><h1>Студии</h1>
        <p class="section-text">Анимационные студии и их работы. ${query ? `Найдено: ${list.length}.` : "Показаны основные студии — остальные находятся поиском."}</p></div></div>
      <form class="search-box" action="/studios" method="get" role="search">
        <label class="visually-hidden" for="studioQ">Название студии</label>
        <input id="studioQ" name="q" type="search" value="${e(query)}" placeholder="Например, Kyoto Animation" maxlength="100">
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      <div class="section">${list.length ? `<div class="studio-grid">${list.map((studio, i) => `<a class="studio-card" href="${e(studioPath(studio))}">
        ${studio.image ? `<img src="${e(studio.image)}" alt="" width="120" height="60" decoding="async" referrerpolicy="no-referrer"${i >= 24 ? ' loading="lazy"' : ""}>` : '<span class="studio-mark" aria-hidden="true">✦</span>'}
        <strong>${e(studio.name)}</strong></a>`).join("")}</div>`
    : '<div class="state"><span class="state-icon">🔭</span><strong>Студия не найдена</strong></div>'}</div>
    </div>`;
  return renderPage(request, {
    title: query ? `Студии: «${query}»` : "Анимационные студии", path: query ? null : "/studios", noindex: Boolean(query), active: "studios", body,
    styles: STYLES, scripts: ["ency.js"], cache: CACHE, description: "Анимационные студии Японии и мира: список и работы каждой студии."
  });
});

export const studioPage = catalogPage("studios", async ({ request, env, params }) => {
  const id = parseSlugId(params.slug);
  const studio = id ? await getStudio(env, id) : null;
  if (!studio) return notFound(env, request);
  const path = studioPath(studio);
  const url = new URL(request.url);
  if (url.pathname !== path) return redirect(path);
  const page = pageNumber(url.searchParams);
  const order = ORDERS[url.searchParams.get("order")] ? url.searchParams.get("order") : "popularity";
  const result = await listEntries(env, "anime", { page, limit: 24, order, studio: id });
  const origin = url.origin;
  const crumbs = breadcrumbs(origin, [["Главная", "/"], ["Студии", "/studios"], [studio.name, path]]);
  const sorts = Object.entries(ORDERS).map(([key, label]) =>
    `<a role="tab" href="${path}${key === "popularity" ? "" : `?order=${key}`}" aria-selected="${key === order}">${e(label)}</a>`).join("");
  const body = `
    <div class="container page">
      ${crumbs.nav}
      <div class="page-head studio-head">
        ${studio.image ? `<img src="${e(studio.image)}" alt="" width="160" height="80" referrerpolicy="no-referrer">` : ""}
        <div><div class="eyebrow">Студия</div><h1>${e(studio.name)}</h1></div>
      </div>
      <div class="tabs-bar" role="tablist" aria-label="Сортировка">${sorts}</div>
      ${result.items.length ? `<div class="e-grid">${result.items.map((entry, i) => entryCard(entry, { lazy: i >= 8 })).join("")}</div>`
    : '<p class="muted">Работ студии в каталоге нет.</p>'}
      ${pager(url, page, result.hasMore)}
    </div>`;
  const head = ogHead({ title: `${studio.name} — аниме студии`, description: `Аниме студии ${studio.name}.`, url: `${origin}${path}`, image: studio.image || `${origin}/assets/og-image.png` })
    + ld({ "@context": "https://schema.org", "@type": "Organization", name: studio.name, url: `${origin}${path}`, ...(studio.image ? { logo: studio.image } : {}) })
    + crumbs.data;
  return renderPage(request, {
    title: `${studio.name} — аниме студии`, path: page === 1 && order === "popularity" ? path : null, noindex: page > 1 || order !== "popularity",
    active: "studios", body, styles: STYLES, scripts: ["ency.js"], head, cache: CACHE, description: `Все аниме студии ${studio.name}: сериалы, фильмы и OVA.`
  });
});

// ==================== СЕЗОНЫ ====================

export const seasons = catalogPage("seasons", async ({ request, env, params }) => {
  const url = new URL(request.url);
  const chosen = params.code ? parseSeasonCode(params.code) : currentSeason();
  if (!chosen) return notFound(env, request);
  const code = seasonCode(chosen);
  const typeKey = ANIME_TYPE_FILTERS[url.searchParams.get("type")] ? url.searchParams.get("type") : "";
  const page = pageNumber(url.searchParams);
  const result = await listEntries(env, "anime", {
    page, limit: 36, order: "popularity", season: code, types: typeKey ? ANIME_TYPE_FILTERS[typeKey] : []
  });
  const near = [-2, -1, 0, 1, 2].map((step) => shiftSeason(chosen, step));
  const nav = `<nav class="season-nav" aria-label="Сезоны">${near.map((item) => {
    const itemCode = seasonCode(item);
    return `<a class="chip" href="/seasons/${itemCode}"${itemCode === code ? ' aria-current="page"' : ""}>${e(seasonLabel(item))}</a>`;
  }).join("")}</nav>`;
  const types = [["", "Все"], ...Object.keys(ANIME_TYPE_FILTERS).map((key) => [key, ANIME_TYPES[key]])].map(([key, label]) =>
    `<a role="tab" href="/seasons/${code}${key ? `?type=${key}` : ""}" aria-selected="${key === typeKey}">${e(label)}</a>`).join("");
  const label = seasonLabel(chosen);
  const body = `
    <div class="container page">
      <div class="page-head"><div><div class="eyebrow">Сезоны</div><h1>Аниме: ${e(label)}</h1>
        <p class="section-text">Всё, что вышло или выходит в этом сезоне, по популярности.</p></div></div>
      ${nav}
      <div class="tabs-bar" role="tablist" aria-label="Тип">${types}</div>
      ${result.items.length ? `<div class="e-grid">${result.items.map((entry, i) => entryCard(entry, { lazy: i >= 8 })).join("")}</div>`
    : '<div class="state"><span class="state-icon">📅</span><strong>Пока пусто</strong><p>Анонсы этого сезона ещё не появились.</p></div>'}
      ${pager(url, page, result.hasMore)}
    </div>`;
  const path = `/seasons/${code}`;
  return renderPage(request, {
    title: `Аниме сезона ${label}`, path: !typeKey && page === 1 ? path : null, noindex: Boolean(typeKey) || page > 1, active: "seasons", body,
    styles: STYLES, scripts: ["ency.js"], cache: CACHE, description: `Аниме сезона ${label}: сериалы, фильмы, ONA и OVA по популярности.`
  });
});

// ==================== РЕЙТИНГИ ====================

export const rankingsPage = catalogPage("rankings", async ({ request, env }) => {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "manga" ? "manga" : "anime";
  const source = url.searchParams.get("source") === "endemion" ? "endemion" : "world";
  const page = Math.min(4, pageNumber(url.searchParams));
  let items;
  let hasMore = false;
  if (source === "endemion") {
    items = await endemionTop(env, kind, 100);
  } else {
    const result = await listEntries(env, kind, { page, limit: 50, order: "ranked" });
    items = result.items;
    hasMore = result.hasMore && page < 4;
  }
  const tab = (k, s, label) => `<a role="tab" href="/rankings?kind=${k}${s === "endemion" ? "&source=endemion" : ""}" aria-selected="${k === kind && s === source}">${e(label)}</a>`;
  const start = source === "world" ? (page - 1) * 50 : 0;
  const rows = items.map((entry, i) => `<li class="rank-row">
      <span class="rank-place">${start + i + 1}</span>
      <a class="rank-poster" href="${e(entryPath(entry))}" tabindex="-1" aria-hidden="true">${posterImg(entry.poster, "", { sizes: "56px", lazy: i >= 10 })}</a>
      <div class="rank-info"><a href="${e(entryPath(entry))}"><strong>${e(entry.title)}</strong></a>
        <small>${e([typeLabel(entry.kind, entry.type), entry.year, unitsText(entry)].filter(Boolean).join(" · "))}</small></div>
      <span class="rank-score">${source === "endemion"
    ? `★ ${entry.endemion.average.toFixed(2)}<small>${entry.endemion.votes} оценок</small>`
    : entry.score ? `★ ${entry.score.toFixed(2)}` : "—"}</span>
    </li>`).join("");
  const body = `
    <div class="container page">
      <div class="page-head"><div><div class="eyebrow">Рейтинги</div><h1>Лучшее ${kind === "anime" ? "аниме" : "манга"}</h1>
        <p class="section-text">${source === "endemion"
    ? "По оценкам пользователей ENDEMION. В рейтинг попадают произведения хотя бы с двумя оценками; пока оценок мало, место ближе к средней оценке 7."
    : "По средней оценке зрителей и читателей Shikimori."}</p></div></div>
      <div class="tabs-bar" role="tablist" aria-label="Рейтинг">
        ${tab("anime", "world", "Аниме · Shikimori")}${tab("manga", "world", "Манга · Shikimori")}${tab("anime", "endemion", "Аниме · ENDEMION")}${tab("manga", "endemion", "Манга · ENDEMION")}
      </div>
      ${items.length ? `<ol class="rank-list">${rows}</ol>`
    : '<div class="state"><span class="state-icon">★</span><strong>Оценок пока мало</strong><p>Рейтинг появится, когда пользователи оценят хотя бы несколько произведений.</p></div>'}
      ${source === "world" ? pager(url, page, hasMore) : ""}
    </div>`;
  const canonical = source === "world" && page === 1 ? `/rankings${kind === "manga" ? "?kind=manga" : ""}` : null;
  return renderPage(request, {
    title: `Рейтинг ${kind === "anime" ? "аниме" : "манги"}${source === "endemion" ? " по оценкам ENDEMION" : ""}`, path: canonical, noindex: !canonical,
    active: "rankings", body, styles: STYLES, scripts: ["ency.js"], cache: source === "endemion" ? "no-cache" : CACHE,
    description: `Топ ${kind === "anime" ? "аниме" : "манги"} по оценкам зрителей и читателей.`
  });
});

// ==================== ПОИСК ====================

export const searchPage = catalogPage("search", async ({ request, env }) => {
  const query = cleanLine(new URL(request.url).searchParams.get("q") || "").slice(0, 100);
  let content = '<p class="muted">Введите название произведения, имя персонажа, автора или студию.</p>';
  if ([...query].length >= 2) {
    const result = await searchAll(env, query);
    const block = (title, items, render, more) => items.length ? `<section class="section"><div class="section-head"><h2>${e(title)}</h2>${more ? `<a class="ghost-btn small-btn" href="${e(more)}">Все →</a>` : ""}</div>${render(items)}</section>` : "";
    const q = encodeURIComponent(query);
    const sections = [
      block("Аниме", result.anime, (items) => grid(items, (entry) => entryCard(entry)), `/anime?q=${q}`),
      block("Манга", result.manga, (items) => grid(items, (entry) => entryCard(entry)), `/manga?q=${q}`),
      block("Персонажи", result.characters, (items) => `<div class="p-grid">${items.map((item) => personCard(item)).join("")}</div>`, `/characters?q=${q}`),
      block("Люди", result.people, (items) => `<div class="p-grid">${items.map((item) => personCard(item, { type: "person" })).join("")}</div>`, `/people?q=${q}`),
      block("Студии", result.studios, (items) => `<div class="studio-grid">${items.map((studio) => `<a class="studio-card" href="${e(studioPath(studio))}">${studio.image ? `<img src="${e(studio.image)}" alt="" width="120" height="60" referrerpolicy="no-referrer" loading="lazy">` : '<span class="studio-mark" aria-hidden="true">✦</span>'}<strong>${e(studio.name)}</strong></a>`).join("")}</div>`, `/studios?q=${q}`)
    ].join("");
    content = sections || `<div class="state"><span class="state-icon">🔭</span><strong>Ничего не найдено</strong><p>Попробуйте другое написание или название на английском.</p></div>`;
  } else if (query) {
    content = '<p class="muted">Введите хотя бы 2 символа.</p>';
  }
  const body = `
    <div class="container page">
      <div class="page-head"><div><div class="eyebrow">Поиск</div><h1>${query ? `«${e(query)}»` : "Поиск по энциклопедии"}</h1></div></div>
      <form class="search-box" action="/search" method="get" role="search">
        <label class="visually-hidden" for="searchQ">Запрос</label>
        <input id="searchQ" name="q" type="search" value="${e(query)}" placeholder="Аниме, манга, персонаж, автор или студия" maxlength="100" autofocus>
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      ${content}
    </div>`;
  return renderPage(request, {
    title: query ? `Поиск: «${query}»` : "Поиск", path: null, noindex: true, active: "search", body, styles: STYLES, scripts: ["ency.js"], cache: CACHE
  });
});

// ==================== МОЙ СПИСОК ====================

export const myListPage = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page" id="myList" aria-busy="true">
      <div class="page-head"><div><div class="eyebrow">Личное</div><h1>Мой список</h1>
        <p class="section-text">Что вы смотрите и читаете, оценки, прогресс и статистика.</p></div></div>
      <div class="tabs-bar" role="tablist" aria-label="Раздел">
        <button type="button" role="tab" data-kind="anime" aria-selected="true">Аниме</button>
        <button type="button" role="tab" data-kind="manga" aria-selected="false">Манга</button>
        <button type="button" role="tab" data-kind="favorites" aria-selected="false">Избранное</button>
      </div>
      <div id="myListBody"><div class="skeleton skeleton-row"></div></div>
    </div>`;
    return renderPage(request, {
      title: "Мой список", path: "/mylist", active: "mylist", body, styles: STYLES, scripts: ["mylist.js"], noindex: true
    });
  }
};

