// Каркас страниц сайта: шапка, подвал и мета-теги. Страницы разделов собираются на сервере (functions/site.js),
// данные подгружают скрипты из public/assets. Встроенных скриптов и стилей нет: CSP остаётся строгим

import { escapeHtml as e, html } from "./html.js";
import { langOf, t } from "./i18n.js";

export const SLOGAN = "ENDEMION — Create. Play. Connect.";
export const BRAND = "ENDEMION — Create. Play. Connect.";
export const DEFAULT_DESCRIPTION = "Endemion — независимая игровая студия и сообщество: наши игры, форум, devlog и новости разработки.";

// [адрес, подпись, ключ раздела]. Энциклопедия в меню не входит (решение владельца 2026-11-04), её адреса работают
export const NAV = [
  ["/", "Главная", "home"],
  ["/games", "Игры", "games"],
  ["/community", "Сообщество", "community"],
  ["/studio", "Разработка", "studio"],
  ["/about", "О студии", "about"]
];

export const NAV_MORE = [];

// Версия assets добавляется к URL, чтобы браузеры обновляли кеш при выкладке. Время сборки в base36
const ASSET_VERSION = "tnyz8c";

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

export function siteHeader(active, s) {
  const item = ([href, , key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${e(s.nav[key])}</a>`;
  return `<header class="header">
    <div class="container nav">
      <a class="logo" href="/" aria-label="${e(s.homeAria)}"><span class="logo-mark" aria-hidden="true">E</span><span class="logo-text">ENDEMION</span></a>
      <nav class="nav-links" id="navLinks" aria-label="${e(s.sections)}">${NAV.map(item).join("")}</nav>
      <div class="nav-actions">
        <form class="nav-search" role="search" action="/search" method="get">
          <label class="visually-hidden" for="navSearch">${e(s.searchLabel)}</label>
          <input id="navSearch" type="search" name="q" maxlength="80" placeholder="${e(s.searchPlaceholder)}" autocomplete="off">
          <button type="submit" aria-label="${e(s.find)}">${svgIcon("search")}</button>
        </form>
        <a class="icon-btn" id="notifyButton" href="/notifications" aria-label="${e(s.notifications)}" hidden>${svgIcon("bell")}<span class="badge-count" id="notifyCount" hidden></span></a>
        <a class="ghost-btn register-btn" id="registerButton" href="/auth?mode=register" hidden>${e(s.register)}</a>
        <a class="profile-btn" id="accountButton" href="/auth">${e(s.login)}</a>
        <button class="lang-btn" type="button" data-lang-toggle aria-label="${e(s.langSwitch)}">${e(s.langSwitch)}</button>
        <button class="icon-btn menu-toggle" type="button" aria-controls="navLinks" aria-expanded="false" aria-label="${e(s.menu)}">${svgIcon("menu", "icon-open")}${svgIcon("close", "icon-close")}</button>
      </div>
    </div>
  </header>`;
}

export function siteFooter(s) {
  const year = new Date().getUTCFullYear();
  return `<footer class="footer">
    <div class="container footer-grid">
      <div class="footer-about">
        <a class="logo" href="/" aria-label="${e(s.homeAria)}"><span class="logo-mark" aria-hidden="true">E</span><span class="logo-text">ENDEMION</span></a>
        <p class="footer-tagline">Create. Play. Connect.</p>
        <p class="footer-text">${e(s.footerText)}</p>
        <!-- Ссылки на соцсети задаёт администратор (Настройки сайта), их подставляет app.js. Пока ссылок нет, блок скрыт -->
        <ul class="footer-social" id="footerSocial" aria-label="${e(s.social)}" hidden></ul>
      </div>
      <nav class="footer-col" aria-label="${e(s.sections)}">
        <h2 class="footer-title">${e(s.sections)}</h2>
        ${NAV.map(([href, , key]) => `<a href="${href}">${e(s.nav[key])}</a>`).join("")}
      </nav>
      <nav class="footer-col" aria-label="${e(s.projects)}">
        <h2 class="footer-title">${e(s.projects)}</h2>
        <a href="https://life.endemion.online">Endemion Life</a>
        <a href="/community">Endemion Community</a>
        <a href="/studio">Devlog</a>
      </nav>
      <nav class="footer-col" aria-label="${e(s.documents)}">
        <h2 class="footer-title">${e(s.documents)}</h2>
        <a href="/legal">${e(s.legal)}</a>
        <a href="/privacy">${e(s.privacy)}</a>
        <a href="/terms">${e(s.terms)}</a>
        <a href="/copyright">${e(s.copyright)}</a>
        <a href="/privacy#cookie" data-cookie-settings hidden>${e(s.cookies)}</a>
      </nav>
    </div>
    <div class="container footer-bottom">
      <p>© ${year} Endemion. ${e(s.rights)}</p>
    </div>
  </footer>`;
}

/**
 * Страница целиком. body — разметка внутри <main>, scripts и styles — файлы из /assets.
 * head — дополнительные мета-теги (уже экранированные), status и cache — для ответа
 */
export function renderPage(request, {
  title = "", fullTitle: titleIsFull = false, description = "", path = null, active = null, body, scripts = [], styles = [], head = "",
  noindex = false, status = 200, cache = "no-cache", mainClass = "", mainAttrs = "", lang = null
}) {
  const origin = new URL(request.url).origin;
  const pageLang = lang || langOf(request);
  const s = t(pageLang);
  // fullTitle: true — заголовок уже полный (SEO-заголовок страницы игры), суффикс «| ENDEMION» не добавляется
  const fullTitle = title ? (titleIsFull ? title : `${title} | ENDEMION`) : BRAND;
  const canonical = path ? `${origin}${path}` : null;
  const desc = description || DEFAULT_DESCRIPTION;
  const page = `<!doctype html>
<html lang="${pageLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#080a10">
  <title>${e(fullTitle)}</title>
  <meta name="description" content="${e(desc)}">
  ${noindex ? '<meta name="robots" content="noindex">' : ""}
  ${canonical ? `<link rel="canonical" href="${e(canonical)}">` : ""}
  <meta property="og:site_name" content="ENDEMION">
  <meta property="og:locale" content="${pageLang === "en" ? "en_US" : "ru_RU"}">
  ${head || `<meta property="og:type" content="website">
  <meta property="og:title" content="${e(fullTitle)}">
  <meta property="og:description" content="${e(desc)}">
  <meta property="og:image" content="${e(origin)}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">`}
  <link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
  <link rel="icon" href="/icons/favicon-32x32.png?v=2" type="image/png" sizes="32x32">
  <link rel="icon" href="/icons/favicon-16x16.png?v=2" type="image/png" sizes="16x16">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2" sizes="180x180">
  <meta name="apple-mobile-web-app-title" content="ENDEMION">
  <link rel="preload" href="/assets/fonts/manrope-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/unbounded-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/base.css?v=${ASSET_VERSION}">
  <link rel="stylesheet" href="/assets/ui.css?v=${ASSET_VERSION}">
  ${styles.map((file) => `<link rel="stylesheet" href="/assets/${file}?v=${ASSET_VERSION}">`).join("\n  ")}
  <script type="module" src="/assets/lang.js?v=${ASSET_VERSION}"></script>
  ${scripts.map((file) => `<script type="module" src="/assets/${file}?v=${ASSET_VERSION}"></script>`).join("\n  ")}
</head>
<body>
  <a class="skip-link" href="#main">${e(s.skip)}</a>
  ${siteHeader(active, s)}
  <main id="main"${mainClass ? ` class="${mainClass}"` : ""}${mainAttrs ? ` ${mainAttrs}` : ""}>
${body}
  </main>
  ${siteFooter(s)}
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
