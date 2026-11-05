// Страницы ENDEMION, которые собирает скрипт раздела: сообщество, темы форума, профили, уведомления.
// Сервер отдаёт каркас страницы (шапка, заголовки, контейнеры, скелеты), данные подгружает скрипт раздела из public/assets.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { escapeHtml as e } from "./_lib/html.js";
import { renderPage } from "./_lib/layout.js";
import { categoryIndex, listCategories } from "./_lib/studio.js";
import { langOf } from "./_lib/i18n.js";

/** GET /community — категории форума, лента обсуждений и теорий, поиск участников */
export const community = {
  async onRequestGet({ request, env }) {
    const lang = langOf(request);
    const en = lang === "en";
    const categories = await listCategories(env);
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Endemion Community</div>
          <h1>${en ? "Community" : "Сообщество"}</h1>
          <p class="section-text">${en ? "The studio and player forum: talk, games, development, creativity and events." : "Форум студии и игроков: общение, игры, разработка, творчество и события."}</p>
        </div>
        <div class="section-actions" id="communityActions"></div>
      </div>
      <div class="forum-index">${categoryIndex(categories, lang)}</div>
      <h2 class="forum-section-title" id="feedTitle">${en ? "Community feed" : "Лента сообщества"}</h2>
      <div class="tabs-bar" role="tablist" aria-label="${en ? "Community sections" : "Разделы сообщества"}">
        <button type="button" role="tab" data-tab="threads" aria-selected="true">${en ? "Discussions" : "Обсуждения"}</button>
        <button type="button" role="tab" data-tab="theories" aria-selected="false">${en ? "Theories" : "Теории"}</button>
        <button type="button" role="tab" data-tab="readers" aria-selected="false">${en ? "Members" : "Участники"}</button>
      </div>
      <div id="communityBody" role="tabpanel" aria-live="polite"></div>
    </div>`;
    return renderPage(request, {
      title: en ? "Community" : "Сообщество", path: "/community", active: "community", body, scripts: ["community.js"], styles: ["studio.css"],
      description: en ? "The Endemion community: the studio and player forum, discussions of games, development and creativity." : "Сообщество Endemion: форум студии и игроков, обсуждения игр, разработки и творчества."
    });
  }
};

/** GET /community/thread/:id — обсуждение или теория с комментариями */
export const threadPage = {
  async onRequestGet({ request, params }) {
    const en = langOf(request) === "en";
    const body = `
    <div class="container page">
      <nav class="breadcrumbs" aria-label="${en ? "Breadcrumb" : "Навигация"}"><a href="/community">${en ? "Community" : "Сообщество"}</a> <span aria-hidden="true">/</span> <span id="crumb">${en ? "Discussion" : "Обсуждение"}</span></nav>
      <div class="split section">
        <div class="stack">
          <article class="post" id="post" aria-busy="true"><div class="skeleton skeleton-row"></div></article>
          <section class="panel" aria-labelledby="commentsTitle"><h2 id="commentsTitle">${en ? "Comments" : "Комментарии"}</h2><div id="comments"></div></section>
        </div>
        <aside class="stack" id="threadAside"></aside>
      </div>
    </div>`;
    return renderPage(request, {
      title: en ? "Discussion" : "Обсуждение", active: "community", body, scripts: ["thread.js"], path: `/community/thread/${encodeURIComponent(params.id)}`,
      mainAttrs: `data-thread-id="${e(params.id)}"`
    });
  }
};

/** GET /search?q= — общий поиск: темы, ответы, игры и публикации студии. Результаты подгружает search.js */
export const searchPage = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Endemion</div>
          <h1>Поиск</h1>
          <p class="section-text">Темы форума, ответы, игры и публикации студии.</p>
        </div>
      </div>
      <form class="search-page-form" role="search" action="/search" method="get">
        <input class="input" type="search" name="q" maxlength="80" placeholder="Что ищете?" aria-label="Поисковый запрос" required>
        <button class="primary-btn" type="submit">Найти</button>
      </form>
      <div id="searchResults" aria-live="polite"></div>
    </div>`;
    return renderPage(request, {
      title: "Поиск", path: "/search", active: null, body, scripts: ["search.js"], styles: ["studio.css"], noindex: true
    });
  }
};

/** GET /users/:username — публичный профиль участника */
export const userPage = {
  async onRequestGet({ request, params }) {
    const body = `
    <div class="container page" id="userPage" aria-busy="true">
      <div class="profile-hero"><div class="skeleton avatar-dot avatar-lg"></div><div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div></div>
    </div>`;
    return renderPage(request, {
      title: "Профиль", active: null, body, scripts: ["user.js"], path: `/users/${encodeURIComponent(params.username)}`,
      mainAttrs: `data-username="${e(params.username)}"`
    });
  }
};

/** GET /profile — свой профиль ENDEMION ID: активность, достижения, настройки */
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
        <button type="button" role="tab" data-tab="achievements" aria-selected="false">Достижения</button>
        <button type="button" role="tab" data-tab="settings" aria-selected="false">Настройки</button>
      </div>

      <section data-panel="overview">
        <div class="stat-grid" id="stats"></div>
        <div class="section-actions section" id="overviewLinks"></div>
        <section class="panel section" aria-labelledby="myTopicsTitle">
          <h2 id="myTopicsTitle">Мои последние темы</h2>
          <div id="myTopics"><p class="muted small">Загружаем…</p></div>
        </section>
      </section>

      <section data-panel="achievements" id="achievements" hidden><div class="achievements" id="achievementList"></div></section>

      <section data-panel="settings" hidden>
        <div class="split">
          <div class="stack">
            <form class="panel stack" id="profileForm" novalidate>
              <h2>Профиль</h2>
              <div class="form-row" data-local-identity><label for="newName">Имя</label><input class="input" id="newName" type="text" autocomplete="nickname" minlength="2" maxlength="40" required></div>
              <div class="form-row" data-local-identity><label for="username">Адрес профиля</label><input class="input" id="username" type="text" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required><small class="muted small">endemion.online/users/имя — латиница, цифры и «_»</small></div>
              <div class="form-row"><label for="bio">О себе</label><textarea class="textarea" id="bio" maxlength="500" rows="4"></textarea></div>
              <div class="form-row"><span class="form-label">Цвет аватара</span><div class="color-options" id="colorOptions"></div></div>
              <div class="form-row" data-local-identity><span class="form-label">Аватар</span>
                <div class="section-actions">
                  <label class="ghost-btn">Загрузить картинку<input class="visually-hidden" id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label>
                  <button class="ghost-btn" id="avatarRemove" type="button" hidden>Убрать</button>
                </div><small class="muted small">JPEG, PNG, WebP или AVIF до 2 МБ</small></div>
              <button class="primary-btn" type="submit">Сохранить профиль</button>
              <p class="form-error" id="profileMessage" role="status"></p>
            </form>
            <form class="panel stack" id="privacyForm" novalidate>
              <h2>Приватность</h2>
              <label class="check"><input type="checkbox" name="isPublic"> Публичный профиль: его видят все</label>
              <label class="check"><input type="checkbox" name="showActivity"> Показывать темы и ответы на форуме</label>
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
              <p class="muted small">Профиль, подписки, реакции и уведомления удалятся. Темы и ответы останутся без текста, чтобы не пропали ответы других людей.</p>
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

/** GET /notifications — уведомления: ответы, подписчики, достижения, решения модераторов, и их настройки */
export const notificationsPage = {
  async onRequestGet({ request }) {
    const body = `
    <div class="container page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Endemion ID</div>
          <h1>Уведомления</h1>
          <p class="section-text">Ответы на форуме, новые подписчики, достижения и решения модераторов.</p>
        </div>
      </div>
      <div id="noticeBody" aria-live="polite"><div class="stack">${'<div class="skeleton skeleton-row"></div>'.repeat(4)}</div></div>
    </div>`;
    return renderPage(request, { title: "Уведомления", path: "/notifications", body, scripts: ["notifications.js"], noindex: true });
  }
};

/** GET /u/:username — старый адрес профиля: постоянное перенаправление на /users/:username */
export const userRedirect = {
  async onRequestGet({ request, params }) {
    const { search } = new URL(request.url);
    return new Response(null, { status: 301, headers: { Location: `/users/${encodeURIComponent(params.username)}${search}` } });
  }
};
