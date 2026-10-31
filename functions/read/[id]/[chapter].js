// GET /read/:id/:chapter — читалка. Страницы перечислены прямо в HTML: без скрипта глава читается обычной лентой,
// а /assets/reader.js включает листание, настройки, клавиши и сохранение прогресса

import { escapeHtml as e, html, notFound } from "../../_lib/html.js";
import { PAGE_SIZES, pageCount, pageKind } from "../../_lib/pages.js";
import { getTitle, parseId, TYPES } from "../../_lib/titles.js";

function radios(name, options) {
  return options
    .map(([value, text]) => `<label class="segment"><input type="radio" name="${name}" value="${value}"><span>${text}</span></label>`)
    .join("");
}

export async function onRequestGet({ params, env, request }) {
  const id = parseId(params.id);
  const chapter = parseId(params.chapter);
  const title = id && chapter && env.DB ? await getTitle(env, id) : null;
  if (!title || chapter > title.chapters) return notFound(env, request);

  const type = TYPES[title.type];
  const kind = pageKind(title);
  const size = PAGE_SIZES[kind];
  const total = pageCount(title, chapter);
  const base = `/read/${title.id}`;
  const hasPrev = chapter > 1;
  const hasNext = chapter < title.chapters;
  // Манга по умолчанию листается справа налево, лента — вертикальная прокрутка
  const mode = kind === "page" ? "paged" : "strip";

  const images = Array.from({ length: total }, (_, i) => {
    const page = i + 1;
    return `<img class="reader-page${page === 1 ? " is-current" : ""}" src="/pages/${title.id}/${chapter}/${page}" ` +
      `width="${size.width}" height="${size.height}" alt="Страница ${page} из ${total}" ` +
      `loading="${page <= 2 ? "eager" : "lazy"}" decoding="async" data-page="${page}">`;
  }).join("\n        ");

  const options = Array.from({ length: title.chapters }, (_, i) => {
    const n = title.chapters - i;
    return `<option value="${n}"${n === chapter ? " selected" : ""}>Глава ${n}</option>`;
  }).join("");

  const endText = hasNext
    ? ""
    : title.status === "ongoing"
      ? `<p>Это последняя вышедшая глава. Новые главы появятся в разделе «Новые главы».</p>`
      : `<p>Это финал. Тайтл прочитан целиком.</p>`;

  const page = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#05070f">
  <title>${e(title.title)} — глава ${chapter} | Endemion</title>
  <meta name="description" content="${e(`${type.label} «${title.title}», глава ${chapter}. Перевод: ${title.translator}.`)}">
  <link rel="canonical" href="${e(new URL(request.url).origin + `${base}/${chapter}`)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/base.css">
  <link rel="stylesheet" href="/assets/reader.css">
  <noscript><link rel="stylesheet" href="/assets/reader-noscript.css"></noscript>
  ${hasNext ? `<link rel="prefetch" href="/pages/${title.id}/${chapter + 1}/1">` : ""}
  <script type="module" src="/assets/reader.js"></script>
</head>
<body class="reader-body" data-mode="${mode}" data-kind="${kind}" data-title-id="${title.id}" data-chapter="${chapter}" data-pages="${total}">
  <script src="/assets/reader-init.js"></script>
  <a class="skip-link" href="#readerStage">Перейти к страницам</a>
  <div class="read-progress" id="readProgress" aria-hidden="true"><span></span></div>

  <header class="reader-bar reader-top">
    <a class="reader-icon" href="/title/${title.id}" aria-label="К странице тайтла" title="К странице тайтла">←</a>
    <div class="reader-heading">
      <strong>${e(title.title)}</strong>
      <span>${e(type.label)} · Глава ${chapter} из ${title.chapters}</span>
    </div>
    <label class="visually-hidden" for="chapterSelect">Перейти к главе</label>
    <select class="reader-select" id="chapterSelect">${options}</select>
    <button class="reader-icon" type="button" id="fullscreenButton" aria-label="Полный экран" title="Полный экран (F)" hidden>⛶</button>
    <button class="reader-icon" type="button" id="settingsButton" aria-controls="readerSettings" aria-expanded="false" aria-label="Настройки чтения" title="Настройки чтения">⚙</button>
  </header>

  <div class="reader-settings" id="readerSettings" role="dialog" aria-label="Настройки чтения" hidden>
    <fieldset><legend>Режим</legend>${radios("mode", [["paged", "Страницы"], ["strip", "Лента"]])}</fieldset>
    <fieldset class="only-paged"><legend>Направление</legend>${radios("direction", [["rtl", "Справа налево"], ["ltr", "Слева направо"]])}</fieldset>
    <fieldset class="only-paged"><legend>Масштаб</legend>${radios("fit", [["height", "Страница целиком"], ["width", "По ширине"]])}</fieldset>
    <fieldset class="only-strip"><legend>Ширина ленты</legend>${radios("width", [["narrow", "Узкая"], ["normal", "Средняя"], ["wide", "Широкая"]])}</fieldset>
    <fieldset><legend>Фон</legend>${radios("background", [["dark", "Тёмный"], ["black", "Чёрный"], ["light", "Светлый"]])}</fieldset>
    <p class="reader-keys only-paged">Нажми на правый или левый край страницы, листай свайпом или стрелками ← →. Центр экрана прячет панели.</p>
    <p class="reader-keys only-strip">Прокручивай вниз: панели прячутся сами. Пробел — следующий экран.</p>
    <p class="reader-keys">F — полный экран, Esc — закрыть настройки.</p>
  </div>

  <main class="reader" id="reader" data-title-id="${title.id}" data-chapter="${chapter}" data-chapters="${title.chapters}" data-pages="${total}">
    <div class="reader-stage" id="readerStage" tabindex="-1">
        ${images}
      <section class="reader-end" id="readerEnd" aria-labelledby="endTitle">
        <div class="reader-end-symbol" aria-hidden="true">${e(title.symbol)}</div>
        <h1 id="endTitle">Глава ${chapter} прочитана</h1>
        ${endText}
        <p class="reader-end-status" id="endStatus" aria-live="polite"></p>
        <div class="reader-end-actions">
          ${hasNext ? `<a class="primary-btn" href="${base}/${chapter + 1}" id="nextChapterLink">Глава ${chapter + 1} →</a>` : ""}
          <a class="ghost-btn" href="/title/${title.id}">К странице тайтла</a>
        </div>
      </section>
    </div>
  </main>

  <footer class="reader-bar reader-bottom">
    ${hasPrev ? `<a class="reader-chapter" href="${base}/${chapter - 1}" rel="prev">← Глава ${chapter - 1}</a>` : `<span class="reader-chapter" aria-hidden="true"></span>`}
    <div class="reader-position">
      <span id="pageCounter" aria-live="polite">1 / ${total}</span>
      <label class="visually-hidden" for="pageSlider">Страница</label>
      <input class="reader-slider only-paged" id="pageSlider" type="range" min="1" max="${total}" value="1" step="1">
    </div>
    ${hasNext ? `<a class="reader-chapter" href="${base}/${chapter + 1}" rel="next">Глава ${chapter + 1} →</a>` : `<span class="reader-chapter" aria-hidden="true"></span>`}
  </footer>
</body>
</html>`;

  return html(page, 200, { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" });
}
