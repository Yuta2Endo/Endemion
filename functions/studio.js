// Страницы портала Endemion Studio: главная, каталог игр, страница игры, раздел «Разработка» (/studio), публикация,
// «О студии» и условия использования. HTML собирается на сервере из базы (SEO, работает без скриптов)

import { escapeHtml as e } from "./_lib/html.js";
import { renderPage } from "./_lib/layout.js";
import {
  categoryThreads, emptyCard, FORUM_PAGE, formatDate, gameArt, gameCard, gameCategory, gameCategoryIds, getCategoryBySlug,
  getGameBySlug, getPostBySlug, getSettings, isoDate, listGameMedia, listGames, listPosts, POST_KIND_LABELS, POST_KINDS,
  postCard, recentThreads, richText, statusBadge, threadRow
} from "./_lib/studio.js";
import { cleanLine } from "./_lib/validate.js";
import { hasRole } from "./_lib/roles.js";
import { currentUser } from "./_lib/session.js";

const STYLES = ["studio.css"];
const SCRIPTS = ["studio-page.js"];

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
    const [settings, games, upcoming, threads, posts] = await Promise.all([
      getSettings(env),
      listGames(env, { upcoming: false }),
      listGames(env, { upcoming: true }),
      recentThreads(env, { limit: 6 }),
      listPosts(env, { limit: 3 })
    ]);
    const featured = games.find((g) => g.slug === settings.featuredGame) || games[0] || null;
    const discussion = featured ? await gameCategory(env, featured.id) : null;

    const hero = `
    <section class="studio-hero" aria-labelledby="heroTitle">
      <div class="studio-hero-bg" aria-hidden="true">${featured?.coverUrl ? `<img src="${e(featured.coverUrl)}" alt="" fetchpriority="high">` : ""}</div>
      <div class="container studio-hero-inner">
        <div class="rise">
          <div class="eyebrow">ENDEMION — Create. Play. Connect.</div>
          <h1 class="display-1" id="heroTitle"><span class="gradient-text">Welcome to Endemion</span></h1>
          <p class="lead">An independent game studio creating worlds, experiences, and communities.
            Независимая студия, которая делает игры и собирает вокруг них сообщество.</p>
          <div class="btn-row">
            <a class="primary-btn btn-lg" href="/games">Explore Games</a>
            <a class="ghost-btn btn-lg" href="/community">Join Community</a>
          </div>
        </div>
        ${featured ? `<a class="card rise rise-2" href="/games/${e(featured.slug)}" aria-label="${e(featured.title)}: главная игра студии">
          <div class="card-media">${gameArt(featured, { eager: true })}${statusBadge(featured.status)}</div>
          <div class="card-body"><span class="eyebrow">Главный проект</span><strong class="card-title">${e(featured.title)}</strong></div>
        </a>` : ""}
      </div>
    </section>`;

    const featuredBlock = featured ? `
    <section class="studio-section container" aria-labelledby="featuredTitle">
      <div class="featured">
        <div class="card-media">${gameArt(featured)}</div>
        <div class="featured-body">
          <div class="eyebrow">Featured Game</div>
          <h2 class="display-2" id="featuredTitle">${e(featured.title)}</h2>
          <p class="lead">${e(featured.tagline || featured.description || "Описание появится позже.")}</p>
          <dl class="featured-facts">
            <dt>Статус</dt><dd>${statusBadge(featured.status)}</dd>
            <dt>Платформы</dt><dd>${e(featured.platforms.join(", ") || "не указаны")}</dd>
          </dl>
          <div class="btn-row">
            ${featured.websiteUrl ? `<a class="primary-btn" href="${e(featured.websiteUrl)}" rel="noopener">Играть</a>` : ""}
            <a class="ghost-btn" href="/games/${e(featured.slug)}">Об игре</a>
            ${discussion ? `<a class="ghost-btn" href="/community/c/${e(discussion.slug)}">Обсуждение</a>` : ""}
          </div>
        </div>
      </div>
    </section>` : "";

    const gamesBlock = `
    <section class="studio-section container" aria-labelledby="gamesTitle">
      <div class="section-head"><div><div class="eyebrow">Our Games</div><h2 id="gamesTitle">Наши игры</h2></div>
        <a class="ghost-btn small-btn" href="/games">Все игры →</a></div>
      ${games.length ? `<div class="grid-games">${games.map(gameCard).join("")}</div>` : emptyCard("Игр пока нет", "Каталог появится, когда студия добавит первую игру.")}
    </section>`;

    const communityBlock = `
    <section class="studio-section container" aria-labelledby="communityTitle">
      <div class="section-head"><div><div class="eyebrow">Community</div><h2 id="communityTitle">Последние темы форума</h2></div>
        <a class="ghost-btn small-btn" href="/community">Visit Community →</a></div>
      ${threads.length ? `<div class="list-panel">${threads.map(threadRow).join("")}</div>`
    : emptyCard("Тем пока нет", "Начните первое обсуждение — форум открыт для всех участников.", '<a class="primary-btn" href="/community">Visit Community</a>')}
    </section>`;

    const devBlock = `
    <section class="studio-section container" aria-labelledby="devTitle">
      <div class="section-head"><div><div class="eyebrow">Development Updates</div><h2 id="devTitle">Новости разработки</h2></div>
        <a class="ghost-btn small-btn" href="/studio">Все публикации →</a></div>
      ${posts.posts.length ? `<div class="grid-posts">${posts.posts.map(postCard).join("")}</div>`
    : emptyCard("Публикаций пока нет", "Здесь появятся devlog, новости игр, обновления и планы студии.")}
    </section>`;

    const upcomingBlock = upcoming.length ? `
    <section class="studio-section container" aria-labelledby="upcomingTitle">
      <div class="section-head"><div><div class="eyebrow">Upcoming Projects</div><h2 id="upcomingTitle">Будущие проекты</h2></div></div>
      <div class="grid-games">${upcoming.map(gameCard).join("")}</div>
    </section>` : "";

    const description = "Endemion — независимая игровая студия и сообщество: игры студии, форум, devlog и новости разработки.";
    return renderPage(request, {
      path: "/", active: "home", styles: STYLES, scripts: SCRIPTS, description,
      head: head({ title: "ENDEMION — Create. Play. Connect.", description, url: `${origin}/`, image: `${origin}/assets/og-image.png` })
        + ld({ "@context": "https://schema.org", "@type": "Organization", name: "Endemion", url: `${origin}/` }),
      body: hero + featuredBlock + gamesBlock + communityBlock + devBlock + upcomingBlock
    });
  }
};

// ==================== ИГРЫ ====================

export const gamesPage = {
  async onRequestGet({ request, env }) {
    const [games, upcoming] = await Promise.all([listGames(env, { upcoming: false }), listGames(env, { upcoming: true })]);
    const body = `
    <div class="container page">
      <div class="page-head"><div>
        <div class="eyebrow">Endemion Games</div>
        <h1 class="display-2">Игры студии</h1>
        <p class="section-text">Проекты Endemion: в разработке, прототипы и вышедшие игры.</p>
      </div></div>
      ${games.length ? `<div class="grid-games">${games.map(gameCard).join("")}</div>` : emptyCard("Игр пока нет", "Каталог появится, когда студия добавит первую игру.")}
      ${upcoming.length ? `<section class="studio-section" aria-labelledby="upcomingTitle">
        <div class="section-head"><div><h2 id="upcomingTitle">Будущие проекты</h2></div></div>
        <div class="grid-games">${upcoming.map(gameCard).join("")}</div></section>` : ""}
    </div>`;
    return renderPage(request, {
      title: "Игры", path: "/games", active: "games", body, styles: STYLES, scripts: SCRIPTS,
      description: "Каталог игр Endemion: статусы разработки, платформы и ссылки на страницы игр."
    });
  }
};

export const gamePage = {
  async onRequestGet({ request, env, params }) {
    const origin = new URL(request.url).origin;
    const game = await getGameBySlug(env, String(params.slug || "").toLowerCase());
    const viewer = game && !game.published ? await currentUser(env, request) : null;
    if (!game || (!game.published && !hasRole(viewer, "admin"))) return notFoundPage(request, "games", "Такой игры нет в каталоге.");

    const [media, posts, devlog, categoryIds, category] = await Promise.all([
      listGameMedia(env, game.id),
      listPosts(env, { gameId: game.id, kinds: ["update", "news", "announcement"], limit: 4 }),
      listPosts(env, { gameId: game.id, kinds: ["devlog"], limit: 4 }),
      gameCategoryIds(env, game.id),
      gameCategory(env, game.id)
    ]);
    const roadmapPosts = await listPosts(env, { gameId: game.id, kinds: ["roadmap"], limit: 3 });
    const threads = await recentThreads(env, { limit: 5, categoryIds });

    const facts = `<dl class="featured-facts">
        <dt>Статус</dt><dd>${statusBadge(game.status)}</dd>
        <dt>Платформы</dt><dd>${e(game.platforms.join(", ") || "не указаны")}</dd>
        ${game.websiteUrl ? `<dt>Сайт игры</dt><dd><a href="${e(game.websiteUrl)}" rel="noopener">${e(new URL(game.websiteUrl).host)}</a></dd>` : ""}
      </dl>`;

    const section = (id, title, content) => `<section class="studio-section" aria-labelledby="${id}"><div class="section-head"><div><h2 id="${id}">${e(title)}</h2></div></div>${content}</section>`;
    const postsList = (list, emptyTitle, emptyText) => list.posts.length
      ? `<div class="grid-posts">${list.posts.map(postCard).join("")}</div>` : emptyCard(emptyTitle, emptyText);

    const body = `
    <section class="studio-hero" aria-labelledby="gameTitle">
      <div class="studio-hero-bg" aria-hidden="true">${game.coverUrl ? `<img src="${e(game.coverUrl)}" alt="" fetchpriority="high">` : ""}</div>
      <div class="container studio-hero-inner">
        <div>
          <nav class="breadcrumbs" aria-label="Навигация"><a href="/games">Игры</a> <span aria-hidden="true">/</span> <span>${e(game.title)}</span></nav>
          ${!game.published ? '<p class="badge status-unknown">Черновик: страница видна только администраторам</p>' : ""}
          <h1 class="display-1" id="gameTitle">${e(game.title)}</h1>
          ${game.tagline ? `<p class="lead">${e(game.tagline)}</p>` : ""}
          ${facts}
          <div class="btn-row">
            ${game.websiteUrl ? `<a class="primary-btn btn-lg" href="${e(game.websiteUrl)}" rel="noopener">Перейти к игре</a>` : ""}
            ${category ? `<a class="ghost-btn btn-lg" href="/community/c/${e(category.slug)}">Обсуждение на форуме</a>` : ""}
          </div>
        </div>
        <div class="card"><div class="card-media">${gameArt(game, { eager: true })}</div></div>
      </div>
    </section>
    <div class="container">
      ${section("aboutTitle", "Об игре", game.description ? `<div class="rich-text">${richText(game.description)}</div>` : emptyCard("Описание пока не добавлено", "Студия расскажет об игре позже."))}
      ${media.length ? section("shotsTitle", "Скриншоты", `<div class="shots">${media.map((m) => `<figure><img src="${e(m.url)}" alt="${e(m.caption || `Скриншот ${game.title}`)}" loading="lazy" decoding="async">${m.caption ? `<figcaption>${e(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`) : ""}
      ${section("updatesTitle", "Последние обновления", postsList(posts, "Обновлений пока нет", "Новости и обновления игры появятся здесь."))}
      ${section("devlogTitle", "Devlog", postsList(devlog, "Записей devlog пока нет", "Дневник разработки игры появится здесь."))}
      ${section("roadmapTitle", "Roadmap", game.roadmap || roadmapPosts.posts.length
    ? `${game.roadmap ? `<div class="rich-text">${richText(game.roadmap)}</div>` : ""}${roadmapPosts.posts.length ? `<div class="grid-posts">${roadmapPosts.posts.map(postCard).join("")}</div>` : ""}`
    : emptyCard("Планы пока не опубликованы", "Roadmap игры появится, когда студия его опубликует."))}
      ${section("issuesTitle", "Известные проблемы", game.knownIssues ? `<div class="rich-text">${richText(game.knownIssues)}</div>` : emptyCard("Известных проблем нет в списке", category ? "Нашли ошибку? Сообщите о ней на форуме." : "Нашли ошибку? Сообщите о ней на форуме в разделе «Сообщения об ошибках»."))}
      ${section("threadsTitle", "Обсуждения на форуме", threads.length ? `<div class="list-panel">${threads.map(threadRow).join("")}</div>`
    : emptyCard("Обсуждений пока нет", "Начните первую тему об этой игре.", category ? `<a class="primary-btn" href="/community/c/${e(category.slug)}">Открыть раздел</a>` : ""))}
    </div>`;

    const description = game.tagline || game.description.slice(0, 200) || `${game.title} — игра Endemion.`;
    return renderPage(request, {
      title: game.title, path: `/games/${game.slug}`, active: "games", body, styles: STYLES, scripts: SCRIPTS, description,
      noindex: !game.published,
      head: head({ title: `${game.title} | ENDEMION`, description, url: `${origin}/games/${game.slug}`, image: game.coverUrl ? `${origin}${game.coverUrl}` : `${origin}/assets/og-image.png` })
        + ld({ "@context": "https://schema.org", "@type": "VideoGame", name: game.title, description, url: `${origin}/games/${game.slug}`,
          ...(game.platforms.length ? { gamePlatform: game.platforms } : {}), publisher: { "@type": "Organization", name: "Endemion" } })
    });
  }
};

// ==================== РАЗРАБОТКА (/studio) ====================

/** @type {Array<[string, string, string[] | null]>} [ключ вкладки, подпись, виды публикаций или null — все] */
const STUDIO_TABS = [
  ["", "Все", null],
  ["news", "Новости студии", ["news"]],
  ["devlog", "Devlog", ["devlog"]],
  ["updates", "Обновления игр", ["update"]],
  ["roadmap", "Roadmap", ["roadmap"]],
  ["announcements", "Анонсы", ["announcement"]],
  ["history", "История разработки", null]
];
const PAGE_SIZE = 12;

export const studioPage = {
  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const tab = STUDIO_TABS.find(([key]) => key === (url.searchParams.get("tab") || "")) || STUDIO_TABS[0];
    const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
    // «История разработки» — архивные публикации; остальные вкладки — опубликованные
    const status = tab[0] === "history" ? "archived" : "published";
    const [list, upcoming] = await Promise.all([
      listPosts(env, { status, kinds: tab[2], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      tab[0] ? Promise.resolve([]) : listGames(env, { upcoming: true })
    ]);
    const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
    const tabLink = (item) => {
      const [key, label] = item;
      return `<a href="/studio${key ? `?tab=${key}` : ""}"${key === tab[0] ? ' aria-current="page"' : ""}>${e(label)}</a>`;
    };
    const pageLink = (n, label) => `<a class="ghost-btn small-btn" href="/studio?${new URLSearchParams({ ...(tab[0] ? { tab: tab[0] } : {}), page: String(n) })}">${label}</a>`;

    const body = `
    <div class="container page">
      <div class="page-head"><div>
        <div class="eyebrow">Endemion Studio</div>
        <h1 class="display-2">Разработка</h1>
        <p class="section-text">Новости студии, devlog, обновления игр, планы и анонсы.</p>
      </div></div>
      <nav class="studio-tabs" aria-label="Виды публикаций">${STUDIO_TABS.map(tabLink).join("")}</nav>
      ${list.posts.length ? `<div class="grid-posts">${list.posts.map(postCard).join("")}</div>`
    : emptyCard("Публикаций пока нет", tab[0] === "history" ? "Здесь появятся публикации, перенесённые в архив." : "Студия ещё ничего не опубликовала в этом разделе.")}
      ${pages > 1 ? `<nav class="btn-row pager" aria-label="Страницы">${page > 1 ? pageLink(page - 1, "← Назад") : ""}<span class="muted">Страница ${page} из ${pages}</span>${page < pages ? pageLink(page + 1, "Дальше →") : ""}</nav>` : ""}
      ${upcoming.length ? `<section class="studio-section" aria-labelledby="futureTitle"><div class="section-head"><div><h2 id="futureTitle">Будущие проекты</h2></div></div>
        <div class="grid-games">${upcoming.map(gameCard).join("")}</div></section>` : ""}
    </div>`;
    return renderPage(request, {
      title: tab[0] ? tab[1] : "Разработка", path: `/studio${tab[0] ? `?tab=${tab[0]}` : ""}`, active: "studio", body, styles: STYLES, scripts: SCRIPTS,
      description: "Devlog, новости и roadmap студии Endemion."
    });
  }
};

export const postPage = {
  async onRequestGet({ request, env, params }) {
    const origin = new URL(request.url).origin;
    const post = await getPostBySlug(env, String(params.slug || "").toLowerCase());
    const viewer = post && post.status === "draft" ? await currentUser(env, request) : null;
    if (!post || (post.status === "draft" && !hasRole(viewer, "admin"))) return notFoundPage(request, "studio", "Такой публикации нет.");
    const date = post.publishedAt || post.createdAt;
    const body = `
    <article class="container page post-page">
      <nav class="breadcrumbs" aria-label="Навигация"><a href="/studio">Разработка</a> <span aria-hidden="true">/</span> <span>${e(POST_KIND_LABELS[post.kind])}</span></nav>
      ${post.status !== "published" ? `<p class="badge status-unknown">${post.status === "draft" ? "Черновик: видна только администраторам" : "В архиве"}</p>` : ""}
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
      <h1 class="display-2">Условия использования</h1>
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
    return renderPage(request, { title: "Условия использования", path: "/terms", active: null, body, styles: STYLES, scripts: SCRIPTS,
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
      title: `${category.title} — форум`, path: base, active: "community", body, styles: ["ency.css", ...STYLES],
      scripts: ["forum-category.js"], description: category.description || `Форум Endemion: ${category.title}.`,
      noindex: Boolean(query) || page > 1,
      mainAttrs: `data-category="${e(category.slug)}" data-staff-only="${category.staffOnly ? 1 : 0}"`
    });
  }
};
