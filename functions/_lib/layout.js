// Каркас страниц сайта: шапка, подвал и мета-теги. Страницы разделов собираются на сервере (functions/site.js),
// данные подгружают скрипты из public/assets. Встроенных скриптов и стилей нет: CSP остаётся строгим

import { escapeHtml as e, html } from "./html.js";

export const SLOGAN = "Энциклопедия аниме и манги: произведения, персонажи, авторы и студии.";
export const BRAND = "ENDEMION — энциклопедия аниме и манги";

// [адрес, подпись, ключ раздела]
export const NAV = [
  ["/", "Главная", "home"],
  ["/anime", "Аниме", "anime"],
  ["/manga", "Манга", "manga"],
  ["/characters", "Персонажи", "characters"],
  ["/people", "Люди", "people"],
  ["/studios", "Студии", "studios"],
  ["/seasons", "Сезоны", "seasons"],
  ["/rankings", "Рейтинги", "rankings"],
  ["/mylist", "Мой список", "mylist"],
  ["/community", "Сообщество", "community"]
];

// Меню «Ещё»: платформа чтения, которая была на сайте до энциклопедии, и игра Endemion Life
export const NAV_MORE = [
  ["/reading", "Читалка: главная", "reading"],
  ["/catalog", "Читалка: каталог", "catalog"],
  ["/nexus", "Nexus", "nexus"],
  ["/oracle", "Oracle", "oracle"],
  ["/pulse", "Pulse", "pulse"],
  ["/arena", "Арена", "arena"],
  // Тот же аккаунт Endemion ID, вход без пароля при активной сессии
  ["https://life.endemion.online", "Endemion Life", "life"]
];

// Контуры иконок 24×24. Такие же есть в public/assets/app.js для иконок, которые рисует скрипт
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>'
};

export function svgIcon(name, className = "") {
  return `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function siteHeader(active) {
  const item = ([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${e(label)}</a>`;
  const moreActive = NAV_MORE.some(([, , key]) => key === active);
  return `<header class="header">
    <div class="container nav">
      <a class="logo" href="/" aria-label="ENDEMION — на главную"><span class="logo-mark" aria-hidden="true">E</span><span class="logo-text">ENDEMION</span></a>
      <nav class="nav-links" id="navLinks" aria-label="Разделы">${NAV.map(item).join("")}
        <details class="nav-more"${moreActive ? " data-active" : ""}><summary>Ещё</summary><div class="nav-more-menu">${NAV_MORE.map(item).join("")}</div></details>
      </nav>
      <div class="nav-actions">
        <a class="icon-btn" id="searchToggle" href="/search" aria-label="Поиск: аниме, манга, персонажи, люди, студии" aria-keyshortcuts="/">${svgIcon("search")}</a>
        <a class="icon-btn" id="notifyButton" href="/pulse#notifications" aria-label="Уведомления" hidden>${svgIcon("bell")}<span class="badge-count" id="notifyCount" hidden></span></a>
        <a class="ghost-btn register-btn" id="registerButton" href="/auth?mode=register" hidden>Регистрация</a>
        <a class="profile-btn" id="accountButton" href="/auth">Войти</a>
        <button class="icon-btn menu-toggle" type="button" aria-controls="navLinks" aria-expanded="false" aria-label="Меню">${svgIcon("menu", "icon-open")}${svgIcon("close", "icon-close")}</button>
      </div>
    </div>
    <div class="search-panel" id="searchPanel" hidden>
      <div class="container">
        <form class="search-box search-panel-form" action="/search" method="get" role="search">
          ${svgIcon("search")}
          <label class="visually-hidden" for="globalSearch">Поиск по энциклопедии</label>
          <input id="globalSearch" name="q" type="search" placeholder="Аниме, манга, персонаж, автор или студия…" autocomplete="off" maxlength="100"
            aria-controls="searchResults" aria-autocomplete="list">
          <button class="primary-btn" type="submit">Найти</button>
        </form>
        <div class="search-results" id="searchResults" aria-live="polite"></div>
      </div>
    </div>
  </header>`;
}

export function siteFooter() {
  return `<footer class="footer">
    <div class="container footer-inner">
      <div>
        <strong class="footer-brand">ENDEMION</strong>
        <p class="footer-tagline">${e(SLOGAN)}</p>
      </div>
      <nav class="footer-links" aria-label="Документы и разделы">
        <a href="/anime">Аниме</a>
        <a href="/manga">Манга</a>
        <a href="/community">Сообщество</a>
        <a href="/reading">Читалка</a>
        <a href="https://life.endemion.online">Endemion Life</a>
        <a href="/copyright">Правообладателям</a>
        <a href="/privacy">Политика конфиденциальности</a>
        <a href="/privacy#cookie" data-cookie-settings hidden>Настройки cookie</a>
      </nav>
    </div>
    <p class="container footer-source">Данные каталога, описания и изображения — <a href="https://shikimori.io" rel="noopener">Shikimori</a>.
      Оценки, списки и отзывы — пользователей ENDEMION.</p>
  </footer>`;
}

/**
 * Страница целиком. body — разметка внутри <main>, scripts и styles — файлы из /assets.
 * head — дополнительные мета-теги (уже экранированные), status и cache — для ответа
 */
export function renderPage(request, {
  title = "", description = "", path = null, active = null, body, scripts = [], styles = [], head = "",
  noindex = false, status = 200, cache = "no-cache", mainClass = "", mainAttrs = ""
}) {
  const origin = new URL(request.url).origin;
  const fullTitle = title ? `${title} | ENDEMION` : BRAND;
  const canonical = path ? `${origin}${path}` : null;
  const desc = description || "ENDEMION — энциклопедия аниме и манги: каталог с фильтрами, персонажи, авторы, студии, сезоны, рейтинги, личные списки и отзывы.";
  const page = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#07061a">
  <title>${e(fullTitle)}</title>
  <meta name="description" content="${e(desc)}">
  ${noindex ? '<meta name="robots" content="noindex">' : ""}
  ${canonical ? `<link rel="canonical" href="${e(canonical)}">` : ""}
  <meta property="og:site_name" content="ENDEMION">
  <meta property="og:locale" content="ru_RU">
  ${head || `<meta property="og:type" content="website">
  <meta property="og:title" content="${e(fullTitle)}">
  <meta property="og:description" content="${e(desc)}">
  <meta property="og:image" content="${e(origin)}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">`}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-title" content="ENDEMION">
  <link rel="preload" href="/assets/fonts/manrope-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/unbounded-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/base.css">
  <link rel="stylesheet" href="/assets/ui.css">
  ${styles.map((file) => `<link rel="stylesheet" href="/assets/${file}">`).join("\n  ")}
  ${scripts.map((file) => `<script type="module" src="/assets/${file}"></script>`).join("\n  ")}
</head>
<body>
  <a class="skip-link" href="#main">Перейти к содержимому</a>
  ${siteHeader(active)}
  <main id="main"${mainClass ? ` class="${mainClass}"` : ""}${mainAttrs ? ` ${mainAttrs}` : ""}>
${body}
  </main>
  ${siteFooter()}
</body>
</html>`;
  return html(page, status, { "Cache-Control": cache, ...(noindex ? { "X-Robots-Tag": "noindex" } : {}) });
}

/** Заголовок раздела: надзаголовок, заголовок, описание и место для кнопок справа */
export function sectionHeading({ eyebrow = "", title, text = "", id = "", actions = "", level = 2 }) {
  return `<div class="section-head">
      <div>
        ${eyebrow ? `<div class="eyebrow">${e(eyebrow)}</div>` : ""}
        <h${level}${id ? ` id="${id}"` : ""}>${e(title)}</h${level}>
        ${text ? `<p class="section-text">${e(text)}</p>` : ""}
      </div>
      ${actions}
    </div>`;
}
