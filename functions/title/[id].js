// GET /title/:id — страница тайтла. HTML собирается на сервере, чтобы поисковики и превью ссылок видели содержимое.
// Избранное, статус и прочитанные главы дорисовывает /assets/title.js

import { escapeHtml as e, html, notFound } from "../_lib/html.js";
import { formatDate, getTitle, listChapters, parseId, plural, posterBackground, TYPES } from "../_lib/titles.js";

/** Разметка schema.org для поисковиков. «<» экранируется: строка из базы не сможет закрыть тег </script> */
function structuredData(title, url, image) {
  const data = {
    "@context": "https://schema.org",
    "@type": "ComicSeries",
    name: title.title,
    description: title.description,
    url,
    inLanguage: "ru",
    genre: title.genres,
    author: { "@type": "Person", name: title.author },
    ...(image ? { image } : {})
  };
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

/** Строка списка глав: номер, название, том, пометка экстры и дата выхода */
function chapterItem(titleId, chapter) {
  const label = chapter.sideStory ? `Экстра · глава ${chapter.number}` : `Глава ${chapter.number}`;
  const details = [chapter.volume ? `Том ${chapter.volume}` : "", formatDate(chapter.releasedAt)].filter(Boolean).join(" · ");
  return `<li><a href="/read/${titleId}/${chapter.number}" data-chapter="${chapter.number}"${chapter.sideStory ? ` class="is-side"` : ""}>` +
    `<span class="chapter-label"><strong>${e(label)}</strong>${chapter.name ? `<span class="chapter-name">${e(chapter.name)}</span>` : ""}` +
    `<small>${e(details)}</small></span></a></li>`;
}

export async function onRequestGet({ params, env, request }) {
  const id = parseId(params.id);
  const title = id && env.DB ? await getTitle(env, id) : null;
  if (!title) return notFound(env, request);
  const chapterList = await listChapters(env, title.id);
  const hasChapters = chapterList.length > 0;

  const type = TYPES[title.type];
  const origin = new URL(request.url).origin;
  const url = `${origin}/title/${title.id}`;
  const chapters = `${title.chapters} ${plural(title.chapters, "глава", "главы", "глав")}`;
  const statusText = title.status === "ongoing" ? "Выходит" : "Завершён";
  const description = `${type.label}, ${title.year}. ${title.description} ${chapters}, перевод: ${title.translator}.`;
  // Превью ссылки: загруженная обложка или общая картинка сайта
  const cover = title.cover ? `${origin}${title.cover}` : null;
  const image = cover || `${origin}/assets/og-image.png`;

  const page = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080b18">
  <title>${e(title.title)} — ${e(type.label.toLowerCase())} читать на русском | Endemion</title>
  <meta name="description" content="${e(description)}">
  <link rel="canonical" href="${e(url)}">
  <meta property="og:type" content="book">
  <meta property="og:site_name" content="Endemion">
  <meta property="og:title" content="${e(title.title)} — ${e(type.label)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(url)}">
  <meta property="og:image" content="${e(image)}">
  ${cover ? `<meta property="og:image:alt" content="${e(`Обложка «${title.title}»`)}">` : ""}
  <meta property="og:locale" content="ru_RU">
  <meta name="twitter:card" content="${cover ? "summary" : "summary_large_image"}">
  <script type="application/ld+json">${structuredData(title, url, cover)}</script>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-title" content="Endemion">
  <link rel="stylesheet" href="/assets/base.css">
  <link rel="stylesheet" href="/assets/catalog.css">
  <script type="module" src="/assets/title.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Перейти к содержимому</a>

  <header class="header">
    <div class="container nav">
      <a class="logo" href="/"><span class="logo-mark" aria-hidden="true">E</span>ENDEMION</a>
      <nav class="nav-links" id="navLinks" aria-label="Разделы">
        <a href="/#catalog">Каталог</a>
        <a href="/#popular">Популярное</a>
        <a href="/#updates">Новые главы</a>
      </nav>
      <div class="nav-actions">
        <a class="profile-btn" id="accountButton" href="/auth">Войти</a>
        <button class="menu-toggle" type="button" aria-controls="navLinks" aria-expanded="false" aria-label="Меню">☰</button>
      </div>
    </div>
  </header>

  <main class="container title-page" id="main" data-title-id="${title.id}" data-chapters="${title.chapters}" data-status="${e(title.status)}">
    <nav class="breadcrumbs" aria-label="Навигация"><a href="/#catalog">Каталог</a> <span aria-hidden="true">/</span> <span>${e(title.title)}</span></nav>

    <section class="title-hero">
      <div class="card-poster title-poster" data-poster="${e(posterBackground(title))}"${cover ? ` role="img" aria-label="${e(`Обложка «${title.title}»`)}"` : ""}>
        <span class="type-badge type-${e(title.type)}">${e(type.label)}</span>
        ${cover ? "" : `<span class="poster-symbol" aria-hidden="true">${e(title.symbol)}</span>`}
      </div>

      <div class="title-info">
        <div class="eyebrow">${e(title.genres.join(" · "))}</div>
        <h1 class="title-name">${e(title.title)}</h1>
        <div class="card-meta title-meta">
          <span>${e(type.label)} · ${e(type.country)}</span><span>•</span>
          <span>${title.year}</span><span>•</span>
          <span>${e(chapters)}</span><span>•</span>
          <span class="rating">★ ${title.rating}</span>
        </div>
        <p class="title-description">${e(title.description)}</p>

        <dl class="title-facts">
          <div><dt>Автор</dt><dd>${e(title.author)}</dd></div>
          <div><dt>Перевод</dt><dd>${e(title.translator)}</dd></div>
          <div><dt>Выпуск</dt><dd class="status-${e(title.status)}">${statusText}</dd></div>
          <div><dt>Формат</dt><dd>${e(type.format)}</dd></div>
        </dl>

        ${hasChapters ? `<div class="read-actions">
          <a class="primary-btn read-btn" id="readButton" href="/read/${title.id}/1">Читать с 1 главы</a>
          <a class="ghost-btn" href="/read/${title.id}/${title.chapters}">Последняя глава ${title.chapters}</a>
        </div>` : `<p class="read-actions-empty">Главы пока не добавлены.</p>`}

        <div class="library-controls" id="libraryControls" aria-live="polite"></div>
      </div>
    </section>

    ${hasChapters ? `<section class="section" aria-labelledby="chaptersTitle">
      <div class="section-heading">
        <div>
          <div class="eyebrow">Главы</div>
          <h2 id="chaptersTitle">${title.status === "ongoing" ? `Вышло ${e(chapters)}` : `Всего ${e(chapters)}`}</h2>
        </div>
        <p>Отмечай, сколько глав прочитано: Endemion запомнит место, и в профиле будет видно, с какой главы продолжить.</p>
      </div>
      <div class="chapter-panel" id="chapterPanel"></div>
    </section>` : ""}

    <section class="section" aria-labelledby="listTitle">
      <div class="section-heading">
        <div>
          <div class="eyebrow">Читать</div>
          <h2 id="listTitle">Список глав</h2>
        </div>
        <p>Экстры (побочные истории) отмечены розовой полоской слева.</p>
      </div>
      ${hasChapters
        ? `<ol class="chapter-list" id="chapterList" reversed>
        ${chapterList.map((chapter) => chapterItem(title.id, chapter)).join("\n        ")}
      </ol>`
        : `<p class="empty">Глав пока нет.</p>`}
    </section>
  </main>

  <footer class="footer">
    <div class="container footer-inner">
      <div><strong>ENDEMION</strong><small> — каталог манги, манхвы и маньхуа на русском.</small></div>
      <nav class="footer-links" aria-label="Документы"><a href="/privacy">Политика конфиденциальности</a><a href="/copyright">Правообладателям</a><a href="/privacy#cookie" data-cookie-settings hidden>Настройки cookie</a></nav>
    </div>
  </footer>
</body>
</html>`;

  return html(page, 200, { "Cache-Control": "public, max-age=300" });
}
