// Секции страницы игры (/games/:slug): hero, навигация по странице, об игре, миры, особенности, скриншоты, roadmap,
// devlog, сообщество, статус. Каждая секция — функция от данных: подходит любой игре каталога, а то, чего у игры нет,
// не показывается или показывается честной заглушкой. Тексты конкретной игры — в gameProfiles.js

import { escapeHtml as e } from "./html.js";
import { emptyCard, formatDate, isoDate, POST_KIND_LABELS, richText, statusBadge, threadRow } from "./studio.js";
import { parseRoadmap, ROADMAP_STATUS_LABELS } from "./roadmap.js";

// Контуры иконок 24×24, обводка currentColor
const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  bug: '<path d="M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM12 8v10M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>',
  progression: '<path d="M4 20h16M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/>',
  living: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  story: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6M9 11h6"/>',
  worlds: '<circle cx="8" cy="9" r="4"/><circle cx="16" cy="15" r="4"/><path d="M11 6.5 13 5M6 15l-2 2M18 9l2-2"/>',
  events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3v3H8z"/>',
  destiny: '<path d="M6 3v6a6 6 0 0 0 12 0V3"/><path d="M12 15v6M8 21h8"/>'
};

export function icon(name) {
  return `<svg class="gp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;
}

/** Обложка: оптимизированные копии из профиля, пока в админке не загружена новая; иначе — оригинал из хранилища */
export function coverSources(game, profile) {
  const art = profile?.cover;
  if (art && game.coverVersion === art.version) {
    const srcset = art.widths.map((w) => `${art.base}-${w}.webp ${w}w`).join(", ");
    return { src: `${art.base}-${art.widths.at(-1)}.webp`, srcset, width: art.width, height: art.height, og: art.og };
  }
  return game.coverUrl ? { src: game.coverUrl, srcset: "", width: 1536, height: 1024, og: null } : null;
}

function coverImg(cover, { alt, priority = false, sizes }) {
  return `<img src="${e(cover.src)}"${cover.srcset ? ` srcset="${e(cover.srcset)}" sizes="${e(sizes)}"` : ""} alt="${e(alt)}" ` +
    `width="${cover.width}" height="${cover.height}" decoding="async" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
}

function section(id, { eyebrow = "", title, text = "", className = "" }, content) {
  return `<section class="gp-section${className ? ` ${className}` : ""}" id="${id}" aria-labelledby="${id}-title">
      <div class="gp-section-head">
        ${eyebrow ? `<div class="gp-eyebrow">${e(eyebrow)}</div>` : ""}
        <h2 class="gp-h2" id="${id}-title">${e(title)}</h2>
        ${text ? `<p class="gp-section-text">${e(text)}</p>` : ""}
      </div>
      ${content}
    </section>`;
}

// ==================== HERO ====================

export function heroSection(game, profile, { cover, discussionHref }) {
  const title = profile?.heroTitle || game.title;
  const lead = profile?.lead?.length ? profile.lead : [game.tagline].filter(Boolean);
  const platforms = game.platforms.join(", ");
  const isBrowser = game.platforms.some((p) => /браузер|browser|web/i.test(p));
  return `<section class="gp-hero" aria-labelledby="gameTitle">
      <div class="gp-hero-bg" aria-hidden="true"></div>
      <div class="container gp-hero-inner">
        <div class="gp-hero-copy">
          <nav class="breadcrumbs" aria-label="Навигация"><a href="/games">Игры</a> <span aria-hidden="true">/</span> <span>${e(game.title)}</span></nav>
          ${!game.published ? '<p class="badge status-unknown">Черновик: страница видна только администраторам</p>' : ""}
          <div class="gp-chips">
            ${statusBadge(game.status)}
            ${isBrowser ? `<span class="gp-chip">${icon("globe")}Браузерная игра · без установки</span>` : ""}
          </div>
          <h1 class="gp-title" id="gameTitle">${e(title)}</h1>
          ${profile?.slogan ? `<p class="gp-slogan">${e(profile.slogan)}</p>` : ""}
          ${lead.map((p, i) => `<p class="${i ? "gp-lead-sub" : "gp-lead"}">${e(p)}</p>`).join("")}
          <div class="btn-row gp-actions">
            ${game.websiteUrl ? `<a class="gp-btn-gold btn-lg" href="${e(game.websiteUrl)}" rel="noopener">${icon("play")}Играть в ${e(title)}</a>` : ""}
            ${discussionHref ? `<a class="ghost-btn btn-lg" href="${e(discussionHref)}">${icon("chat")}Обсудить игру</a>` : ""}
          </div>
          <dl class="gp-facts">
            <div><dt>Платформа</dt><dd>${e(platforms || "не указана")}</dd></div>
            ${profile?.genre ? `<div><dt>Жанр</dt><dd>${e(profile.genre)}</dd></div>` : ""}
            ${game.websiteUrl ? `<div><dt>Сайт игры</dt><dd><a href="${e(game.websiteUrl)}" rel="noopener">${e(new URL(game.websiteUrl).host)}</a></dd></div>` : ""}
          </dl>
        </div>
        <figure class="gp-hero-art">
          ${cover ? coverImg(cover, { alt: `Обложка ${game.title}`, priority: true, sizes: "(max-width: 900px) 92vw, 560px" })
    : `<div class="placeholder-art" role="img" aria-label="Обложка ${e(game.title)} ещё не загружена"><strong>${e(game.title)}</strong><small>Обложка скоро появится</small></div>`}
        </figure>
      </div>
    </section>`;
}

/** Навигация по секциям страницы: только по тем, что на странице есть */
export function sectionNav(items) {
  return `<nav class="gp-subnav" aria-label="Разделы страницы игры"><div class="container gp-subnav-inner">
      ${items.map(([id, label]) => `<a href="#${id}">${e(label)}</a>`).join("")}
    </div></nav>`;
}

// ==================== ОБ ИГРЕ, МИРЫ, ОСОБЕННОСТИ ====================

export function aboutSection(game, profile) {
  const paragraphs = profile?.about?.paragraphs || [];
  const body = paragraphs.length
    ? paragraphs.map((p) => `<p>${e(p)}</p>`).join("")
    : (game.description ? richText(game.description) : "");
  const highlights = profile?.about?.highlights || [];
  if (!body && !highlights.length) {
    return section("about", { eyebrow: "Об игре", title: "Об игре" }, emptyCard("Описание пока не добавлено", "Студия расскажет об игре позже."));
  }
  return section("about", { eyebrow: "Об игре", title: profile?.about?.title || "Об игре" }, `<div class="gp-about">
      <div class="rich-text gp-about-text">${body}</div>
      ${highlights.length ? `<div class="gp-panel"><h3 class="gp-panel-title">Основные особенности</h3>
        <ul class="gp-highlights">${highlights.map((h) => `<li>${e(h)}</li>`).join("")}</ul></div>` : ""}
    </div>`);
}

/**
 * Миры: карточка с атмосферной иллюстрацией из CSS (не выдаётся за игровой арт), название, коротко и подробнее.
 * «Подробнее» — <details>: работает без скриптов и с клавиатуры
 */
export function worldsSection(worlds, { title, text = "" }) {
  if (!worlds?.length) return "";
  const cards = worlds.map((w, i) => `<article class="gp-world gp-world--${e(w.theme || `t${i + 1}`)}">
        <div class="gp-world-art" aria-hidden="true"><span class="gp-world-glyph">${e(w.glyph || String(i + 1))}</span></div>
        <div class="gp-world-body">
          ${w.tag ? `<div class="gp-world-tag">${e(w.tag)}</div>` : ""}
          <h3 class="gp-world-name">${e(w.name)}</h3>
          <p class="gp-world-text">${e(w.summary)}</p>
          ${w.details?.length ? `<details class="gp-world-more"><summary>Подробнее о мире</summary>
            ${w.details.map((d) => `<p>${e(d)}</p>`).join("")}</details>` : ""}
        </div>
      </article>`).join("");
  return section("worlds", { eyebrow: "Миры", title, text }, `<div class="gp-worlds">${cards}</div>`);
}

export function featuresSection(features) {
  if (!features?.length) return "";
  return section("features", { eyebrow: "Особенности", title: "Что ждёт в игре" }, `<div class="gp-features">
      ${features.map((f) => `<article class="gp-feature">
        <div class="gp-feature-icon">${icon(f.icon)}</div>
        <h3 class="gp-feature-title">${e(f.title)}</h3>
        ${f.subtitle ? `<div class="gp-feature-sub">${e(f.subtitle)}</div>` : ""}
        <p class="gp-feature-text">${e(f.text)}</p>
      </article>`).join("")}
    </div>`);
}

// ==================== СКРИНШОТЫ ====================

/** Сетка скриншотов из game_media. Полный размер открывает game-page.js (lightbox); без скриптов — ссылка на файл */
export function screenshotsSection(game, media) {
  const content = media.length
    ? `<div class="gp-shots" data-lightbox>
        ${media.map((m, i) => `<figure class="gp-shot">
          <a href="${e(m.url)}" data-lightbox-item data-caption="${e(m.caption)}" aria-label="Открыть скриншот ${i + 1}${m.caption ? `: ${e(m.caption)}` : ""}">
            <img src="${e(m.url)}" alt="${e(m.caption || `Скриншот ${game.title} ${i + 1}`)}" loading="lazy" decoding="async" width="1280" height="720">
          </a>
          ${m.caption ? `<figcaption>${e(m.caption)}</figcaption>` : ""}
        </figure>`).join("")}
      </div>
      <dialog class="gp-lightbox" aria-label="Просмотр скриншота">
        <figure><img alt=""><figcaption></figcaption></figure>
        <button class="gp-lb-btn gp-lb-prev" type="button" aria-label="Предыдущий скриншот">‹</button>
        <button class="gp-lb-btn gp-lb-next" type="button" aria-label="Следующий скриншот">›</button>
        <button class="gp-lb-btn gp-lb-close" type="button" aria-label="Закрыть">×</button>
      </dialog>`
    : emptyCard("Скриншоты появятся позже", "Студия добавит снимки из игры, когда они будут готовы к показу.");
  return section("screenshots", { eyebrow: "Галерея", title: "Скриншоты" }, content);
}

// ==================== ROADMAP ====================

function stageCard(stage, index) {
  const status = stage.status || "planned";
  const done = stage.tasks.filter((t) => t.done).length;
  return `<li class="gp-stage gp-stage--${status}">
      <div class="gp-stage-dot" aria-hidden="true">${index + 1}</div>
      <article class="gp-stage-card">
        <div class="gp-stage-meta">
          <span class="gp-stage-status">${e(ROADMAP_STATUS_LABELS[status])}</span>
          ${stage.date ? `<span class="gp-stage-date">${e(stage.date)}</span>` : ""}
        </div>
        <h3 class="gp-stage-title">${e(stage.title)}</h3>
        ${stage.description ? `<div class="rich-text gp-stage-text">${richText(stage.description)}</div>` : ""}
        ${stage.tasks.length ? `<ul class="gp-tasks">${stage.tasks.map((t) => `<li class="${t.done ? "is-done" : ""}">
            <span class="gp-task-mark" aria-hidden="true">${t.done ? "✓" : ""}</span>
            <span>${e(t.text)}</span><span class="visually-hidden">${t.done ? " — выполнено" : " — не выполнено"}</span></li>`).join("")}</ul>
          <div class="gp-progress">
            <progress max="100" value="${stage.progress}" aria-label="Прогресс этапа «${e(stage.title)}»">${stage.progress}%</progress>
            <span>${done} из ${stage.tasks.length} задач · ${stage.progress}%</span>
          </div>` : ""}
      </article>
    </li>`;
}

/** Roadmap: этапы из поля «Планы» игры (формат — roadmap.js) и публикации вида roadmap */
export function roadmapSection(game, roadmapPosts, postCard, { title }) {
  const parsed = parseRoadmap(game.roadmap);
  let content = "";
  if (parsed) {
    content = `${parsed.intro ? `<div class="rich-text gp-roadmap-intro">${richText(parsed.intro)}</div>` : ""}
      <ol class="gp-timeline">${parsed.stages.map(stageCard).join("")}</ol>`;
  } else if (game.roadmap) {
    content = `<div class="rich-text">${richText(game.roadmap)}</div>`;
  }
  if (roadmapPosts.length) content += `<div class="grid-posts gp-roadmap-posts">${roadmapPosts.map(postCard).join("")}</div>`;
  return section("roadmap", { eyebrow: "Roadmap", title }, content
    || emptyCard("Планы пока не опубликованы", "Roadmap игры появится, когда студия его опубликует."));
}

// ==================== DEVLOG И НОВОСТИ ====================

function devlogCard(post) {
  const date = post.publishedAt || post.createdAt;
  return `<article class="card gp-post">
      <div class="card-media">${post.imageUrl
    ? `<img src="${e(post.imageUrl)}" alt="" loading="lazy" decoding="async" width="1280" height="720">`
    : '<div class="gp-post-art" aria-hidden="true"></div>'}</div>
      <div class="card-body">
        <div class="card-meta"><span class="badge plain">${e(POST_KIND_LABELS[post.kind])}</span><time datetime="${e(isoDate(date))}">${e(formatDate(date))}</time></div>
        <h3 class="card-title"><a href="/studio/${e(post.slug)}">${e(post.title)}</a></h3>
        ${post.summary ? `<p class="card-text">${e(post.summary)}</p>` : ""}
      </div>
    </article>`;
}

/** Devlog с постраничным переходом: ?devlog=N, якорь #devlog. Полная запись — /studio/:slug */
export function devlogSection(game, list, { page, pageSize }) {
  const pages = Math.max(1, Math.ceil(list.total / pageSize));
  const link = (n, label) => `<a class="ghost-btn small-btn" href="/games/${e(game.slug)}${n > 1 ? `?devlog=${n}` : ""}#devlog">${label}</a>`;
  const content = list.posts.length
    ? `<div class="grid-posts">${list.posts.map(devlogCard).join("")}</div>
      ${pages > 1 ? `<nav class="btn-row pager" aria-label="Страницы devlog">${page > 1 ? link(page - 1, "← Новее") : ""}
        <span class="muted">Страница ${page} из ${pages}</span>${page < pages ? link(page + 1, "Раньше →") : ""}</nav>` : ""}`
    : `<div class="empty-card gp-empty"><strong>История разработки только начинается.</strong>
        <p>Здесь появятся записи дневника разработки: что сделано, что меняется и почему.</p></div>`;
  return section("devlog", { eyebrow: "Devlog", title: "Дневник разработки" }, content);
}

export function newsSection(posts) {
  if (!posts.length) return "";
  return section("news", { eyebrow: "Новости", title: "Обновления и новости" }, `<div class="grid-posts">${posts.map(devlogCard).join("")}</div>`);
}

// ==================== СООБЩЕСТВО ====================

/** links: { discuss, idea, bug } — адреса категорий форума; кнопки без адреса не показываются */
export function communitySection(game, { links, threads, knownIssues }) {
  const buttons = [
    [links.discuss, "Обсудить игру", "chat", "gp-btn-gold"],
    [links.idea, "Предложить идею", "idea", "ghost-btn"],
    [links.bug, "Сообщить об ошибке", "bug", "ghost-btn"]
  ].filter(([href]) => href);
  return section("community", { eyebrow: "Сообщество", title: `Стань частью истории ${game.title.toUpperCase()}`,
    text: `Обсуждай игру, предлагай идеи, делись впечатлениями и помогай развивать мир ${game.title.toUpperCase()}.`, className: "gp-community" }, `
      <div class="btn-row gp-community-actions">${buttons.map(([href, label, ic, cls]) => `<a class="${cls}" href="${e(href)}">${icon(ic)}${e(label)}</a>`).join("")}</div>
      <div class="gp-community-grid">
        <div>
          <h3 class="gp-h3">Обсуждения на форуме</h3>
          ${threads.length ? `<div class="list-panel">${threads.map(threadRow).join("")}</div>`
    : emptyCard("Обсуждений пока нет", "Начните первую тему об этой игре.", links.discuss ? `<a class="primary-btn" href="${e(links.discuss)}">Открыть раздел</a>` : "")}
        </div>
        <div>
          <h3 class="gp-h3">Известные проблемы</h3>
          ${knownIssues ? `<div class="rich-text gp-panel">${richText(knownIssues)}</div>`
    : emptyCard("Известных проблем нет в списке", "Нашли ошибку? Расскажите о ней на форуме.", links.bug ? `<a class="ghost-btn" href="${e(links.bug)}">Сообщить об ошибке</a>` : "")}
        </div>
      </div>`);
}

// ==================== СТАТУС ====================

/** rows: [подпись, значение-HTML]. Пустые значения не выводятся: версия и дата показываются, только если известны */
export function statusSection(rows) {
  const visible = rows.filter(([, value]) => value);
  return section("status", { eyebrow: "Статус проекта", title: "Статус проекта" }, `<dl class="gp-status">
      ${visible.map(([label, value]) => `<div class="gp-status-item"><dt>${e(label)}</dt><dd>${value}</dd></div>`).join("")}
    </dl>`);
}
