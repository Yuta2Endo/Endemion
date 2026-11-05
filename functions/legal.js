// Legal Center: документы каждой игры на русском и английском. Тексты — в functions/_lib/legal/.
// Язык задаётся адресом (?lang=en): у каждой версии свой canonical и hreflang, скрипты и cookie не нужны

import { escapeHtml as e } from "./_lib/html.js";
import { renderPage } from "./_lib/layout.js";
import { LEGAL_GAMES, LEGAL_UPDATED, legalGame } from "./_lib/legal/index.js";

const STYLES = ["studio.css", "legal.css"];
const SCRIPTS = ["studio-page.js"];

// Адрес документа → ключ в данных игры
const DOCUMENTS = { "privacy-policy": "privacy", "terms-of-service": "terms" };

const UI = {
  ru: {
    center: "Правовой центр",
    centerLead: "Политика конфиденциальности и условия использования для каждой игры Endemion.",
    centerDescription: "Политики конфиденциальности и условия использования игр Endemion: TETRUS, Little Weather, Liforae и ENDEMION LIFE.",
    privacy: "Политика конфиденциальности",
    terms: "Условия использования",
    updated: "Последнее обновление",
    contents: "Содержание",
    breadcrumbs: "Навигация",
    documents: "Документы игры",
    language: "Язык документа",
    draft: "Черновик. Выделенные поля разработчик ещё не подтвердил. Документ не является юридической консультацией.",
    siteWide: "Документы сайта",
    siteWideText: "Сайт endemion.online, форум и аккаунт Endemion ID описаны в отдельных документах.",
    sitePrivacy: "Политика сайта",
    siteTerms: "Условия сайта",
    notFound: "Такого документа нет."
  },
  en: {
    center: "Legal Center",
    centerLead: "Privacy Policy and Terms of Service for each Endemion game.",
    centerDescription: "Privacy policies and terms of service for Endemion games: TETRUS, Little Weather, Liforae and ENDEMION LIFE.",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    updated: "Last updated",
    contents: "Contents",
    breadcrumbs: "Breadcrumbs",
    documents: "Game documents",
    language: "Document language",
    draft: "Draft. The developer has not yet confirmed the highlighted fields. This document is not legal advice.",
    siteWide: "Website documents",
    siteWideText: "The endemion.online website, the forum and the Endemion ID account are covered by separate documents.",
    sitePrivacy: "Website privacy policy",
    siteTerms: "Website terms",
    notFound: "This document does not exist."
  }
};

function languageOf(request) {
  return new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ru";
}

function localized(path, lang) {
  return lang === "en" ? `${path}?lang=en` : path;
}

function formatDate(iso, lang) {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
}

/** [[поле]] — данные, которые должен подтвердить разработчик; {{адрес|текст}} — ссылка. Остальное экранируется */
function inline(text) {
  return e(text)
    .replace(/\[\[(.+?)\]\]/g, '<mark class="legal-placeholder">[$1]</mark>')
    .replace(/\{\{((?:\/|https:\/\/)[^|}]*)\|(.+?)\}\}/g, '<a href="$1">$2</a>');
}

/** Строка — абзац, массив строк — список */
function block(item) {
  if (Array.isArray(item)) return `<ul>${item.map((line) => `<li>${inline(line)}</li>`).join("")}</ul>`;
  return `<p>${inline(item)}</p>`;
}

function languageSwitch(path, lang, label) {
  const link = (code, name) =>
    `<a href="${e(localized(path, code))}" hreflang="${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ""}>${name}</a>`;
  return `<nav class="legal-lang" aria-label="${e(label)}">${link("ru", "Русский")}${link("en", "English")}</nav>`;
}

/** hreflang обеих версий и Open Graph: head в renderPage заменяет теги по умолчанию */
function headTags(request, path, title, description) {
  const origin = new URL(request.url).origin;
  const alternate = (code, href) => `<link rel="alternate" hreflang="${code}" href="${e(origin + href)}">`;
  return [
    alternate("ru", path),
    alternate("en", `${path}?lang=en`),
    alternate("x-default", path),
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${e(title)}">`,
    `<meta property="og:description" content="${e(description)}">`,
    `<meta property="og:image" content="${e(origin)}/assets/og-image.png">`,
    '<meta name="twitter:card" content="summary_large_image">'
  ].join("\n  ");
}

function notFoundPage(request, lang) {
  const t = UI[lang];
  const body = `<div class="container page legal-page">
      <h1 class="display-2">404</h1>
      <p class="lead">${e(t.notFound)}</p>
      <div class="btn-row"><a class="ghost-btn" href="${e(localized("/legal", lang))}">${e(t.center)}</a></div>
    </div>`;
  return renderPage(request, { title: t.center, body, styles: STYLES, scripts: SCRIPTS, noindex: true, status: 404, lang });
}

/** GET /legal */
export const center = {
  async onRequestGet({ request }) {
    const lang = languageOf(request);
    const t = UI[lang];
    const path = "/legal";
    const cards = LEGAL_GAMES.map((game) => `<article class="card legal-card"><div class="card-body">
          <h2 class="card-title">${e(game.title)}</h2>
          <p class="card-text">${e(game.summary[lang])}</p>
          <ul class="legal-card-links">
            <li><a href="${e(localized(`/legal/${game.slug}/privacy-policy`, lang))}">${e(t.privacy)}</a></li>
            <li><a href="${e(localized(`/legal/${game.slug}/terms-of-service`, lang))}">${e(t.terms)}</a></li>
          </ul>
        </div></article>`).join("");
    const body = `<div class="container page legal-page">
      <div class="page-head"><div>
        <div class="eyebrow">ENDEMION</div>
        <h1 class="display-2">${e(t.center)}</h1>
        <p class="lead">${e(t.centerLead)}</p>
      </div>${languageSwitch(path, lang, t.language)}</div>
      <div class="legal-grid">${cards}</div>
      <section class="legal-site-docs" aria-labelledby="siteDocs">
        <h2 id="siteDocs">${e(t.siteWide)}</h2>
        <p>${e(t.siteWideText)}</p>
        <div class="btn-row"><a class="ghost-btn" href="/privacy">${e(t.sitePrivacy)}</a><a class="ghost-btn" href="/terms">${e(t.siteTerms)}</a></div>
      </section>
    </div>`;
    return renderPage(request, {
      title: t.center, description: t.centerDescription, path: localized(path, lang), body, styles: STYLES, scripts: SCRIPTS, lang,
      head: headTags(request, path, t.center, t.centerDescription)
    });
  }
};

/** GET /legal/:game — у игры нет своей страницы, открывается её политика */
export const gameIndex = {
  async onRequestGet({ request, params }) {
    const lang = languageOf(request);
    if (!legalGame(params.game)) return notFoundPage(request, lang);
    return new Response(null, { status: 302, headers: { Location: localized(`/legal/${params.game}/privacy-policy`, lang) } });
  }
};

/** GET /legal/:game/:document */
export const documentPage = {
  async onRequestGet({ request, params }) {
    const lang = languageOf(request);
    const game = legalGame(params.game);
    const key = Object.hasOwn(DOCUMENTS, params.document) ? DOCUMENTS[params.document] : null;
    if (!game || !key) return notFoundPage(request, lang);

    const t = UI[lang];
    const doc = game[key][lang];
    const path = `/legal/${game.slug}/${params.document}`;
    const name = key === "privacy" ? t.privacy : t.terms;
    const title = `${name} — ${game.title}`;
    const description = doc.description;
    const hasPlaceholders = JSON.stringify(doc).includes("[[");
    const tab = (slug, label) => {
      const href = `/legal/${game.slug}/${slug}`;
      return `<a href="${e(localized(href, lang))}"${href === path ? ' aria-current="page"' : ""}>${e(label)}</a>`;
    };

    const body = `<div class="container page legal-page">
      <nav class="legal-breadcrumbs" aria-label="${e(t.breadcrumbs)}"><a href="${e(localized("/legal", lang))}">${e(t.center)}</a> <span aria-hidden="true">/</span> <span>${e(game.title)}</span></nav>
      <div class="page-head"><div>
        <div class="eyebrow">${e(game.title)}</div>
        <h1 class="display-2">${e(name)}</h1>
        <p class="legal-updated">${e(t.updated)}: <time datetime="${LEGAL_UPDATED}">${e(formatDate(LEGAL_UPDATED, lang))}</time></p>
      </div>${languageSwitch(path, lang, t.language)}</div>
      <nav class="tabs-bar" aria-label="${e(t.documents)}">${tab("privacy-policy", t.privacy)}${tab("terms-of-service", t.terms)}</nav>
      ${hasPlaceholders ? `<p class="legal-draft" role="note">${e(t.draft)}</p>` : ""}
      <div class="legal-layout">
        <nav class="legal-toc" aria-labelledby="legalToc">
          <h2 id="legalToc">${e(t.contents)}</h2>
          <ol>${doc.sections.map((s) => `<li><a href="#${e(s.id)}">${e(s.title)}</a></li>`).join("")}</ol>
        </nav>
        <article class="legal-doc">
          ${doc.sections.map((s) => `<section id="${e(s.id)}"><h2>${e(s.title)}</h2>${s.body.map(block).join("")}</section>`).join("\n          ")}
        </article>
      </div>
    </div>`;
    return renderPage(request, {
      title, description, path: localized(path, lang), body, styles: STYLES, scripts: SCRIPTS, lang,
      head: headTags(request, path, title, description)
    });
  }
};

/** Все адреса Legal Center для карты сайта */
export function legalPaths() {
  const pages = ["/legal", ...LEGAL_GAMES.flatMap((game) => Object.keys(DOCUMENTS).map((slug) => `/legal/${game.slug}/${slug}`))];
  return pages.flatMap((path) => [path, `${path}?lang=en`]);
}
