// GET /title/:id — страница тайтла. HTML собирается на сервере, чтобы поисковики и превью ссылок видели содержимое.
// Полку, прогресс, теги, персонажей, легальные источники, отзывы, комментарии и похожие тайтлы дорисовывает /assets/title.js

import { escapeHtml as e, notFound } from "../_lib/html.js";
import { renderPage } from "../_lib/layout.js";
import { formatDate, getTitle, listChapters, parseId, plural, posterBackground, TYPES } from "../_lib/titles.js";

/** Разметка schema.org для поисковиков. «<» экранируется: строка из базы не сможет закрыть тег </script> */
function structuredData(title, url, image) {
  const data = {
    "@context": "https://schema.org",
    "@type": "ComicSeries",
    name: title.title,
    ...(title.originalTitle ? { alternateName: title.originalTitle } : {}),
    description: title.description,
    url,
    inLanguage: "ru",
    genre: title.genres,
    author: { "@type": "Person", name: title.author },
    ...(image ? { image } : {}),
    // Только реальные оценки читателей: без оценок блока нет
    ...(title.readerVotes ? {
      aggregateRating: { "@type": "AggregateRating", ratingValue: title.readerRating, ratingCount: title.readerVotes, bestRating: 10, worstRating: 1 }
    } : {})
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
  const path = `/title/${title.id}`;
  const url = `${origin}${path}`;
  const chapters = `${title.chapters} ${plural(title.chapters, "глава", "главы", "глав")}`;
  const statusText = title.status === "ongoing" ? "Выходит" : "Завершён";
  const description = `${type.label}, ${title.year}. ${title.description} ${chapters}.`;
  // Превью ссылки: загруженная обложка или общая картинка сайта
  const cover = title.cover ? `${origin}${title.cover}` : null;
  const image = cover || `${origin}/assets/og-image.png`;
  const readers = title.readerVotes
    ? `<div><strong>★ ${title.readerRating.toFixed(1)}</strong><span>читатели · ${title.readerVotes} ${plural(title.readerVotes, "оценка", "оценки", "оценок")}</span></div>`
    : `<div><strong>—</strong><span>оценок читателей пока нет</span></div>`;

  const head = `<meta property="og:type" content="book">
  <meta property="og:title" content="${e(title.title)} — ${e(type.label)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(url)}">
  <meta property="og:image" content="${e(image)}">
  ${cover ? `<meta property="og:image:alt" content="${e(`Обложка «${title.title}»`)}">` : ""}
  <meta name="twitter:card" content="${cover ? "summary" : "summary_large_image"}">
  <script type="application/ld+json">${structuredData(title, url, cover)}</script>`;

  const body = `
    <div class="container title-page" data-title-id="${title.id}" data-chapters="${title.chapters}" data-status="${e(title.status)}" id="titleRoot">
    <nav class="breadcrumbs" aria-label="Навигация"><a href="/catalog">Каталог</a> <span aria-hidden="true">/</span> <a href="/catalog?type=${e(title.type)}">${e(type.label)}</a> <span aria-hidden="true">/</span> <span>${e(title.title)}</span></nav>

    <section class="title-hero">
      <div class="title-poster" data-poster="${e(posterBackground(title))}"${cover ? ` role="img" aria-label="${e(`Обложка «${title.title}»`)}"` : ""}>
        <span class="type-badge type-${e(title.type)}">${e(type.label)}</span>
        ${cover ? "" : `<span class="poster-symbol" aria-hidden="true">${e(title.symbol)}</span>`}
      </div>

      <div class="title-info">
        <div class="eyebrow">${e(title.genres.join(" · "))}</div>
        <h1 class="title-name">${e(title.title)}</h1>
        ${title.originalTitle ? `<p class="title-original">${e(title.originalTitle)}</p>` : ""}
        <div class="title-scores">
          ${readers}
          <div><strong>★ ${title.rating.toFixed(1)}</strong><span>оценка редакции</span></div>
          <div><strong>${title.readers}</strong><span>на полках читателей</span></div>
        </div>
        <p class="title-description">${e(title.description)}</p>

        <dl class="title-facts">
          <div><dt>Автор</dt><dd>${e(title.author)}</dd></div>
          <div><dt>Год</dt><dd>${title.year}</dd></div>
          <div><dt>Выпуск</dt><dd class="status-${e(title.status)}">${statusText}${title.chapters ? ` · ${e(chapters)}` : ""}</dd></div>
          <div><dt>Формат</dt><dd>${e(type.country)} · ${e(type.format)}</dd></div>
        </dl>

        ${hasChapters ? `<div class="read-actions">
          <a class="primary-btn read-btn" id="readButton" href="/read/${title.id}/1">Читать с 1 главы</a>
          <a class="ghost-btn" href="/read/${title.id}/${title.chapters}">Последняя глава ${title.chapters}</a>
        </div>` : `<p class="read-actions-empty">Главы пока не добавлены. Где читать официально — в разделе «Легальные источники».</p>`}

        <div class="library-controls" id="libraryControls" aria-live="polite"></div>
      </div>
    </section>

    <div class="split">
      <div class="title-sections">
        ${hasChapters ? `<section aria-labelledby="chaptersTitle">
          <h2 id="chaptersTitle">Прогресс</h2>
          <div class="chapter-panel" id="chapterPanel"></div>
        </section>` : ""}

        <section aria-labelledby="tagsTitle" id="tagsSection" hidden>
          <h2 id="tagsTitle">Атмосфера, герой и сюжет</h2>
          <div class="tag-groups" id="tagGroups"></div>
        </section>

        <section aria-labelledby="charactersTitle" id="charactersSection" hidden>
          <h2 id="charactersTitle">Персонажи</h2>
          <div class="character-list" id="characterList"></div>
        </section>

        <section aria-labelledby="reviewsTitle" id="reviews">
          <h2 id="reviewsTitle">Оценки и отзывы</h2>
          <div class="panel" id="reviewsBox"><div class="skeleton skeleton-row"></div></div>
        </section>

        <section aria-labelledby="commentsTitle" id="comments">
          <h2 id="commentsTitle">Обсуждение</h2>
          <div class="panel" id="commentsBox"><div class="skeleton skeleton-row"></div></div>
        </section>

        <section aria-labelledby="listTitle">
          <h2 id="listTitle">Список глав</h2>
          ${hasChapters
            ? `<p class="muted small">Экстры (побочные истории) отмечены розовой полоской слева.</p>
          <ol class="chapter-list" id="chapterList" reversed>
          ${chapterList.map((chapter) => chapterItem(title.id, chapter)).join("\n          ")}
          </ol>`
            : `<p class="state">Глав пока нет.</p>`}
        </section>
      </div>

      <aside class="stack">
        <section class="panel" aria-labelledby="sourcesTitle">
          <h2 id="sourcesTitle">Легальные источники</h2>
          <div class="source-list" id="sourceList"><p class="muted small">Загрузка…</p></div>
          <p class="muted small section">Нашли нарушение авторских прав? <a class="link-btn" href="/copyright">Сообщите правообладателям</a>.</p>
        </section>
        <section class="panel" aria-labelledby="relatedTitle">
          <h2 id="relatedTitle">Похожие истории</h2>
          <div class="related-list" id="relatedList"></div>
          <a class="ghost-btn small-btn section" href="/nexus?title=${title.id}">Открыть в Nexus →</a>
        </section>
        <section class="panel" aria-labelledby="collectionsTitle" id="titleCollections" hidden>
          <h2 id="collectionsTitle">В подборках читателей</h2>
          <div class="stack" id="titleCollectionList"></div>
        </section>
      </aside>
    </div>
    </div>`;

  return renderPage(request, {
    title: `${title.title} — ${type.label.toLowerCase()}`, description, path, active: "catalog", head, body,
    styles: ["title.css"], scripts: ["title.js"], cache: "public, max-age=120"
  });
}
