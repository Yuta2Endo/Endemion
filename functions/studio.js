// Страницы портала Endemion Studio: главная, каталог игр, страница игры, раздел «Разработка» (/studio), публикация,
// «О студии» и условия использования. HTML собирается на сервере из базы (SEO, работает без скриптов)

import { escapeHtml as e } from "./_lib/html.js";
import { adsBlock } from "./_lib/ads.js";
import { renderPage } from "./_lib/layout.js";
import {
  categoryThreads, emptyCard, FORUM_PAGE, formatDate, gameArt, gameCard, gameCategory, gameCategoryIds, getCategoryBySlug,
  getGameBySlug, getPostBySlug, getSettings, isoDate, listGameMedia, listGames, listGamesFiltered, listPosts, GAME_STATUS_LABELS, GAME_STATUS_LABELS_EN, POST_KIND_LABELS, POST_KIND_LABELS_EN, POST_KINDS,
  postCard, recentThreads, richText, statusBadge, threadRow, isGameFavorited,
  listGameReviews, getGameReview, getGameReviewStats
} from "./_lib/studio.js";
import { cleanLine } from "./_lib/validate.js";
import { langOf, t } from "./_lib/i18n.js";
import { LEGAL_UPDATED } from "./_lib/legal/index.js";

/** Дата документа в человеческом виде: 2026-11-06 → «6 ноября 2026 года» */
function formatLegalDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));
}
import { hasRole } from "./_lib/roles.js";
import { currentUser } from "./_lib/session.js";

const REVIEW_BODY_MAX = 5000;
import { coverSources } from "./_lib/gamePage.js";
import { GAME_PROFILES } from "./_lib/gameProfiles.js";

const STYLES = ["studio.css"];
const SCRIPTS = ["studio-page.js"];

/**
 * @param {{ title: string, description: string, url: string, image?: string, type?: string }} opts
 */
function head({ title, description, url, image, type = "website" }) {
  return `<meta property="og:type" content="${e(type)}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(url)}">
  <meta property="og:image" content="${e(image)}">
  <meta name="twitter:card" content="summary_large_image">`;
}

function ld(data) {
  // JSON внутри <script type="application/ld+json"> не исполняется, CSP его пропускает; «<» экранируется от закрытия тега
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function notFoundPage(request, active, text) {
  const body = `<div class="container page">${emptyCard("Страница не найдена", text, '<a class="ghost-btn" href="/games">К играм</a>')}</div>`;
  return renderPage(request, { title: "Не найдено", active, body, styles: STYLES, noindex: true, status: 404 });
}

// ==================== ГЛАВНАЯ ====================

export const home = {
  async onRequestGet({ request, env }) {
    const origin = new URL(request.url).origin;
    const lang = langOf(request);
    const [settings, games, upcoming, threads, devlog, threadTotal] = await Promise.all([
      getSettings(env),
      listGames(env, { upcoming: false }),
      listGames(env, { upcoming: true }),
      recentThreads(env, { limit: 6 }),
      listPosts(env, { kinds: ["devlog"], limit: 1 }),
      env.DB ? env.DB.prepare("SELECT COUNT(*) AS n FROM threads WHERE deleted_at IS NULL").first() : null
    ]);
    const en = lang === "en";
    const s = t(lang);
    const featured = games.find((g) => g.slug === settings.featuredGame) || games[0] || null;
    const discussion = featured ? await gameCategory(env, featured.id) : null;

    // ==================== HERO ====================
    const stats = [
      { value: games.length, label: s.homeStatProjects },
      { value: threadTotal?.n || 0, label: s.homeStatThreads }
    ].filter((stat) => stat.value > 0);
    const hero = `
    <section class="home-hero" aria-labelledby="heroTitle">
      <div class="home-hero-bg" aria-hidden="true">${featured?.coverUrl ? `<img src="${e(featured.coverUrl)}" alt="" fetchpriority="high" decoding="async">` : ""}</div>
      <div class="container home-hero-inner">
        <div class="home-hero-content rise">
          <div class="eyebrow">${e(s.homeEyebrow)}</div>
          <h1 class="display-1" id="heroTitle"><span class="gradient-text">${e(s.homeTitle)}</span></h1>
          <p class="lead">${e(s.homeLead)}</p>
          <div class="btn-row">
            <a class="primary-btn btn-lg" href="/games">${e(s.homeExploreGames)}</a>
            <a class="ghost-btn btn-lg" href="/community">${e(s.homeJoinCommunity)}</a>
          </div>
          ${stats.length ? `<ul class="hero-stats">${stats.map((stat) => `<li><strong>${stat.value}</strong><span>${e(stat.label)}</span></li>`).join("")}</ul>` : ""}
        </div>
        <div class="home-hero-visual rise rise-2" aria-hidden="true">
          <div class="orbit">
            <span class="orbit-ring orbit-ring-1"></span>
            <span class="orbit-ring orbit-ring-2"></span>
            <span class="orbit-ring orbit-ring-3"></span>
            <span class="orbit-dot orbit-dot-1"></span>
            <span class="orbit-dot orbit-dot-2"></span>
            <span class="orbit-core">E</span>
          </div>
        </div>
      </div>
    </section>`;

    // ==================== FEATURED PROJECT ====================
    const featuredBlock = featured ? `
    <section class="home-featured" aria-labelledby="featuredTitle">
      <div class="container">
        <div class="home-featured-grid">
          <div class="home-featured-media">${gameArt(featured, { eager: true, lang })}</div>
          <div class="home-featured-content rise rise-2">
            <div class="eyebrow">${e(s.homeFeaturedProject)}</div>
            <h2 class="display-2" id="featuredTitle">${e(featured.title)}</h2>
            <p class="lead">${e(featured.tagline || featured.description || (en ? s.homeLead : featured.description || s.homeLead))}</p>
            <dl class="featured-facts">
              <dt>${e(s.homeStatus)}</dt><dd>${statusBadge(featured.status, lang)}</dd>
              <dt>${e(s.homePlatforms)}</dt><dd>${e(featured.platforms.join(", ") || (en ? "not set" : "не указаны"))}</dd>
            </dl>
            <div class="btn-row">
              ${featured.websiteUrl ? `<a class="primary-btn" href="${e(featured.websiteUrl)}" rel="noopener">${e(s.homePlayCTA)}</a>` : ""}
              <a class="ghost-btn" href="/games/${e(featured.slug)}">${e(s.homeAboutGameCTA)}</a>
              ${discussion ? `<a class="ghost-btn" href="/community/c/${e(discussion.slug)}">${e(s.homeDiscussionCTA)}</a>` : ""}
            </div>
          </div>
        </div>
      </div>
    </section>` : "";

    // ==================== РЕКЛАМА ====================
    // Блок Яндекс.РСЯ между «Избранным проектом» и «Нашими играми»: реклама не должна отодвигать
    // главное — первый экран и каталог игр — и не должна прятаться в конце страницы
    const adsSection = adsBlock(env, { id: "yandex-ads-home" });

    // ==================== OUR GAMES ====================
    const gamesBlock = `
    <section class="home-games" aria-labelledby="gamesTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.homeOurGames)}</div>
          <h2 id="gamesTitle">${e(s.homeOurGames)}</h2>
        </div>
        <a class="ghost-btn small-btn" href="/games">${e(s.homeAllGames)}</a></div>
      ${games.length ? `<div class="grid-games">${games.map((g) => gameCard(g, lang)).join("")}</div>` : emptyCard(e(s.homeGamesEmptyTitle), e(s.homeGamesEmptyText))}
      </div>
    </section>`;

    // ==================== COMMUNITY ====================
    const communityBlock = `
    <section class="home-community" aria-labelledby="communityTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.homeCommunityLatest)}</div>
          <h2 id="communityTitle">${e(s.homeCommunityLatest)}</h2>
        </div>
        <a class="ghost-btn small-btn" href="/community">${e(s.homeVisitCommunity)}</a></div>
      ${threads.length ? `<div class="list-panel">${threads.map((t) => threadRow(t, lang)).join("")}</div>`
    : emptyCard(e(s.homeCommunityEmptyTitle), e(s.homeCommunityEmptyText), `<a class="primary-btn" href="/community">${e(s.homeVisitCommunity)}</a>`)}
      </div>
    </section>`;

    // ==================== DEVELOPMENT ====================
    const latest = devlog.posts[0] || null;
    const devBlock = latest ? `
    <section class="home-devlog" aria-labelledby="devTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.homeDevUpdates)}</div>
          <h2 id="devTitle">${e(s.homeDevNews)}</h2>
        </div>
        <a class="ghost-btn small-btn" href="/studio?tab=devlog">${e(s.homeAllEntries)}</a></div>
      <article class="panel now-card rise">
        <div class="badge-list"><span class="badge plain">Devlog</span>${latest.game ? `<span class="badge plain">${e(latest.game.title)}</span>` : ""}</div>
        <h3 class="card-title"><a href="/studio/${e(latest.slug)}">${e(latest.title)}</a></h3>
        ${latest.summary ? `<p class="lead">${e(latest.summary)}</p>` : ""}
        <div class="card-meta"><time datetime="${e(isoDate(latest.publishedAt || latest.createdAt))}">${e(formatDate(latest.publishedAt || latest.createdAt))}</time></div>
      </article>
      </div>
    </section>` : "";

    // ==================== UPCOMING PROJECTS ====================
    const upcomingBlock = upcoming.length ? `
    <section class="home-upcoming" aria-labelledby="upcomingTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.homeUpcoming)}</div>
          <h2 id="upcomingTitle">${e(s.homeUpcoming)}</h2>
        </div></div>
      <div class="grid-games">${upcoming.map((g) => gameCard(g, lang)).join("")}</div>
      </div>
    </section>` : "";

    const description = en
      ? "Endemion is an independent game studio and community: our games, the forum, devlogs and development news."
      : "Endemion — независимая игровая студия и сообщество: игры студии, форум, devlog и новости разработки.";
    return renderPage(request, {
      path: "/", active: "home", styles: STYLES, scripts: SCRIPTS, description,
      head: head({ title: "ENDEMION — Create. Play. Connect.", description, url: `${origin}/`, image: `${origin}/assets/og-image.png` })
        + ld({ "@context": "https://schema.org", "@type": "Organization", name: "Endemion", url: `${origin}/` }),
      body: hero + featuredBlock + adsSection + gamesBlock + communityBlock + devBlock + upcomingBlock
    });
  }
};

// ==================== ИГРЫ ====================

export const gamesPage = {
  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const lang = langOf(request);
    const en = lang === "en";
    const s = t(lang);

    const status = url.searchParams.get("status") || undefined;
    const platform = url.searchParams.get("platform") || undefined;
    const search = url.searchParams.get("q") || undefined;
    const sort = url.searchParams.get("sort") || "position";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = 24;
    const offset = (page - 1) * pageSize;

    const validStatuses = new Set(["in_development", "prototype", "released", "planned"]);
    if (status && !validStatuses.has(status)) return notFoundPage(request, "games", en ? "No such filter." : "Такого фильтра нет.");

    const { games, total } = await listGamesFiltered(env, { status, platform, search, sort, limit: pageSize, offset });
    const pages = Math.max(1, Math.ceil(total / pageSize));

    // Доступные платформы из найденных игр (для фильтра)
    const allPlatforms = [...new Set(games.flatMap((g) => g.platforms).flat())].sort();

    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (platform) query.set("platform", platform);
    if (search) query.set("q", search);
    if (sort !== "position") query.set("sort", sort);
    const baseQuery = query.toString();
    // Сброс только параметра поиска, остальные фильтры сохраняются
    const resetQuery = new URLSearchParams();
    if (status) resetQuery.set("status", status);
    if (platform) resetQuery.set("platform", platform);
    if (sort !== "position") resetQuery.set("sort", sort);
    const resetHref = `/games${resetQuery.toString() ? `?${resetQuery.toString()}` : ""}`;
    const pageQuery = (n) => `${baseQuery ? `${baseQuery}&` : ""}page=${n}`;

    const pageHead = `
      <div class="page-head"><div>
        <div class="eyebrow">${e(s.gamesEyebrow)}</div>
        <h1 class="display-2">${e(s.gamesTitle)}</h1>
        <p class="section-text">${e(s.gamesDescription)}</p>
        <p class="muted small games-found">${e(s.gamesResults)}: <strong>${total}</strong></p>
      </div></div>`;

    const filterBar = `
      <form class="games-filter-bar" role="search" action="/games" method="get">
        <div class="filter-group filter-status">
          <label class="filter-label">${e(s.gamesFilterStatus)}</label>
          <div class="chips chips-is-scroll">
            <a class="chip${!status ? " is-active" : ""}" href="/games${baseQuery ? `?${baseQuery}` : ""}">${en ? "All" : "Все"}</a>
            ${["in_development", "prototype", "released", "planned"].map((st) => {
              const active = status === st;
              const label = en ? GAME_STATUS_LABELS_EN[st] : GAME_STATUS_LABELS[st];
              const href = `/games?${new URLSearchParams({ ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(search ? { q: search } : {}), ...(sort !== "position" ? { sort } : {}), status: st }).toString()}`;
              return `<a class="chip${active ? " is-active" : ""}" href="${e(href)}">${e(label)}</a>`;
            }).join("")}
          </div>
        </div>
        <div class="filter-group filter-platform">
          <label class="filter-label">${e(s.gamesFilterPlatform)}</label>
          <div class="chips chips-is-scroll">
            <a class="chip${!platform ? " is-active" : ""}" href="/games${baseQuery ? `?${baseQuery}` : ""}">${en ? "All" : "Все"}</a>
            ${allPlatforms.map((p) => {
              const active = platform === p;
              const href = `/games?${new URLSearchParams({ ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(search ? { q: search } : {}), ...(sort !== "position" ? { sort } : {}), platform: p }).toString()}`;
              return `<a class="chip${active ? " is-active" : ""}" href="${e(href)}">${e(p)}</a>`;
            }).join("")}
          </div>
        </div>
        <div class="filter-group filter-search">
          <label class="visually-hidden" for="gamesSearch">${e(s.gamesFilterSearch)}</label>
          <input class="input" id="gamesSearch" name="q" value="${e(search || "")}" maxlength="80" placeholder="${e(s.gamesFilterSearch)}" aria-label="${e(s.gamesFilterSearch)}">
          ${search ? `<a class="ghost-btn small-btn" href="${e(resetHref)}">${e(s.gamesFilterReset)}</a>` : ""}
          <button class="primary-btn" type="submit">${e(s.find)}</button>
        </div>
        <div class="filter-group filter-sort">
          <label class="filter-label">${e(s.gamesSort)}</label>
          <select class="select" name="sort" aria-label="${e(s.gamesSort)}">
            <option value="position"${sort === "position" ? " selected" : ""}>${e(s.gamesSortPosition)}</option>
            <option value="title_asc"${sort === "title_asc" ? " selected" : ""}>${e(s.gamesSortTitleAsc)}</option>
            <option value="title_desc"${sort === "title_desc" ? " selected" : ""}>${e(s.gamesSortTitleDesc)}</option>
            <option value="newest"${sort === "newest" ? " selected" : ""}>${e(s.gamesSortNewest)}</option>
            <option value="oldest"${sort === "oldest" ? " selected" : ""}>${e(s.gamesSortOldest)}</option>
          </select>
          <noscript><button class="ghost-btn small-btn" type="submit">${en ? "Apply" : "Применить"}</button></noscript>
        </div>
      </form>`;

    const gamesGrid = games.length
      ? `<div class="grid-games grid-games-catalog">${games.map((g) => gameCard(g, lang)).join("")}</div>`
      : emptyCard(e(s.gamesEmptyTitle), e(s.gamesEmptyText), `<a class="ghost-btn" href="/games">${e(s.gamesFilterReset)}</a>`);

    const upcomingGames = games.filter((g) => g.isUpcoming);
    const upcomingBlock = upcomingGames.length ? `
    <section class="studio-section" aria-labelledby="upcomingTitle">
      <div class="section-head"><div><h2 id="upcomingTitle">${e(s.homeUpcoming)}</h2></div></div>
      <div class="grid-games">${upcomingGames.map((g) => gameCard(g, lang)).join("")}</div>
    </section>` : "";

    const pagination = pages > 1
      ? `<nav class="btn-row pager" aria-label="${en ? "Pages" : "Страницы"}">${page > 1 ? `<a class="ghost-btn small-btn" href="/games?${pageQuery(page - 1)}">${en ? "← Back" : "← Назад"}</a>` : ""}<span class="muted">${en ? `Page ${page} of ${pages}` : `Страница ${page} из ${pages}`}</span>${page < pages ? `<a class="ghost-btn small-btn" href="/games?${pageQuery(page + 1)}">${en ? "Next →" : "Дальше →"}</a>` : ""}</nav>`
      : "";

    const body = `
    <div class="container page">
      ${pageHead}
      ${filterBar}
      ${gamesGrid}
      ${upcomingBlock}
      ${pagination}
    </div>`;

    const description = en
      ? "The Endemion game catalog: development status, platforms and links to game pages."
      : "Каталог игр Endemion: статусы разработки, платформы и ссылки на страницы игр.";
    return renderPage(request, {
      title: en ? "Games" : "Игры", path: `/games${baseQuery ? `?${baseQuery}` : ""}`, active: "games", body, styles: STYLES, scripts: SCRIPTS,
      description,
      head: head({ title: `${en ? "Games" : "Игры"} | ENDEMION`, description, url: `${url.origin}${url.pathname}${baseQuery ? `?${baseQuery}` : ""}` })
    });
  }
};

const DEVLOG_PAGE = 6;

export const gamePage = {
  async onRequestGet({ request, env, params }) {
    const url = new URL(request.url);
    const origin = url.origin;
    const lang = langOf(request);
    const en = lang === "en";
    const s = t(lang);
    const game = await getGameBySlug(env, String(params.slug || "").toLowerCase());
    const viewer = await currentUser(env, request);
    if (!game || (!game.published && !hasRole(viewer, "admin"))) return notFoundPage(request, "games", en ? "No such game in the catalog." : "Такой игры нет в каталоге.");

    const profile = GAME_PROFILES[game.slug] || null;
    const devlogPage = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("devlog") || "1", 10) || 1));
    const [media, news, devlog, roadmapPosts, categoryIds, category, ideas, bugs, lastUpdate, isFavorited, userReview, reviews, stats] = await Promise.all([
      listGameMedia(env, game.id),
      listPosts(env, { gameId: game.id, kinds: ["update", "news", "announcement"], limit: 3 }),
      listPosts(env, { gameId: game.id, kinds: ["devlog"], limit: DEVLOG_PAGE, offset: (devlogPage - 1) * DEVLOG_PAGE }),
      listPosts(env, { gameId: game.id, kinds: ["roadmap"], limit: 3 }),
      gameCategoryIds(env, game.id),
      gameCategory(env, game.id),
      getCategoryBySlug(env, "feature-requests"),
      getCategoryBySlug(env, "bug-reports"),
      listPosts(env, { gameId: game.id, kinds: ["update", "devlog", "news", "announcement"], limit: 1 }),
      viewer ? isGameFavorited(env, viewer.id, game.id) : false,
      viewer ? getGameReview(env, viewer.id, game.id) : null,
      listGameReviews(env, game.id),
      getGameReviewStats(env, game.id)
    ]);
    const threads = await recentThreads(env, { limit: 5, categoryIds });

    const cover = coverSources(game, profile);
    const links = {
      discuss: category ? `/community/c/${category.slug}` : null,
      idea: ideas ? `/community/c/${ideas.slug}` : null,
      bug: bugs ? `/community/c/${bugs.slug}` : null
    };
    const latest = lastUpdate.posts[0];
    const latestDate = latest ? latest.publishedAt || latest.createdAt : null;

    // ==================== PREMIUM HERO ====================
    const heroImage = cover
      ? `<img src="${e(cover.src)}"${cover.srcset ? ` srcset="${e(cover.srcset)}" sizes="(max-width: 900px) 92vw, 560px"` : ""} alt="" width="${cover.width}" height="${cover.height}" decoding="async" fetchpriority="high">`
      : `<div class="placeholder-art" role="img" aria-label="${e(s.gameAbout)} ${e(game.title)}"><strong>${e(game.title)}</strong><small>${en ? "Cover coming soon" : "Обложка скоро появится"}</small></div>`;

    const hero = `
    <section class="game-hero" aria-labelledby="gameHeroTitle">
      <div class="game-hero-wrap">
        <div class="game-hero-media rise">${heroImage}</div>
        <div class="game-hero-content rise rise-2">
          <div class="eyebrow">${e(s.gameAbout)}</div>
          <h1 class="display-1" id="gameHeroTitle">${e(game.title)}</h1>
          ${game.tagline ? `<p class="game-tagline lead">${e(game.tagline)}</p>` : ""}
          ${game.description ? `<p class="game-lead">${e(game.description)}</p>` : ""}
          <div class="game-hero-meta">
            <span class="badge status-${game.status || "unknown"}">${e(statusBadge(game.status, lang).replace(/<[^>]*>/g, ""))}</span>
            ${game.platforms.length ? `<span class="badge plain">${e(game.platforms.join(" · "))}</span>` : ""}
            ${profile?.genre ? `<span class="badge plain">${e(profile.genre)}</span>` : ""}
          </div>
          <div class="game-hero-cta">
            ${game.websiteUrl ? `<a class="primary-btn" href="${e(game.websiteUrl)}" rel="noopener" target="_blank">${e(s.gamePlayCTA)}</a>` : ""}
            <a class="ghost-btn" href="#gameAbout">${e(s.gameAboutCTA)}</a>
            ${links.discuss ? `<a class="ghost-btn" href="${e(links.discuss)}">${e(s.gameDiscussCTA)}</a>` : ""}
            ${viewer ? `<button class="ghost-btn game-favorite-btn" data-game-id="${game.id}" data-favorited="${isFavorited ? 1 : 0}" data-favorited-short-added="${e(s.gameAddFavoriteShortCTA)}" data-favorited-short-removed="${e(s.gameRemoveFavoriteShortCTA)}" data-favorited-label-added="${e(s.gameRemoveFavoriteCTA)}" data-favorited-label-removed="${e(s.gameAddFavoriteCTA)}" aria-label="${isFavorited ? e(s.gameRemoveFavoriteCTA) : e(s.gameAddFavoriteCTA)}">${isFavorited ? e(s.gameRemoveFavoriteShortCTA) : e(s.gameAddFavoriteShortCTA)}</button>` : ""}
          </div>
        </div>
      </div>
    </section>`;

    // ==================== СЕКЦИИ ====================
    const aboutSectionHtml = game.description
      ? `<section id="gameAbout" class="game-section" aria-labelledby="gameAboutTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameAbout)}</div>
            <h2 id="gameAboutTitle">${e(s.gameAbout)}</h2>
          </div></div>
          <div class="game-about-text rich-text">${richText(game.description)}</div>
        </div>
      </section>` : "";

    const worldsSectionHtml = profile?.worlds
      ? `<section id="gameWorlds" class="game-section" aria-labelledby="gameWorldsTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(profile.worldsHeading?.title || (en ? "Worlds" : "Миры"))}</div>
            <h2 id="gameWorldsTitle">${e(profile.worldsHeading?.title || (en ? "Worlds" : "Миры"))}</h2>
            ${profile.worldsHeading?.text ? `<p class="section-text">${e(profile.worldsHeading.text)}</p>` : ""}
          </div></div>
          <div class="game-worlds-grid">
            ${profile.worlds.map((w) => `<article class="card">
              <div class="card-body">
                <h3 class="card-title">${e(w.name)}</h3>
                ${w.tag ? `<p class="card-meta">${e(w.tag)}</p>` : ""}
                ${w.summary ? `<p class="card-text">${e(w.summary)}</p>` : ""}
              </div>
            </article>`).join("")}
          </div>
        </div>
      </section>` : "";

    const featuresSectionHtml = profile?.features
      ? `<section id="gameFeatures" class="game-section" aria-labelledby="gameFeaturesTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(profile?.featuresHeading?.title || (en ? "Features" : "Особенности"))}</div>
            <h2 id="gameFeaturesTitle">${e(profile?.featuresHeading?.title || (en ? "Features" : "Особенности"))}</h2>
          </div></div>
          <div class="game-features-grid">
            ${profile.features.map((f) => `<article class="card">
              <div class="card-body">
                <h3 class="card-title">${e(f.title)}</h3>
                ${f.subtitle ? `<p class="card-meta">${e(f.subtitle)}</p>` : ""}
                ${f.text ? `<p class="card-text">${e(f.text)}</p>` : ""}
              </div>
            </article>`).join("")}
          </div>
        </div>
      </section>` : "";

    const screenshotsHtml = media.length
      ? `<section id="gameScreenshots" class="game-section" aria-labelledby="gameScreenshotsTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameScreenshots)}</div>
            <h2 id="gameScreenshotsTitle">${e(s.gameScreenshots)}</h2>
          </div></div>
          <div class="game-shots">
            ${media.map((m) => `<figure>
              <img src="${e(`/media/games/${game.id}/shots/${m.id}`)}" alt="${e(m.caption || game.title)}" loading="lazy" decoding="async" width="1280" height="720">
              ${m.caption ? `<figcaption>${e(m.caption)}</figcaption>` : ""}
            </figure>`).join("")}
          </div>
        </div>
      </section>` : "";

    const roadmapHtml = roadmapPosts.posts.length
      ? `<section id="gameRoadmap" class="game-section" aria-labelledby="gameRoadmapTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameRoadmap)}</div>
            <h2 id="gameRoadmapTitle">${e(s.gameRoadmap)}</h2>
          </div></div>
          <div class="grid-posts">${roadmapPosts.posts.map((p) => postCard(p, lang)).join("")}</div>
        </div>
      </section>` : `<section id="gameRoadmap" class="game-section" aria-labelledby="gameRoadmapTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameRoadmap)}</div>
            <h2 id="gameRoadmapTitle">${e(s.gameRoadmap)}</h2>
          </div></div>
          ${emptyCard(e(s.gameNoRoadmap), "")}
        </div>
      </section>`;

    const newsHtml = news.posts.length
      ? `<section id="gameNews" class="game-section" aria-labelledby="gameNewsTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameNews)}</div>
            <h2 id="gameNewsTitle">${e(s.gameNews)}</h2>
          </div></div>
          <div class="grid-posts">${news.posts.map((p) => postCard(p, lang)).join("")}</div>
        </div>
      </section>` : `<section id="gameNews" class="game-section" aria-labelledby="gameNewsTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameNews)}</div>
            <h2 id="gameNewsTitle">${e(s.gameNews)}</h2>
          </div></div>
          ${emptyCard(e(s.gameNoNews), "")}
        </div>
      </section>`;

    const devlogHtml = devlog.posts.length
      ? `<section id="gameDevlog" class="game-section" aria-labelledby="gameDevlogTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameDevlog)}</div>
            <h2 id="gameDevlogTitle">${e(s.gameDevlog)}</h2>
          </div></div>
          <div class="grid-posts">${devlog.posts.map((p) => postCard(p, lang)).join("")}</div>
        </div>
      </section>` : `<section id="gameDevlog" class="game-section" aria-labelledby="gameDevlogTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameDevlog)}</div>
            <h2 id="gameDevlogTitle">${e(s.gameDevlog)}</h2>
          </div></div>
          ${emptyCard(e(s.gameNoDevlog), "")}
        </div>
      </section>`;

    const communityHtml = links.discuss || threads.length
      ? `<section id="gameCommunity" class="game-section" aria-labelledby="gameCommunityTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameCommunity)}</div>
            <h2 id="gameCommunityTitle">${e(s.gameCommunity)}</h2>
          </div></div>
          ${links.discuss ? `<p class="game-community-intro"><a href="${e(links.discuss)}">${e(s.gameDiscussCTA)} →</a></p>` : ""}
          ${threads.length ? `<div class="list-panel">${threads.map((t) => threadRow(t, lang)).join("")}</div>` : ""}
        </div>
      </section>` : `<section id="gameCommunity" class="game-section" aria-labelledby="gameCommunityTitle">
        <div class="container">
          <div class="section-head"><div>
            <div class="eyebrow">${e(s.gameCommunity)}</div>
            <h2 id="gameCommunityTitle">${e(s.gameCommunity)}</h2>
          </div></div>
          ${emptyCard(e(s.gameNoCommunity), "")}
        </div>
      </section>`;

    // Статусная таблица (сохраняем существующую логику)
    const statusRows = [
      [e(s.gameStatus), statusBadge(game.status, lang)],
      [e(s.gameVersionLabel), profile?.version ? e(profile.version) : ""],
      [e(s.gameLastUpdateLabel), latestDate ? `<a href="/studio/${e(latest.slug)}"><time datetime="${e(isoDate(latestDate))}">${e(formatDate(latestDate))}</time></a>` : ""],
      [e(s.gamePlatformsLabel), e(game.platforms.join(", ") || (en ? "not set" : "не указаны"))],
      [e(s.gameGenreLabel), e(profile?.genre || (en ? "not set" : "не указан"))]
    ];

    // ==================== ОТЗЫВЫ ====================
    const reviewsHtml = `
    <section id="gameReviews" class="game-section" aria-labelledby="gameReviewsTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.gameReviewsTitle)}</div>
          <h2 id="gameReviewsTitle">${e(s.gameReviewsTitle)}</h2>
          ${stats.reviewCount > 0 ? `
          <div class="game-reviews-summary">
            <span class="game-reviews-avg">${stats.avgScore?.toFixed(1) || "–"}</span>
            <span class="game-reviews-avg-label">${e(s.gameReviewsAverage)}</span>
            <span class="game-reviews-count">(${stats.reviewCount})</span>
          </div>` : ""}
        </div></div>
        ${viewer ? `
        <div class="game-review-form" id="gameReviewForm">
          <div class="form-row">
            <label class="form-label">${e(s.gameReviewScoreLabel)}</label>
            <div class="game-score-select" role="radiogroup" aria-label="${e(s.gameReviewScoreLabel)}">
              ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((s) => `
                <button type="button" class="score-btn${userReview?.score === s ? " active" : ""}" data-score="${s}" aria-pressed="${userReview?.score === s}">${s}</button>
              `).join("")}
            </div>
            <input type="hidden" id="reviewScore" value="${userReview?.score ?? ""}">
          </div>
          <div class="form-row">
            <label class="form-label">${e(s.gameReviewTextLabel)}</label>
            <textarea class="textarea" id="reviewBody" maxlength="${REVIEW_BODY_MAX}" rows="4">${userReview?.body ?? ""}</textarea>
            <div class="form-row">
              <label class="check"><input type="checkbox" id="reviewSpoiler"${userReview?.spoiler ? " checked" : ""}> ${e(s.gameReviewSpoilerLabel)}</label>
            </div>
            <button class="primary-btn" id="reviewSubmitBtn" data-edit-text="${e(s.gameReviewEdit)}">${userReview ? e(s.gameReviewEdit) : e(s.gameReviewSubmit)}</button>
            <button class="ghost-btn" id="reviewDeleteBtn"${!userReview ? " hidden" : ""}>${e(s.gameReviewDelete)}</button>
            <button class="ghost-btn" id="reviewCancelBtn" hidden>Отмена</button>
            <p class="form-error" id="reviewMessage" role="status"></p>
          </div>
        </div>
        ` : `
        <div class="game-review-signin">
          <p>${e(s.gameReviewSignIn)}</p>
          <a class="primary-btn" href="/auth?next=${encodeURIComponent(`/games/${game.slug}`)}">${en ? "Sign in" : "Войти"}</a>
        </div>
        `}
        ${reviews.length ? `<div class="game-reviews-list">${reviews.map((r) => `
          <div class="game-review-item${r.spoiler ? " spoiler" : ""}">
            <div class="game-review-header">
              <span class="game-review-author">${e(r.author.name)}</span>
              <span class="game-review-score">${r.score}</span>
              <span class="game-review-date">${e(formatDate(r.created_at))}</span>
            </div>
            <div class="game-review-body${r.spoiler ? " spoiler-hidden" : ""}">
              ${r.spoiler ? `<button class="game-review-reveal" aria-expanded="false">${e(s.gameReviewReveal)}</button>` : ""}
              ${r.body ? `<p${r.spoiler ? ' aria-hidden="true"' : ""}>${e(r.body).replace(/\n/g, "<br>")}</p>` : `<p class="muted"${r.spoiler ? ' aria-hidden="true"' : ""}>${en ? "No text." : "Без текста."}</p>`}
            </div>
            ${viewer && userReview?.id === r.id ? `<button class="ghost-btn small-btn" data-review-id="${r.id}">${e(s.gameReviewDelete)}</button>` : ""}
          </div>
        `).join("")}</div>` : `<div class="empty-card">${e(s.gameReviewsEmpty)}</div>`}
      </div>
    </section>`;
    const statusHtml = `
    <section id="gameStatus" class="game-section" aria-labelledby="gameStatusTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.gameStatus)}</div>
          <h2 id="gameStatusTitle">${e(s.gameStatus)}</h2>
        </div></div>
        <div class="game-status-grid">
          ${statusRows.map(([label, value]) => value ? `<div class="game-status-row"><span class="game-status-label">${label}</span><span class="game-status-value">${value}</span></div>` : "").join("")}
        </div>
      </div>
    </section>`;

    const sectionIds = [
      [aboutSectionHtml, "gameAbout", s.gameAbout],
      [worldsSectionHtml, "gameWorlds", profile?.worldsHeading?.title || (en ? "Worlds" : "Миры")],
      [featuresSectionHtml, "gameFeatures", profile?.featuresHeading?.title || (en ? "Features" : "Особенности")],
      [screenshotsHtml, "gameScreenshots", s.gameScreenshots],
      [roadmapHtml, "gameRoadmap", s.gameRoadmap],
      [newsHtml, "gameNews", s.gameNews],
      [devlogHtml, "gameDevlog", s.gameDevlog],
      [communityHtml, "gameCommunity", s.gameCommunity],
      [reviewsHtml, "gameReviews", s.gameReviewsTitle],
      [statusHtml, "gameStatus", s.gameStatus]
    ].filter(([html]) => html.trim().length > 0);

    const sectionNavHtml = sectionIds.length
      ? `<nav class="game-section-nav" aria-label="${en ? "Sections" : "Разделы"}">
        ${sectionIds.map(([, id, label]) => `<a href="#${id}">${e(label)}</a>`).join("")}
      </nav>`
      : "";

    // ==================== TELEGRAM ====================
    const telegramHtml = `
    <section class="home-telegram" aria-labelledby="telegramTitle">
      <div class="container">
        <div class="section-head"><div>
          <div class="eyebrow">${e(s.telegramEyebrow)}</div>
          <h2 id="telegramTitle">${e(s.telegramTitle)}</h2>
          <p class="section-text">${e(s.telegramText)}</p>
        </div></div>
        <a class="primary-btn btn-lg" href="https://t.me/EndemionOfficial" target="_blank" rel="noopener">${e(s.telegramCTA)}</a>
      </div>
    </section>`;

    const body = `
    <div class="container page">
      ${hero}
      ${sectionNavHtml}
      ${aboutSectionHtml}
      ${worldsSectionHtml}
      ${featuresSectionHtml}
      ${screenshotsHtml}
      ${roadmapHtml}
      ${newsHtml}
      ${devlogHtml}
      ${communityHtml}
      ${telegramHtml}
      ${reviewsHtml}
      ${statusHtml}
      <div class="gp-page-end"></div>
    </div>`;

    const seo = profile?.seo || {};
    const description = seo.description || game.tagline || game.description.slice(0, 200) || `${game.title} — игра Endemion.`;
    const ogTitle = seo.title || `${game.title} | ENDEMION`;
    const image = cover?.og ? `${origin}${cover.og}` : game.coverUrl ? `${origin}${game.coverUrl}` : `${origin}/assets/og-image.png`;
    const pageUrl = `${origin}/games/${game.slug}`;
    return renderPage(request, {
      title: seo.title || game.title, fullTitle: Boolean(seo.title), path: `/games/${game.slug}`, active: "games", body,
      styles: [...STYLES, "game-page.css"], scripts: ["game-page.js"], description, mainClass: "gp-page",
      noindex: !game.published || devlogPage > 1,
      head: head({ title: ogTitle, description, url: pageUrl, image })
        + `\n  <meta property="og:image:alt" content="${e(`Обложка ${game.title}`)}">`
        + `\n  <meta name="twitter:title" content="${e(ogTitle)}">\n  <meta name="twitter:description" content="${e(description)}">`
        + `\n  <meta name="twitter:image" content="${e(image)}">`
        + (cover ? `\n  <link rel="preload" as="image" href="${e(cover.src)}"${cover.srcset ? ` imagesrcset="${e(cover.srcset)}" imagesizes="(max-width: 900px) 92vw, 560px"` : ""} fetchpriority="high">` : "")
        + ld({ "@context": "https://schema.org", "@type": "VideoGame", name: game.title, description, url: pageUrl, image,
          ...(profile?.genre ? { genre: profile.genre } : {}),
          ...(game.platforms.length ? { gamePlatform: game.platforms } : {}),
          ...(game.websiteUrl ? { sameAs: game.websiteUrl } : {}),
          inLanguage: "ru", publisher: { "@type": "Organization", name: "Endemion", url: `${origin}/` } })
    });
  }
};

// ==================== РАЗРАБОТКА (/studio) ====================

/** @type {Array<[string, string, string, string[] | null]>} [ключ вкладки, подпись, подпись EN, виды публикаций или null — все] */
const STUDIO_TABS = [
  ["", "Все", "All", null],
  ["news", "Новости студии", "Studio news", ["news"]],
  ["devlog", "Devlog", "Devlog", ["devlog"]],
  ["updates", "Обновления игр", "Game updates", ["update"]],
  ["roadmap", "Roadmap", "Roadmap", ["roadmap"]],
  ["announcements", "Анонсы", "Announcements", ["announcement"]],
  ["history", "История разработки", "Development history", null]
];
const PAGE_SIZE = 12;

export const studioPage = {
  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const lang = langOf(request);
    const en = lang === "en";
    const tab = STUDIO_TABS.find(([key]) => key === (url.searchParams.get("tab") || "")) || STUDIO_TABS[0];
    const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
    // «История разработки» — архивные публикации; остальные вкладки — опубликованные
    const status = tab[0] === "history" ? "archived" : "published";
    const [list, upcoming] = await Promise.all([
      listPosts(env, { status, kinds: tab[3], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      tab[0] ? Promise.resolve([]) : listGames(env, { upcoming: true })
    ]);
    const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
    const tabLink = (item) => {
      const [key, label, labelEn] = item;
      return `<a href="/studio${key ? `?tab=${key}` : ""}"${key === tab[0] ? ' aria-current="page"' : ""}>${e(en ? labelEn : label)}</a>`;
    };
    const pageLink = (n, label) => `<a class="ghost-btn small-btn" href="/studio?${new URLSearchParams({ ...(tab[0] ? { tab: tab[0] } : {}), page: String(n) })}">${label}</a>`;

    const body = `
    <div class="container page">
      <div class="page-head"><div>
        <div class="eyebrow">Endemion Studio</div>
        <h1 class="display-2">${en ? "Development" : "Разработка"}</h1>
        <p class="section-text">${en ? "Studio news, devlogs, game updates, plans and announcements." : "Новости студии, devlog, обновления игр, планы и анонсы."}</p>
      </div></div>
      <nav class="studio-tabs" aria-label="${en ? "Post types" : "Виды публикаций"}">${STUDIO_TABS.map(tabLink).join("")}</nav>
      ${list.posts.length ? `<div class="grid-posts">${list.posts.map((p) => postCard(p, lang)).join("")}</div>`
    : tab[0]
      ? emptyCard(en ? "No posts yet" : "Публикаций пока нет", en ? "Posts moved to the archive will appear here." : "Здесь появятся публикации, перенесённые в архив.")
      : `<section class="studio-empty" aria-labelledby="studioEmptyTitle">
        <div class="studio-empty-art" aria-hidden="true">
          <div class="orbit"><span class="orbit-ring orbit-ring-1"></span><span class="orbit-ring orbit-ring-2"></span><span class="orbit-core">E</span></div>
        </div>
        <div class="studio-empty-copy">
          <h2 id="studioEmptyTitle">${en ? "The devlog is on its way" : "Дневники ещё в пути"}</h2>
          <p>${en ? "The studio is preparing its first devlog. Meanwhile, look at the games, talk about them on the forum or follow the news in Telegram." : "Студия готовит первый devlog. Пока можно посмотреть игры, обсудить их на форуме или следить за новостями в Telegram."}</p>
          <div class="btn-row">
            <a class="primary-btn" href="/games">${en ? "Our games" : "Наши игры"}</a>
            <a class="ghost-btn" href="/community/c/devlog">${en ? "Devlog on the forum" : "Devlog на форуме"}</a>
            <a class="ghost-btn" href="https://t.me/EndemionOfficial" rel="noopener">Telegram</a>
          </div>
        </div>
      </section>`}
      ${pages > 1 ? `<nav class="btn-row pager" aria-label="${en ? "Pages" : "Страницы"}">${page > 1 ? pageLink(page - 1, en ? "← Back" : "← Назад") : ""}<span class="muted">${en ? `Page ${page} of ${pages}` : `Страница ${page} из ${pages}`}</span>${page < pages ? pageLink(page + 1, en ? "Next →" : "Дальше →") : ""}</nav>` : ""}
      ${upcoming.length ? `<section class="studio-section" aria-labelledby="futureTitle"><div class="section-head"><div><h2 id="futureTitle">${en ? "Upcoming projects" : "Будущие проекты"}</h2></div></div>
        <div class="grid-games">${upcoming.map((g) => gameCard(g, lang)).join("")}</div></section>` : ""}
    </div>`;
    return renderPage(request, {
      title: tab[0] ? (en ? tab[2] : tab[1]) : (en ? "Development" : "Разработка"), path: `/studio${tab[0] ? `?tab=${tab[0]}` : ""}`, active: "studio", body, styles: STYLES, scripts: SCRIPTS,
      description: en ? "Devlogs, news and the roadmap of Endemion studio." : "Devlog, новости и roadmap студии Endemion."
    });
  }
};

export const postPage = {
  async onRequestGet({ request, env, params }) {
    const origin = new URL(request.url).origin;
    const lang = langOf(request);
    const en = lang === "en";
    const post = await getPostBySlug(env, String(params.slug || "").toLowerCase());
    const viewer = post && post.status === "draft" ? await currentUser(env, request) : null;
    if (!post || (post.status === "draft" && !hasRole(viewer, "admin"))) return notFoundPage(request, "studio", en ? "No such post." : "Такой публикации нет.");
    const date = post.publishedAt || post.createdAt;
    const body = `
    <article class="container page post-page">
      <nav class="breadcrumbs" aria-label="${en ? "Breadcrumb" : "Навигация"}"><a href="/studio">${en ? "Development" : "Разработка"}</a> <span aria-hidden="true">/</span> <span>${e((en ? POST_KIND_LABELS_EN : POST_KIND_LABELS)[post.kind])}</span></nav>
      ${post.status !== "published" ? `<p class="badge status-unknown">${post.status === "draft" ? (en ? "Draft: visible to administrators only" : "Черновик: видна только администраторам") : (en ? "Archived" : "В архиве")}</p>` : ""}
      <h1 class="display-2">${e(post.title)}</h1>
      <div class="card-meta">
        <time datetime="${e(isoDate(date))}">${e(formatDate(date))}</time>
        ${post.author ? `<span>${post.author.username ? `<a href="/users/${e(post.author.username)}">${e(post.author.name)}</a>` : e(post.author.name)}</span>` : ""}
        ${post.game ? `<a class="badge plain" href="/games/${e(post.game.slug)}">${e(post.game.title)}</a>` : ""}
      </div>
      ${post.imageUrl ? `<img class="post-image" src="${e(post.imageUrl)}" alt="" fetchpriority="high" width="1280" height="720">` : ""}
      ${post.summary ? `<p class="lead">${e(post.summary)}</p>` : ""}
      <div class="rich-text">${richText(post.body)}</div>
    </article>`;
    const description = post.summary || post.body.slice(0, 200);
    return renderPage(request, {
      title: post.title, path: `/studio/${post.slug}`, active: "studio", body, styles: STYLES, scripts: SCRIPTS, description,
      noindex: post.status === "draft",
      head: head({ type: "article", title: `${post.title} | ENDEMION`, description, url: `${origin}/studio/${post.slug}`,
        image: post.imageUrl ? `${origin}${post.imageUrl}` : `${origin}/assets/og-image.png` })
        + ld({ "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, datePublished: isoDate(date),
          ...(post.author ? { author: { "@type": "Person", name: post.author.name } } : {}), publisher: { "@type": "Organization", name: "Endemion" } })
    });
  }
};

// ==================== О СТУДИИ И УСЛОВИЯ ====================

export const aboutPage = {
  async onRequestGet({ request, env }) {
    const settings = await getSettings(env);
    const directions = [
      ["Endemion Games", "Каталог игр студии.", "/games"],
      ["Endemion Community", "Форум и сообщество игроков.", "/community"],
      ["Endemion Studio", "Devlog, новости и планы разработки.", "/studio"],
      ["Endemion ID", "Единый аккаунт для сайта и игр.", "/auth"],
      ["Endemion Life", "Браузерный симулятор жизни — отдельная игра и сайт.", "https://life.endemion.online"]
    ];
    const body = `
    <div class="container page">
      <div class="page-head"><div>
        <div class="eyebrow">ENDEMION — Create. Play. Connect.</div>
        <h1 class="display-2">О студии</h1>
        <p class="lead">Endemion — независимая игровая студия и сообщество, объединяющее собственные игры, разработку и игроков.</p>
      </div></div>
      ${settings.aboutText ? `<div class="rich-text">${richText(settings.aboutText)}</div>` : ""}
      <section class="studio-section" aria-labelledby="dirTitle">
        <div class="section-head"><div><h2 id="dirTitle">Направления</h2></div></div>
        <div class="grid-posts">${directions.map(([title, text, href]) => `<article class="card"><div class="card-body">
          <h3 class="card-title"><a href="${e(href)}">${e(title)}</a></h3><p class="card-text">${e(text)}</p></div></article>`).join("")}</div>
      </section>
      ${settings.socialLinks.length ? `<section class="studio-section" aria-labelledby="socialTitle"><div class="section-head"><div><h2 id="socialTitle">Мы в соцсетях</h2></div></div>
        <div class="btn-row">${settings.socialLinks.map((l) => `<a class="ghost-btn" href="${e(l.url)}" rel="noopener">${e(l.label)}</a>`).join("")}</div></section>` : ""}
    </div>`;
    return renderPage(request, {
      title: "О студии", path: "/about", active: "about", body, styles: STYLES, scripts: SCRIPTS,
      description: "Endemion — независимая игровая студия и сообщество игроков."
    });
  }
};

export const termsPage = {
  async onRequestGet({ request }) {
    const body = `
    <article class="container page post-page">
      <nav class="breadcrumbs" aria-label="Хлебные крошки"><a href="/">Главная</a><span aria-hidden="true">/</span><span>Условия использования</span></nav>
      <h1 class="display-2">Условия использования</h1>
      <p class="doc-updated">Последнее обновление: <time datetime="${LEGAL_UPDATED}">${formatLegalDate(LEGAL_UPDATED)}</time></p>
      <div class="rich-text">
        <p>Эти условия действуют для сайта endemion.online, форума Endemion Community и аккаунта Endemion ID. Пользуясь сайтом, вы соглашаетесь с ними.</p>
        <h3>Аккаунт</h3>
        <ul><li>Аккаунт Endemion ID общий для сайта и игр Endemion. Вы отвечаете за сохранность пароля и действия в своём аккаунте.</li>
          <li>Удалить аккаунт можно в профиле. Сообщения на форуме после удаления остаются без имени автора, чтобы не пропали ответы других людей.</li></ul>
        <h3>Сообщения на форуме</h3>
        <ul><li>Запрещены спам, оскорбления, угрозы, незаконные материалы и публикация чужих личных данных.</li>
          <li>Спойлеры отмечайте специальной галочкой.</li>
          <li>Модераторы могут скрыть сообщение, закрыть тему или временно ограничить публикации нарушителю.</li>
          <li>О нарушении можно сообщить кнопкой «Пожаловаться» рядом с сообщением.</li></ul>
        <h3>Материалы</h3>
        <p>Игры, тексты и изображения студии принадлежат Endemion. Публикуя сообщение, вы подтверждаете, что имеете право его публиковать.
          Если на сайте размещён ваш материал без разрешения, напишите через <a href="/copyright">форму для правообладателей</a>.</p>
        <h3>Личные данные</h3>
        <p>Как сайт обрабатывает данные, описано в <a href="/privacy">политике конфиденциальности</a>.</p>
      </div>
    </article>`;
    return renderPage(request, { title: "Условия использования", path: "/terms", active: null, body, styles: STYLES, scripts: [...SCRIPTS, "doc.js"],
      description: "Условия использования сайта Endemion и форума Endemion Community." });
  }
};

export { POST_KINDS };

// ==================== ФОРУМ: КАТЕГОРИЯ ====================

/** GET /community/c/:slug — темы категории: закреплённые первыми, поиск, страницы. Новую тему открывает forum-category.js */
export const categoryPage = {
  async onRequestGet({ request, env, params }) {
    const category = await getCategoryBySlug(env, params.slug);
    if (!category) return notFoundPage(request, "community", "Такой категории форума нет.");
    const url = new URL(request.url);
    const query = cleanLine(url.searchParams.get("q") || "").slice(0, 80);
    const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
    const list = await categoryThreads(env, category.id, { page, query });
    const pages = Math.max(1, Math.ceil(list.total / FORUM_PAGE));
    const base = `/community/c/${category.slug}`;
    const pageLink = (n, label) => `<a class="ghost-btn small-btn" href="${e(base)}?${e(new URLSearchParams({ ...(query ? { q: query } : {}), page: String(n) }).toString())}">${label}</a>`;
    const empty = query
      ? emptyCard("Ничего не нашлось", "Попробуйте другие слова или откройте все темы категории.", `<a class="ghost-btn" href="${e(base)}">Все темы</a>`)
      : emptyCard("Тем пока нет", category.staffOnly ? "Здесь появятся публикации команды Endemion." : "Начните первую тему в этой категории.");

    const body = `
    <div class="container page">
      <nav class="breadcrumbs" aria-label="Навигация"><a href="/community">Сообщество</a> <span aria-hidden="true">/</span> <span>${e(category.title)}</span></nav>
      <div class="page-head">
        <div>
          <div class="eyebrow">Форум</div>
          <h1>${e(category.title)}</h1>
          ${category.description ? `<p class="section-text">${e(category.description)}</p>` : ""}
          ${category.gameSlug ? `<p><a class="link-btn" href="/games/${e(category.gameSlug)}">Страница игры →</a></p>` : ""}
        </div>
        <div class="section-actions" id="categoryActions"></div>
      </div>
      <form class="forum-search" role="search" action="${e(base)}" method="get">
        <input class="input" type="search" name="q" value="${e(query)}" maxlength="80" placeholder="Поиск по темам категории…" aria-label="Поиск по темам категории">
        <button class="ghost-btn" type="submit">Найти</button>
      </form>
      ${list.threads.length ? `<div class="list-panel">${list.threads.map(threadRow).join("")}</div>` : empty}
      ${pages > 1 ? `<nav class="btn-row pager" aria-label="Страницы">${page > 1 ? pageLink(page - 1, "← Назад") : ""}<span class="muted">Страница ${page} из ${pages}</span>${page < pages ? pageLink(page + 1, "Дальше →") : ""}</nav>` : ""}
    </div>`;
    return renderPage(request, {
      title: `${category.title} — форум`, path: base, active: "community", body, styles: STYLES,
      scripts: ["forum-category.js"], description: category.description || `Форум Endemion: ${category.title}.`,
      noindex: Boolean(query) || page > 1,
      mainAttrs: `data-category="${e(category.slug)}" data-staff-only="${category.staffOnly ? 1 : 0}"`
    });
  }
};
