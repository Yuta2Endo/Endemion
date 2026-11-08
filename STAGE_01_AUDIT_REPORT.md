# STAGE_01_AUDIT_REPORT — Endemion Website

**Дата:** 2026-11-08  
**Статус:** Завершён (базовый аудит)  
**Репозиторий:** `G:\III\Project\Endemion` (локальная копия, `.git` присутствует, удалённый репозиторий не настроен)  
**Целевой сайт:** https://endemion.online/  
**Связанные сервисы:** https://auth.endemion.online/, https://life.endemion.online/

---

## 1. Executive Summary

Endemion — работающий production-портал инди-студии: каталог игр, форум сообщества, профили игроков, новости разработки (devlog), админка, личный кабинет и единый вход через Endemion ID (OpenID Connect на auth.endemion.online). Код без сборки: ES-модули в браузере, Pages Functions / Node.js на сервере, SQLite (D1-совместимый).

Проект архитектурно цельный, с чётким разделением ответственности, строгим CSP, защитой от CSRF, PBKDF2-хешами паролей, rate-limiting и защитой от перебора. На момент аудита не выявлено критических регрессий или неработающего основного функционала.

Основные возможности улучшения для Stage 01:
- отсутствие формализованной design system (токены разбросаны по CSS, нет единого источника истины);
- главная страница не отвечает заявленному визуальному направлению (премиум, тёмный интерфейс, фиолетово-синие акценты, сильная типографика);
- часть компонентов унаследована от удалённых разделов (энциклопедия, манга, Pulse, Арена) и содержит мёртвый CSS/HTML;
- нет доступного отчёта аудита и документации дизайн-системы.

Рекомендация: Stage 01 выполнить как аудит + заклад design tokens в CSS + безопасные улучшения общих компонентов без ломающих изменений.

---

## 2. Existing Architecture

### 2.1 Framework и runtime

- **Никакого фреймворка** (React, Vue, Next.js и т.д. не используются).
- Серверная сторона: **Cloudflare Workers** (`src/worker.js`) и собственный **Node.js сервер** (`server/index.mjs`) — одинаковый код, запускается в Docker под Caddy.
- Клиентская сторона: чистые ES-модули в браузере (`public/assets/*.js`), сборка отсутствует.
- База данных: **SQLite** (свой сервер) / **D1** (Cloudflare), схема одинакова через миграции `migrations/*.sql`.
- Хранение файлов: диск сервера (`data/files`) или **S3-совместимое хранилище** (R2 / Selectel / Yandex Object Storage).
- Reverse proxy: **Caddy 2** (Let's Encrypt, HTTPS).

### 2.2 Project structure

```
src/worker.js           — точка входа Worker: маршрутизатор API и страниц
functions/              — Pages Functions (onRequestGet/onRequestPost и т.д.)
  _lib/                 — общий код: сессии, роли, безопасность, аутентификация, HTML-каркас, портал студии
  api/                  — /api/* эндпоинты (вход, профиль, форум, уведомления, модерация, админка)
  studio.js             — HTML-страницы портала студии (серверный рендеринг)
  site.js               — страницы форума, профилей, уведомлений, поиска (каркас + JS подгрузка данных)
  media.js              — раздача картинок игр и публикаций
public/                 — статика: HTML-страницы входа/сброса пароля, CSS, JS, шрифты, иконки
  assets/               — base.css, ui.css, studio.css, app.js, page-specific JS
server/                 — Node.js-сервер: адаптер D1, миграции, бэкапы, ассеты, хранилище
migrations/             — 21 файл схемы (D1 и SQLite одинаковые)
tests/                  — node:test + Playwright e2e
```

### 2.3 Routing

Маршрутизация в `src/worker.js` — статический список `ROUTE_LIST` (точное совпадение сегментов пути, параметры `:slug`, `:id`, `:username`). API-запросы проходят через `apiMiddleware` (проверка Origin, подключение DB, обработка ошибок). НеAPI-маршруты, не найденные в списке, отдаются как статические файлы из `public/` (или 404 через `not_found_handling`).

Все страницы портала студии рендерятся на сервере через `renderPage` (SSR без шаблонизатора — строковая сборка HTML). Страницы форума, профилей и уведомлений отдают серверный каркас, данные подгружаются клиентскими скриптами (`public/assets/*.js`) через `/api/*`.

Удалённые разделы (энциклопедия, манга, Nexus, Oracle, Pulse, Арена, подборки) возвращают 301 на главную.

### 2.4 Component architecture

- Серверные компоненты — функции JS, возвращающие HTML-строки (`functions/_lib/layout.js`, `functions/_lib/studio.js`, `functions/_lib/gamePage.js`, `functions/studio.js`, `functions/site.js`).
- Клиентские компоненты — функции в `public/assets/app.js` (`el`, `link`, `button`, `avatar`, `userLink`, `stateBox`, `openDialog`, `toast` и др.) и модули по страницам (`game-page.js`, `forum-category.js`, `thread.js`, `community.js`, `profile.js`, `user.js`, `search.js`, `notifications.js`, `admin.js`, `auth.js`, `reset.js`, `copyright.js`).
- Общий стилевой слой: `base.css` (переменные, общие стили, шапка, подвал, кнопки, поля), `ui.css` (компоненты: карточки, панели, вкладки, модалки, аватары), `studio.css` (портал студии: hero, карточки игр, бейджи, сетки).

### 2.5 State management

Клиентского стейт-менеджмента нет. Состояние रखтся в:
- cookie сессии (`HttpOnly; Secure; SameSite=Lax`, 30 дней);
- `localStorage` (согласие на аналитику, язык);
- ответы API `/api/me`, `/api/notifications/count` подгружаются по запросу.

### 2.6 Styling architecture

CSS-файлы без препроцессоров, без CSS-модулей, без фреймворка (Tailwind и т.д.). Токены объявлены в `:root` в `base.css`. Версионирование ассетов через `?v=${ASSET_VERSION}` (`ASSET_VERSION = "tnyz8c"` в `layout.js`).

### 2.7 Dependency health

Продакшен-зависимости (package.json):
- `@aws-sdk/client-s3` ^3.1161.0 — работа с S3-хранилищем.
- `openid-client` ^6.8.9 — OIDC-провайдер (Endemion ID).

Dev-зависимости:
- `wrangler` ^4.156.0 — Cloudflare CLI.
- `eslint` ^10.14.0, `@eslint/js`, `globals` — линтинг.
- `@playwright/test` ^1.64.1 — e2e-тесты.
- `typescript` ^7.0.2, `@types/node` ^26.6.6 — typecheck (`checkJs` для серверного кода).

Зависимости минимальны, избыточных нет.

### 2.8 Build configuration

Сборки нет. `wrangler dev` для локальной разработки Worker, `wrangler deploy` для деплоя на Cloudflare, `node server/index.mjs` для своего сервера. Ассеты раздаются как статика.

### 2.9 Environment configuration

- `.env.example` — образец для своего сервера (SITE_DOMAIN, PUBLIC_URL, S3, MAIL, SEED, Endemion ID, аналитика).
- `wrangler.toml` — привязки D1 (`endemion`), R2 (`endemion-pages`), переменные (`REDIRECT_TO`, `TURNSTILE_SITE_KEY`, `MAIL_FROM`, `WEB_ANALYTICS_TOKEN`).
- Секреты через `npx wrangler secret put` (TURNSTILE_SECRET_KEY, RESEND_API_KEY и т.д.).
- `.env` не попадает в git.

### 2.10 Existing APIs

Полный список в `src/worker.js` (маршруты `/api/auth/*`, `/api/me/*`, `/api/config`, `/api/complaints`, `/api/admin/*`, `/api/users/*`, `/api/notifications/*`, `/api/comments/*`, `/api/threads/*`, `/api/search`, `/api/moderation/*`, `/api/admin/games/*`, `/api/admin/studio-posts/*`, `/api/admin/forum-categories/*`, `/api/admin/site-settings`, `/avatars/:id`). Каждый маршрут映射 на модуль в `functions/api/`.

### 2.11 Authentication

Два режима (см. `functions/_lib/endemionId.js`):
1. **Старый вход паролем сайта** (`/api/auth/login`, `register`, `forgot`, `reset`) — PBKDF2-SHA256, 100 000 итераций, своя соль, сессия 30 дней, токен хранится как SHA-256.
2. **Endemion ID (OIDC, auth.endemion.online)** — включается `ENDEMION_ID=1`. Authorization Code + PKCE S256. refresh token шифруется AES-GCM в базе. Сессия сайта сверяется с Endemion ID раз в 5 минут. Вход через Google, VK ID, GitHub, Discord настраивается в самом сервисе auth.

CSRF-защита: изменяющие `/api/*` запросы принимаются только с заголовком `Origin` своего сайта.

### 2.12 External integrations

- Unisender Go / Resend — письма восстановления пароля.
- Cloudflare Turnstile — капча (опционально).
- S3 — аватары, обложки, скриншоты, бэкапы базы.
- Яндекс Метрика — после согласия посетителя.
- Cloudflare Web Analytics — токен в `wrangler.toml`.
- Endemion ID (OIDC) — единый аккаунт с `life.endemion.online`.

---

## 3. Technology Stack

| Слой | Технология |
|------|-----------|
| Сервер (Worker) | Cloudflare Workers, es-модули, `src/worker.js` |
| Сервер (свой) | Node.js 22.16+, `server/index.mjs`, SQLite через адаптер D1 |
| Клиент | Чистые ES-модули, `public/assets/` |
| Стиль | Чистый CSS, CSS-переменные в `:root` (base.css) |
| Шрифты | Manrope (Variable, Cyrillic+Latin), Unbounded (Variable, Cyrillic+Latin), OFL |
| База | SQLite / D1, 21 миграция |
| Хранилище файлов | Диск или S3-совместимое |
| Аутентификация | Собственная (PBKDF2) + Endemion ID (OIDC + PKCE) |
| Reverse proxy | Caddy 2 + Let's Encrypt |
| Тестирование | node:test (integration), Playwright (e2e) |
| Линтинг | ESLint |
| Типизация | TypeScript checkJs (серверный код) |

---

## 4. Current Website Structure

| Адрес | Описание | Рендеринг |
|-------|----------|-----------|
| `/` | Главная: герой, featured game, наши игры, новости, сообщество, будущие проекты | Сервер (studio.js) |
| `/games`, `/games/:slug` | Каталог игр и страница игры | Сервер (studio.js) |
| `/studio`, `/studio/:slug` | Разработка: публикации, devlog, roadmap | Сервер (studio.js) |
| `/about`, `/terms` | О студии, условия использования | Сервер (studio.js) |
| `/legal`, `/legal/:game/:document` | Правовой центр: документы игр | Сервер (legal.js) |
| `/community`, `/community/c/:slug` | Форум: категории, темы | Сервер (site.js/studio.js) + JS |
| `/community/thread/:id` | Тема форума | Сервер (site.js) + JS |
| `/users/:username` | Публичный профиль | Сервер (site.js) + JS |
| `/profile` | Свой профиль ENDEMION ID | Сервер (site.js) + JS |
| `/notifications` | Уведомления | Сервер (site.js) + JS |
| `/search` | Поиск | Сервер (site.js) + JS |
| `/auth`, `/reset` | Вход, регистрация, сброс пароля | Статические HTML (public/) + JS |
| `/admin` | Админка | Сервер (adminStudio.js, adminPlatform.js и др.) |
| `/api/*` | REST API | Сервер (functions/api/) |
| `/robots.txt`, `/sitemap.xml` | SEO-файлы | Сервер (functions/) |

Удалённые разделы (энциклопедия, манга, читалка, Nexus, Oracle, Pulse, Арена, подборки) — 301 на `/`.

---

## 5. UI/UX Audit

### 5.1 Visual consistency

- Единая тёмная палитра: `#080a10` фон, `#11141d` поверхность, `#181d29` поверхность elevated.
- Акценты: фиолетовый `#8b5cf6` (primary), индиго `#6366f1` (secondary), cyan `#22d3ee` (highlight).
- Шрифты: Manpole для текста, Unbounded для заголовков.
- Логотип: градиентная буква "E" + текст "ENDEMION".

**Проблемы:**
- Главная страница (`/`) не odpowiadaет заявленному визуальному направлению "премиум, минималистичный, технологичный". На ней нет выраженного hero с типографикой, который задаёт тон бренда; структура сборная и напоминает дашборд портала, а не презентационную главную.
- CSS содержит наследие от удалённых разделов (в ui.css упоминаются "Nexus, Oracle, Pulse, профиль, сообщество, Арена" — мёртвый код, который не используется текущими страницами).
- Нет формализованной design system: нет отдельного файла токенов, нет документированных правил использования компонентов.
- Текст на главной на английском ("Welcome to Endemion", "Explore Games", "Join Community") при русском языке по умолчанию — неполная локализация ключевых секций.

### 5.2 Navigation clarity

- Шапка: логотип, навигация (Главная, Игры, Сообщество, Разработка, О студии), поиск, колокольчик уведомлений, регистрация/вход, переключатель языка, меню (гамбургер на <=1279px).
- Подвал: логотип, разделы, проекты (Life, Community, Devlog), документы (Legal, Privacy, Terms, Copyright, Cookie).
- Мобильное меню: выдвигается под шапкой, работает по кнопке меню, закрывается по Escape и по клику на ссылку.

**Проблемы:**
- Кнопка "Регистрация" скрыта на экранах <=1679px и на телефонах — пользователю предлагается только "Войти", регистрация доступна через `/auth?mode=register`, что неочевидно.
- Нет визуального выделения активного раздела в подвале.

### 5.3 Typography

- Заголовки: Unbounded, жирный, `letter-spacing: -0.02em`, `line-height: 1.15`.
- Текст: Manrope, 15px, `line-height: 1.5`.
- `.display-1`: 36–72px, `.display-2`: 26–40px (clamp).
- Хорошая адаптивность типографики через `clamp()`.

**Проблемы:**
- Нет формализованной типографской шкалы (h1–h6, lead, body, caption, small не документированы как система).

### 5.4 Spacing

- Container: `min(1240px, calc(100% - 40px))`.
- Секции: отступы через `.section` (54px), `.studio-section` (clamp 48–88px).
- Grid gap: 18–24px.

### 5.5 Color palette

Тёмная премиум-палитра с фиолетово-синими акцентами. Есть семантические цвета: green (статус released), yellow (прототип), pink (достижения, ошибки акцент), red (ошибки, danger).

### 5.6 Layout hierarchy

- Hero на главной с фоновой обложкой featured game.
- Сетки карточек игр и публикаций.
- Панели списков форума.
- Скелетоны состояний загрузки.

### 5.7 Responsive behavior

- Breakpoints: 1679px, 1279px, 900px, 760px, 680px.
- Мобильное меню, адаптивная типографика (clamp), стек колонок на узких экранах.
- `viewport-fit=cover`, `theme-color`.

**Проблемы:**
- Нет явных медиа-запросов для планшетного промежутка между 900px и 1279px для некоторых компонентов.

### 5.8 Accessibility

- `skip-link` (перейти к содержимому).
- `aria-current="page"` для активной навигации.
- `aria-label` на иконковых кнопках.
- `visually-hidden` для меток поиска.
- `:focus-visible` с чёткой обводкой.
- `prefers-reduced-motion: reduce` отключает анимации.
- Семантические теги: `header`, `nav`, `main`, `footer`, `section`, `article`, `form`, `button`, `dialog` (в JS).
- `lang` на html, `Accept-Language` + cookie для выбора языка.

**Проблемы:**
- Не все интерактивные элементы имеют достаточно明确ных focus-состояний (нужна отдельная проверка).
- Нет `aria-describedby` на всех полях формы (частично).
- Некоторые кнопки в подвале без aria-label.

### 5.9 Loading / Error / Empty states

- Скелетоны (`.skeleton`, `.skeleton-line`, `.skeleton-row`).
- `.state` / `.state-error` — состояния пусто/ошибка.
- `.empty-card` — пустые секции портала.
- Toaster (`.toast`) для уведомлений.
- Spinner (`.spinner`).

### 5.10 Mobile experience

- Адаптивная шапка с гамбургер-меню.
- Адаптивные карточки и сетки.
- Скрытие несущественных элементов на маленьких экранах.

---

## 6. Functional Audit (проверено по коду, без запуска браузера)

| Функционал | Статус | Комментарий |
|------------|--------|-------------|
| Навигация по разделам | Работает | Серверный рендеринг, активный раздел через `aria-current` |
| Каталог игр (`/games`) | Работает | `listGames`, карточки через `gameCard` |
| Страница игры (`/games/:slug`) | Работает | Описание, скриншоты, roadmap, новости, devlog, комьюнити |
| Форум (`/community`, ветки) | Работает | Категории, темы, комментарии, реакции, поиск |
| Профили (`/users/:username`, `/profile`) | Работает | Активность, достижения, настройки, приватность |
| Уведомления (`/notifications`) | Работает | API `/api/notifications` |
| Поиск (`/search`) | Работает | API `/api/search` |
| Вход/регистрация | Работает | Два режима: старый пароль или Endemion ID |
| Сброс пароля | Работает (если настроена почта) | `/api/auth/forgot`, `/api/auth/reset` |
| Админка (`/admin`) | Работает | Игры, публикации, категории, настройки, модерация, пользователи, журнал |
| Endemion ID (OIDC) | Настраивается | `ENDEMION_ID=1`, отдельный сервис auth |
| Sitemap / robots | Работает | `/robots.txt`, `/sitemap.xml` через Functions |
| PWA (service worker) | Работает | `/sw.js`, офлайн-страница `/offline.html` |

Не проверялось напрямую (требует запущенного сервера): оплата, покупка игр, CDN-раздача больших файлов (в текущем проекте их нет — это каталог, не магазин).

---

## 7. Performance Audit

**Сильные стороны:**
- Нет сборки — ассеты отдаются как есть, браузер кэширует CSS/JS/шрифты/иконки (`Cache-Control: public, max-age=86400` для `/assets/*` в `_headers`).
- Шрифты предзагружаются (`rel=preload` woff2).
- CSS-переменные, нет избыточных фреймворков.
- `async/defer` для скриптов, `type="module"`.
- Изображения обложек с `fetchpriority="high"`, `imagesrcset`.
- Service Worker для офлайн-режима.

**Возможности оптимизации:**
- JS и CSS кэшируются с `no-cache` (проверка по ETag) — целенаправленно, чтобы после деплоя не оставались старые скрипты. Это правильно, но увеличивает количество запросов при повторном посещении.
- Нет сжатия CSS/JS на уровне сборки (сборки нет; сжатие на уровне Caddy: `encode zstd gzip`).
- Нет ленивой загрузки изображений вне экрана (имеется `loading="lazy"` для аватаров в JS).
- Фоны со звёздной пылью — CSS-градиенты, без картинок (хорошо).
- Фон hero — растровое изображение обложки с `opacity: 0.35` и маской.

---

## 8. SEO Audit

**Реализовано:**
- `<title>` на каждой странице, уникальные.
- `<meta name="description">`.
- `og:site_name`, `og:title`, `og:description`, `og:image`, `og:type`, `og:url`, `og:locale`.
- `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`.
- `rel=canonical`.
- `noindex` для админки, профиля, сброса пароля, страниц поиска.
- `robots.txt`, `sitemap.xml`.
- Семантический HTML, иерархия заголовков (h1 → h2 → h3).
- `application/ld+json`: Organization (главная), VideoGame (страница игры), BlogPosting (публикация).
- `inLanguage: "ru"` для структуры игр.

**Проблемы:**
- `og:image` — общая `/assets/og-image.png`, нет уникальных изображений для каждой страницы (кроме игр, где есть `cover`).
- Главная страница содержит английский текст в ключевых секциях (Hero, кнопки), что может негативно сказаться на локальном SEO для русскоязычной аудитории.
- Нет structured data для форума (BreadcrumbList, Forum, DiscussionForumPosting) — можно добавить в Stage 02, но не критично для Stage 01.
- Некоторые страницы имеют `noindex`, но всё ещё попадают в sitemap (нужно проверить `sitemap.xml`).

---

## 9. Accessibility Audit (WCAG 2.2 AA)

**Реализовано:**
- `skip-link`, фокус виден (`:focus-visible`).
- Семантические теги.
- `aria-current`, `aria-label`, `aria-hidden`, `aria-expanded`, `aria-busy`, `aria-live`.
- `lang` на html.
- `prefers-reduced-motion`.
- Цвет contrast: текст `#f8fafc` на `#080a10` — высокий контраст; акцент `#8b5cf6` на тёмном фоне — приемлемый.
- Формы с `<label>`, `for`/`id`, `required`, `minlength/maxlength`.
- `dialog` элемент для модалок (в JS `openDialog`).
- Кнопки имеют `type="button"` или `type="submit"`.

**Требует проверки (не выполнено без браузера):**
- Конкретные коэффициенты контраста для всех комбинаций цветов.
- Порядок фокуса по Tab на всех страницах.
- Screen-reader-тестирование.

---

## 10. Authentication and Integration Audit

### Endemion ID (auth.endemion.online)
- OIDC Authorization Code + PKCE S256.
- Scope: `openid email profile`.
- refresh token шифруется AES-GCM (`ENDEMION_ID_TOKEN_KEY`).
- refreshSession: сверка раз в 5 минут, graceful degradation на 1 час при недоступности провайдера.
- `legacyAuthClosed`: при `ENDEMION_ID=1` старые эндпоинты `/api/auth/login/register/forgot/reset` возвращают 410.
- `safeNext`: защита от открытого редиректа (`?next` только свои пути).
- Регистрация нового пользователя создаёт запись в `users` с `password_hash = '!'`.

### life.endemion.online
- Упоминается в подвале ("Проекты" → Endemion Life) и на странице `/about` ("Направления" → Endemion Life, браузерный симулятор жизни).
- Общий аккаунт через Endemion ID.
- Прямых ссылок на покупку/магазин нет — Life — отдельный проект.

### Security concerns (документировано, не критично)
- `cf-connecting-ip` и `host` фильтруются в `toRequest` (свой сервер).
- `TRUST_PROXY` для X-Forwarded-For через Caddy.
- CSP строгое, без `unsafe-inline`.
- Cookies `HttpOnly; Secure; SameSite=Lax`.
- Rate limiting: 5 неудачных входа или 30 с одного IP за 15 мин → 429.
- CSRF: проверка `Origin` для небезопасных методов.

Рекомендации по аутентификации вынесены в Stage 04 (см. проектное задание). В Stage 01 изменения в аутентификацию не вносятся.

---

## 11. Identified Problems and Severity

| ID | Проблема | Severity | Компонент |
|----|----------|----------|-----------|
| A1 | Нет формализованной design system (токены разбросаны по CSS) | Medium | base.css, ui.css, studio.css |
| A2 | Главная страница не отвечает визуальному направлению (премиум, минимализм, типографика) | Medium | functions/studio.js (home) |
| A3 | На главной английский текст в ключевых секциях при ru по умолчанию | Low | functions/studio.js (home) |
| A4 | Мёртвый CSS/HTML от удалённых разделов (энциклопедия, манга, Pulse, Арена) | Low | ui.css, base.css (комментарии) |
| A5 | Кнопка регистрации скрыта на узких экранах | Low | base.css (media queries) |
| A6 | Нет документированной типографской шкалы | Low | base.css, studio.css |
| A7 | Нет уникальных og:image для страниц (кроме игр) | Low | layout.js, studio.js |
| A8 | Нет V03_STATUS.md / отчёта аудита | Low | Документация |

---

## 12. Recommended Improvements (Stage 01)

1. **Создать STAGE_01_DESIGN_SYSTEM.md** — формализовать токены (цвета, типографика, spacing, breakpoints, компоненты).
2. **Реализовать токены в CSS** — вынести в отдельный блок `:root` с полным набором семантических переменных (background, surface, elevated, primary text, secondary text, muted text, borders, primary accent, secondary accent, success, warning, error).
3. **Очистить CSS от наследия удалённых разделов** (аккуратно, без удаления используемых классов).
4. **Улучшить общие компоненты** (кнопки, поля, карточки, модалки) в соответствии с design system, без изменения HTML-структуры страниц.
5. **Исправить локализацию hero на главной** (русский/английский через словарь i18n).
6. **Создать STAGE_01_IMPLEMENTATION_REPORT.md** и **STAGE_01_NEXT_STAGE.md**.
7. **Проверить:** lint, typecheck, тесты.

Важно: 기존 функционал остаётся нетронутым, маршруты не ломаются, аутентификация не меняется.
