// Страницы разделов ENDEMION: главная, каталог, Nexus, Oracle, Pulse, сообщество, Арена, профили, обсуждения, подборки.
// Сервер отдаёт каркас страницы (шапка, заголовки, контейнеры, скелеты), данные подгружает скрипт раздела из public/assets.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { escapeHtml as e } from "./_lib/html.js";
import { renderPage, sectionHeading, SLOGAN, svgIcon } from "./_lib/layout.js";
import { TYPES } from "./_lib/titles.js";

const skeletonCards = (n) => Array.from({ length: n }, () =>
  `<div class="t-skeleton" aria-hidden="true"><div class="skeleton"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>`).join("");

const rail = (id, n = 6) => `<div class="rail" id="${id}" aria-busy="true">${skeletonCards(n)}</div>`;

const TYPE_SYMBOLS = { manga: "漫", manhwa: "만", manhua: "画" };

/** GET / — главная */
export const home = {
  async onRequestGet({ request }) {
    const types = Object.entries(TYPES).map(([key, type]) => `<a class="type-tile" href="/catalog?type=${key}">
        <i aria-hidden="true">${TYPE_SYMBOLS[key]}</i>
        <strong>${e(type.label)}</strong>
        <span>${e(type.country)} · ${e(type.format)}</span>
        <small id="count-${key}">&nbsp;</small>
      </a>`).join("");
    const body = `
    <section class="container home-hero" aria-labelledby="heroTitle">
      <div>
        <div class="eyebrow">Твоя новая книжная орбита</div>
        <h1 id="heroTitle">Читай.<br>Чувствуй.<br><span class="accent">Повторяй.</span></h1>
        <p class="hero-text">ENDEMION — платформа для читателей манги, манхвы и маньхуа. Находи истории по настроению,
          смотри, как они связаны между собой, отмечай прочитанное и обсуждай с теми, кто читает то же самое.</p>
        <form class="search-box" action="/catalog" method="get" role="search">
          ${svgIcon("search")}
          <label class="visually-hidden" for="heroSearch">Поиск по каталогу</label>
          <input id="heroSearch" name="q" type="search" placeholder="Название, автор или жанр…" autocomplete="off" maxlength="100">
          <button class="primary-btn" type="submit">Найти</button>
        </form>
        <div class="hero-actions">
          <a class="ghost-btn" href="/oracle">✦ Подобрать по настроению</a>
          <a class="ghost-btn" href="/nexus">◎ Карта связей</a>
        </div>
        <div class="hero-stats" id="heroStats" aria-live="polite"></div>
      </div>
      <div class="hero-orbit" id="heroOrbit" aria-label="Сейчас в центре внимания">
        <div class="orbit-core" aria-hidden="true"></div>
        <div class="orbit-note"><span>ENDEMION pick</span>Discover Your Next Obsession</div>
      </div>
    </section>

    <div class="container">
      <section class="section" aria-label="Форматы"><div class="types-row">${types}</div></section>

      <section class="section" id="continueSection" aria-labelledby="continueTitle" hidden>
        ${sectionHeading({ eyebrow: "Pulse", title: "Продолжить чтение", id: "continueTitle", actions: '<a class="ghost-btn small-btn" href="/pulse">Вся полка →</a>' })}
        <div class="cards-wide" id="continueList"></div>
      </section>

      <section class="section" id="forYouSection" aria-labelledby="forYouTitle">
        ${sectionHeading({ eyebrow: "Oracle", title: "Для тебя", id: "forYouTitle", text: "Подборка по твоей полке, оценкам и любимым жанрам.", actions: '<div class="section-actions" id="forYouControls"></div>' })}
        <div id="forYouBody">${rail("forYouRail")}</div>
      </section>

      <section class="section" aria-labelledby="popularTitle">
        ${sectionHeading({ eyebrow: "В центре внимания", title: "Популярное", id: "popularTitle", text: "Чаще всего добавляют на полку, в избранное и оценивают.", actions: '<div class="section-actions" id="popularControls"></div>' })}
        ${rail("popularRail")}
      </section>

      <section class="section" aria-labelledby="freshTitle">
        ${sectionHeading({ eyebrow: "Только в каталоге", title: "Новинки", id: "freshTitle", actions: '<div class="section-actions" id="freshControls"></div>' })}
        ${rail("freshRail")}
      </section>

      <section class="section" aria-labelledby="updatedTitle">
        ${sectionHeading({ eyebrow: "Свежий выпуск", title: "Недавно обновлённые", id: "updatedTitle", text: "Тайтлы, у которых вышли новые главы.", actions: '<a class="ghost-btn small-btn" href="/pulse#calendar">Календарь →</a>' })}
        <div class="update-list" id="updatedList" aria-busy="true"></div>
      </section>

      <section class="section" aria-labelledby="moodsTitle">
        ${sectionHeading({ eyebrow: "Подборки по настроению", title: "Под настроение", id: "moodsTitle", text: "Тайтлы подобраны по атмосфере, герою и сюжету. Больше настроений — в Oracle." })}
        <div class="tabs-bar" id="moodTabs" role="tablist" aria-label="Настроение"></div>
        <div id="moodBody">${rail("moodRail")}</div>
      </section>

      <section class="section discover" aria-labelledby="discoverTitle">
        <div>
          <div class="eyebrow">Discover Your Next Obsession</div>
          <h2 id="discoverTitle">Открой свою следующую историю</h2>
          <p class="section-text">Выбери настроение — или доверься случаю. ENDEMION предложит то, чего ещё нет на твоей полке.</p>
          <div class="mood-links">
            <a class="chip" href="/oracle?mood=strong_hero">Сильный герой</a>
            <a class="chip" href="/oracle?mood=dark">Мрачное</a>
            <a class="chip" href="/oracle?mood=romance">Романтика</a>
            <a class="chip" href="/oracle?mood=adventure">Приключения</a>
            <a class="chip" href="/oracle?mood=twist">Неожиданная концовка</a>
            <a class="chip" href="/oracle?mood=hidden_gem">Малоизвестная жемчужина</a>
          </div>
          <div class="hero-actions"><button class="primary-btn" id="randomButton" type="button">🎲 Случайная история</button></div>
        </div>
        <div class="discover-result" id="randomResult" aria-live="polite"></div>
      </section>

      <section class="section" id="collectionsSection" aria-labelledby="collectionsTitle" hidden>
        ${sectionHeading({ eyebrow: "Сообщество", title: "Подборки читателей", id: "collectionsTitle", actions: '<a class="ghost-btn small-btn" href="/community#collections">Все подборки →</a>' })}
        <div class="collection-cards" id="collectionList"></div>
      </section>

      <section class="section" aria-labelledby="topTitle">
        ${sectionHeading({ eyebrow: "Выбор редакции", title: "Высшая оценка", id: "topTitle", actions: '<div class="section-actions" id="topControls"></div>' })}
        ${rail("topRail")}
      </section>
    </div>`;
    return renderPage(request, {
      path: "/", active: "home", body, scripts: ["home.js"],
      description: `ENDEMION — ${SLOGAN} Каталог манги, манхвы и маньхуа, рекомендации по настроению, карта связей между историями и сообщество читателей.`
    });
  }
};

/** GET /catalog — каталог с поиском, фильтрами и сортировкой. Состояние фильтров хранится в адресе */
export const catalog = {
  async onRequestGet({ request }) {
    const typeChips = [["", "Все"], ...Object.entries(TYPES).map(([key, type]) => [key, type.label])]
      .map(([key, label]) => `<button class="chip" type="button" data-filter="type" data-value="${key}" aria-pressed="false">${e(label)}<small data-count-type="${key}"></small></button>`).join("");
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Каталог</div>
          <h1>Выбери свою историю</h1>
          <p class="section-text">Поиск по названию, автору и жанру, фильтры по типу и статусу выпуска, сортировка по популярности, оценке и новизне.</p>
        </div>
      </div>
      <div class="catalog-layout">
        <aside class="filters" id="filters" aria-labelledby="filtersTitle">
          <div class="section-head"><h2 id="filtersTitle">Фильтры</h2><button class="link-btn" id="resetFilters" type="button">Сбросить</button></div>
          <div class="filter-group"><span>Тип</span><div class="chips">${typeChips}</div></div>
          <div class="filter-group"><span>Выпуск</span><div class="chips">
            <button class="chip" type="button" data-filter="status" data-value="" aria-pressed="false">Любой</button>
            <button class="chip" type="button" data-filter="status" data-value="ongoing" aria-pressed="false">Выходит<small data-count-status="ongoing"></small></button>
            <button class="chip" type="button" data-filter="status" data-value="completed" aria-pressed="false">Завершён<small data-count-status="completed"></small></button>
          </div></div>
          <div class="filter-group" id="shelfGroup" hidden><span>Моя полка</span><div class="chips" id="shelfChips"></div></div>
          <div class="filter-group"><span>Жанр</span><div class="chips" id="genreChips"></div></div>
          <div class="filter-group"><label for="tagSelect">Атмосфера, герой, сюжет</label><select class="select" id="tagSelect"><option value="">Любые</option></select></div>
          <button class="primary-btn filters-toggle" id="filtersDone" type="button">Показать</button>
        </aside>
        <div>
          <div class="catalog-bar">
            <form class="search-box" id="searchForm" role="search">
              ${svgIcon("search")}
              <label class="visually-hidden" for="searchInput">Поиск по каталогу</label>
              <input id="searchInput" type="search" placeholder="Название, автор или жанр…" autocomplete="off" maxlength="100">
            </form>
            <label class="visually-hidden" for="fieldSelect">Где искать</label>
            <select class="select" id="fieldSelect">
              <option value="all">Везде</option><option value="title">В названии</option><option value="author">По автору</option><option value="genre">По жанру</option>
            </select>
            <label class="visually-hidden" for="sortSelect">Сортировка</label>
            <select class="select" id="sortSelect"></select>
          </div>
          <div class="catalog-summary">
            <p id="resultsStatus" role="status" aria-live="polite">Загрузка…</p>
            <button class="ghost-btn small-btn filters-toggle" id="filtersOpen" type="button" aria-controls="filters" aria-expanded="false">Фильтры</button>
          </div>
          <div class="cards" id="titleGrid" aria-busy="true">${skeletonCards(12)}</div>
          <div class="load-more"><button class="ghost-btn" id="loadMore" type="button" hidden>Показать ещё</button></div>
        </div>
      </div>
    </div>`;
    return renderPage(request, {
      title: "Каталог манги, манхвы и маньхуа", path: "/catalog", active: "catalog", body, scripts: ["catalog.js"],
      description: "Каталог ENDEMION: поиск по названию, автору и жанру, фильтры по типу и статусу, сортировка по популярности, оценке и новизне."
    });
  }
};

/** GET /nexus — карта связей между тайтлами */
export const nexus = {
  async onRequestGet({ request }) {
    const focus = [["", "Все связи"], ["genre", "Жанры"], ["mood", "Атмосфера"], ["hero", "Главный герой"], ["plot", "Сюжет"], ["theme", "Темы"], ["setting", "Мир"], ["author", "Автор"]]
      .map(([key, label]) => `<button class="chip" type="button" data-focus="${key}" aria-pressed="${key === "" ? "true" : "false"}">${label}</button>`).join("");
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">ENDEMION Nexus</div>
          <h1>Карта связей</h1>
          <p class="section-text">Истории связаны жанрами, атмосферой, героями, сюжетом, темами и общими читателями.
            Выбери тайтл — Nexus покажет похожие и объяснит, чем именно они похожи.</p>
        </div>
        <div class="page-head-tool" id="nexusPicker"></div>
      </div>
      <div class="chips is-scroll" id="focusChips" role="group" aria-label="По чему искать связи">${focus}</div>
      <div class="nexus-layout section">
        <div class="nexus-stage" id="nexusStage" aria-busy="true">
          <p class="nexus-hint">Перетаскивай узлы · нажми, чтобы выбрать · двойное нажатие — сделать центром</p>
          <div class="state"><span class="spinner"></span>Строим карту…</div>
        </div>
        <aside class="nexus-detail" id="nexusDetail" aria-live="polite"></aside>
      </div>
    </div>`;
    return renderPage(request, {
      title: "Nexus — карта связей между историями", path: "/nexus", active: "nexus", body, scripts: ["nexus.js"],
      description: "ENDEMION Nexus: интерактивная карта похожих манги, манхвы и маньхуа с объяснением, почему они связаны."
    });
  }
};

/** GET /oracle — рекомендации по настроению */
export const oracle = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">ENDEMION Oracle</div>
          <h1>Что почитать сегодня?</h1>
          <p class="section-text">Выбери настроение. Oracle подберёт истории по тегам атмосферы, героя и сюжета, а если ты вошёл —
            учтёт полку, оценки и любимые жанры. Под каждой рекомендацией написано, почему она здесь.</p>
        </div>
      </div>
      <div class="moods" id="moods" role="group" aria-label="Настроение"></div>
      <div class="oracle-options">
        <div id="similarBox" hidden></div>
        <label class="form-row"><span class="form-label">Тип</span>
          <select class="select" id="oracleType"><option value="">Любой</option>${Object.entries(TYPES).map(([key, type]) => `<option value="${key}">${e(type.label)}</option>`).join("")}</select>
        </label>
        <label class="check" id="seenBox" hidden><input type="checkbox" id="oracleSeen"> Показывать то, что уже на полке</label>
      </div>
      <p class="oracle-note" id="oracleNote" aria-live="polite"></p>
      <div class="cards-wide" id="oracleResults"></div>
    </div>`;
    return renderPage(request, {
      title: "Oracle — рекомендации по настроению", path: "/oracle", active: "oracle", body, scripts: ["oracle.js"],
      description: "ENDEMION Oracle: подбор манги, манхвы и маньхуа по настроению — сильный герой, мрачная история, романтика, приключения, неожиданная концовка."
    });
  }
};

/** GET /pulse — полка чтения, календарь, уведомления */
export const pulse = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">ENDEMION Pulse</div>
          <h1>Моё чтение</h1>
          <p class="section-text">Полка по статусам, прогресс по главам, календарь выхода и уведомления о новых главах.</p>
        </div>
      </div>
      <div class="tabs-bar" role="tablist" aria-label="Разделы Pulse">
        <button type="button" role="tab" data-tab="reading" aria-selected="true">Читаю</button>
        <button type="button" role="tab" data-tab="shelf" aria-selected="false">Полка</button>
        <button type="button" role="tab" data-tab="calendar" aria-selected="false">Календарь</button>
        <button type="button" role="tab" data-tab="notifications" aria-selected="false">Уведомления<span class="count-pill" id="pulseUnread" hidden></span></button>
        <button type="button" role="tab" data-tab="history" aria-selected="false">История</button>
        <button type="button" role="tab" data-tab="settings" aria-selected="false">Настройки</button>
      </div>
      <div id="pulseBody" role="tabpanel" aria-live="polite"><div class="stack">${'<div class="skeleton skeleton-row"></div>'.repeat(4)}</div></div>
    </div>`;
    return renderPage(request, {
      title: "Pulse — полка и уведомления", path: "/pulse", active: "pulse", body, scripts: ["pulse.js"], noindex: true
    });
  }
};

/** GET /community — обсуждения, теории, подборки, читатели */
export const community = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">ENDEMION Community</div>
          <h1>Сообщество</h1>
          <p class="section-text">Обсуждения и теории, подборки читателей и люди, на которых стоит подписаться.</p>
        </div>
        <div class="section-actions" id="communityActions"></div>
      </div>
      <div class="tabs-bar" role="tablist" aria-label="Разделы сообщества">
        <button type="button" role="tab" data-tab="threads" aria-selected="true">Обсуждения</button>
        <button type="button" role="tab" data-tab="theories" aria-selected="false">Теории</button>
        <button type="button" role="tab" data-tab="collections" aria-selected="false">Подборки</button>
        <button type="button" role="tab" data-tab="readers" aria-selected="false">Читатели</button>
      </div>
      <div id="communityBody" role="tabpanel" aria-live="polite"></div>
    </div>`;
    return renderPage(request, {
      title: "Сообщество читателей", path: "/community", active: "community", body, scripts: ["community.js"],
      description: "Сообщество ENDEMION: обсуждения и теории о манге, манхве и маньхуа, подборки читателей."
    });
  }
};

/** GET /community/thread/:id — обсуждение или теория с комментариями */
export const threadPage = {
  async onRequestGet({ request, params }) {
    const body = `
    <div class="container page">
      <nav class="breadcrumbs" aria-label="Навигация"><a href="/community">Сообщество</a> <span aria-hidden="true">/</span> <span id="crumb">Обсуждение</span></nav>
      <div class="split section">
        <div class="stack">
          <article class="post" id="post" aria-busy="true"><div class="skeleton skeleton-row"></div></article>
          <section class="panel" aria-labelledby="commentsTitle"><h2 id="commentsTitle">Комментарии</h2><div id="comments"></div></section>
        </div>
        <aside class="stack" id="threadAside"></aside>
      </div>
    </div>`;
    return renderPage(request, {
      title: "Обсуждение", active: "community", body, scripts: ["thread.js"], path: `/community/thread/${encodeURIComponent(params.id)}`,
      mainAttrs: `data-thread-id="${e(params.id)}"`
    });
  }
};

/** GET /collection/:id — подборка читателя */
export const collectionPage = {
  async onRequestGet({ request, params }) {
    const body = `
    <div class="container page">
      <nav class="breadcrumbs" aria-label="Навигация"><a href="/community#collections">Подборки</a> <span aria-hidden="true">/</span> <span id="crumb">Подборка</span></nav>
      <div id="collectionHead" class="section" aria-busy="true"></div>
      <div class="cards section" id="collectionItems">${skeletonCards(6)}</div>
      <section class="panel section" aria-labelledby="commentsTitle"><h2 id="commentsTitle">Комментарии</h2><div id="comments"></div></section>
    </div>`;
    return renderPage(request, {
      title: "Подборка", active: "community", body, scripts: ["collection.js"], path: `/collection/${encodeURIComponent(params.id)}`,
      mainAttrs: `data-collection-id="${e(params.id)}"`
    });
  }
};

/** GET /arena — голосования, турниры, таблицы лидеров */
export const arena = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">ENDEMION Arena</div>
          <h1>Арена</h1>
          <p class="section-text">Голосуй за персонажей и истории, сравнивай героев, устраивай турниры. Все результаты — только по голосам читателей.</p>
        </div>
        <div class="section-actions" id="arenaActions"></div>
      </div>
      <div class="tabs-bar" role="tablist" aria-label="Разделы Арены">
        <button type="button" role="tab" data-tab="polls" aria-selected="true">Голосования</button>
        <button type="button" role="tab" data-tab="tournaments" aria-selected="false">Турниры</button>
        <button type="button" role="tab" data-tab="leaders" aria-selected="false">Лидеры</button>
      </div>
      <div id="arenaBody" role="tabpanel" aria-live="polite"></div>
    </div>`;
    return renderPage(request, {
      title: "Арена — голосования и турниры", path: "/arena", active: "arena", body, scripts: ["arena.js"],
      description: "ENDEMION Arena: голосования за персонажей, сравнение героев, турниры и таблицы лидеров по голосам читателей."
    });
  }
};

/** GET /u/:username — публичный профиль читателя */
export const userPage = {
  async onRequestGet({ request, params }) {
    const body = `
    <div class="container page" id="userPage" aria-busy="true">
      <div class="profile-hero"><div class="skeleton avatar-dot avatar-lg"></div><div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div></div>
    </div>`;
    return renderPage(request, {
      title: "Профиль читателя", active: null, body, scripts: ["user.js"], path: `/u/${encodeURIComponent(params.username)}`,
      mainAttrs: `data-username="${e(params.username)}"`
    });
  }
};

/** GET /profile — свой профиль ENDEMION ID: статистика, полка, достижения, настройки */
export const profile = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page" id="profile" hidden>
      <section class="profile-hero" aria-labelledby="profileName">
        <div id="avatar"></div>
        <div>
          <h1 id="profileName"></h1>
          <p class="profile-handle"><a id="profileHandle" href="/"></a></p>
          <p class="profile-email muted small" id="profileEmail"></p>
          <p class="profile-bio" id="profileBio"></p>
          <p class="muted small" id="profileSince"></p>
        </div>
        <div class="profile-buttons">
          <a class="ghost-btn" id="publicLink" href="/">Публичный профиль</a>
          <a class="ghost-btn" id="adminLink" href="/admin" hidden>Админка</a>
          <button class="danger-btn" id="logoutButton" type="button">Выйти</button>
        </div>
      </section>

      <div class="tabs-bar section" role="tablist" aria-label="Разделы профиля">
        <button type="button" role="tab" data-tab="overview" aria-selected="true">Обзор</button>
        <button type="button" role="tab" data-tab="library" aria-selected="false">Полка</button>
        <button type="button" role="tab" data-tab="achievements" aria-selected="false">Достижения</button>
        <button type="button" role="tab" data-tab="settings" aria-selected="false">Настройки</button>
      </div>

      <section data-panel="overview">
        <div class="stat-grid" id="stats"></div>
        <div class="split section">
          <div class="panel"><h2>Любимые жанры по полке</h2><div class="genre-bars" id="genreBars"></div></div>
          <div class="panel"><h2>Выбранные жанры</h2><p class="muted small">Учитываются в рекомендациях Oracle.</p><div class="chips section" id="favoriteGenres"></div></div>
        </div>
        <section class="section"><h2 class="section-head">Избранное</h2><div class="cards" id="favoritesGrid"></div></section>
      </section>

      <section data-panel="library" hidden>
        <div class="library-tabs chips" id="libraryTabs" role="group" aria-label="Подборка">
          <button class="chip" type="button" data-filter="reading" aria-pressed="true">Читаю</button>
          <button class="chip" type="button" data-filter="planned" aria-pressed="false">В планах</button>
          <button class="chip" type="button" data-filter="completed" aria-pressed="false">Прочитано</button>
          <button class="chip" type="button" data-filter="on_hold" aria-pressed="false">Отложено</button>
          <button class="chip" type="button" data-filter="dropped" aria-pressed="false">Брошено</button>
          <button class="chip" type="button" data-filter="favorites" aria-pressed="false">Избранное</button>
        </div>
        <div class="cards section" id="libraryList"></div>
      </section>

      <section data-panel="achievements" id="achievements" hidden><div class="achievements" id="achievementList"></div></section>

      <section data-panel="settings" hidden>
        <div class="split">
          <div class="stack">
            <form class="panel stack" id="profileForm" novalidate>
              <h2>Профиль</h2>
              <div class="form-row" data-local-identity><label for="newName">Имя</label><input class="input" id="newName" type="text" autocomplete="nickname" minlength="2" maxlength="40" required></div>
              <div class="form-row" data-local-identity><label for="username">Адрес профиля</label><input class="input" id="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required><small class="muted small">endemion.online/u/имя — латиница, цифры и «_»</small></div>
              <div class="form-row"><label for="bio">О себе</label><textarea class="textarea" id="bio" maxlength="500" rows="4"></textarea></div>
              <div class="form-row"><span class="form-label">Цвет аватара</span><div class="color-options" id="colorOptions"></div></div>
              <div class="form-row" data-local-identity><span class="form-label">Аватар</span>
                <div class="section-actions">
                  <label class="ghost-btn">Загрузить картинку<input class="visually-hidden" id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label>
                  <button class="ghost-btn" id="avatarRemove" type="button" hidden>Убрать</button>
                </div><small class="muted small">JPEG, PNG, WebP или AVIF до 2 МБ</small></div>
              <div class="form-row"><span class="form-label">Любимые жанры (до 10)</span><div class="chips" id="genrePicker"></div></div>
              <button class="primary-btn" type="submit">Сохранить профиль</button>
              <p class="form-error" id="profileMessage" role="status"></p>
            </form>
            <form class="panel stack" id="privacyForm" novalidate>
              <h2>Приватность</h2>
              <label class="check"><input type="checkbox" name="isPublic"> Публичный профиль: его видят все</label>
              <label class="check"><input type="checkbox" name="showLibrary"> Показывать полку в профиле</label>
              <label class="check"><input type="checkbox" name="showActivity"> Показывать активность в сообществе</label>
              <button class="ghost-btn" type="submit">Сохранить приватность</button>
              <p class="form-error" id="privacyMessage" role="status"></p>
            </form>
          </div>
          <div class="stack">
            <section class="panel stack" id="endemionIdPanel" hidden>
              <h2>Endemion ID</h2>
              <p class="muted small">Имя, адрес профиля, аватар, почта и пароль общие для Endemion и Endemion Life. Они меняются в Endemion ID и появляются здесь в течение нескольких минут.</p>
              <div class="section-actions">
                <a class="primary-btn" id="endemionIdAccount" href="/">Открыть Endemion ID</a>
                <a class="ghost-btn" id="endemionLifeLink" href="/">Играть в Endemion Life</a>
              </div>
            </section>
            <form class="panel stack" id="passwordForm" novalidate>
              <h2>Пароль</h2>
              <input id="usernameHint" type="email" autocomplete="username" hidden>
              <div class="form-row"><label for="currentPassword">Текущий пароль</label><input class="input" id="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></div>
              <div class="form-row"><label for="newPassword">Новый пароль</label><input class="input" id="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>
              <button class="ghost-btn" type="submit">Сменить пароль</button>
            </form>
            <form class="panel stack" id="deleteForm" novalidate>
              <h2>Удаление аккаунта</h2>
              <p class="muted small">Полка, оценки, подборки и подписки удалятся. Комментарии останутся без текста, чтобы не пропали ответы других людей.</p>
              <div class="form-row" id="deletePasswordRow"><label for="deletePassword">Пароль для подтверждения</label><input class="input" id="deletePassword" type="password" autocomplete="current-password" maxlength="128" required></div>
              <button class="danger-btn" type="submit">Удалить аккаунт навсегда</button>
            </form>
            <p class="form-error" id="settingsMessage" role="status" aria-live="polite"></p>
          </div>
        </div>
      </section>
    </div>
    <div class="container page" id="profileLoading"><div class="state"><span class="spinner"></span>Загружаем профиль…</div></div>`;
    return renderPage(request, { title: "Мой профиль", body, scripts: ["profile.js"], noindex: true });
  }
};
