# STAGE_03_AUDIT_REPORT — Endemion Projects Hub & Product Pages

**Статус:** Завершён (аудит)  
**Репозиторий:** `G:\III\Project\Endemion`  
**Целевой сайт:** https://endemion.online/  
**Предыдущие этапы:** STAGE 01 — Audit & Design System, STAGE 02 — Homepage Redesign

---

## 1. Current Implementation

### 1.1 Routes

| Адрес | Модуль | Описание |
|-------|--------|----------|
| `/games` | `functions/studio.js` → `gamesPage` | Каталог игр: список опубликованных игр + раздел «Будущие проекты» |
| `/games/:slug` | `functions/studio.js` → `gamePage` | Страница игры: обложка, описание, скриншоты, roadmap, новости, devlog, комьюнити, статус |
| `/api/search?q=` | `functions/api/search.js` | Поиск по темам, ответам, играм и публикациям |

### 1.2 Current `/games` (Games Catalog)

Реализация в `functions/studio.js:174-196`:
- Получает все опубликованные игры (`listGames(env, { upcoming: false })`) и upcoming-игры (`upcoming: true`)
- Рендерит через `gameCard()` в `.grid-games`
- Простой `page-head` с eyebrow, h1, description
- Нет фильтрации по статусу/платформе, нет поиска, нет сортировки, нет пагинации
- Нет URL-состояния (query parameters)
- Хардкод английского текста в заголовках и описании (через тернарный оператор `en ? ... : ...`)

### 1.3 Current `/games/:slug` (Game Product Page)

Реализация в `functions/studio.js:200-283`:
- Получает игру по слагу (`getGameBySlug`), проверяет `published`
- Загружает медиа (`listGameMedia`), публикации (`listPosts` с разными `kind`), категории форума (`gameCategory`), темы (`recentThreads`)
- Рендерит секции: about, worlds, features, screenshots, roadmap, news, devlog, community, status
- Есть `heroSection` из `gamePage.js`, VideoGame structured data, Open Graph мета-теги
- Статусные строки в виде dl/dd таблицы
- Нет премиального hero с раздельной компоновкой
- Нет галереи скриншотов с ленивой загрузкой
- Нет интеграции wishlist (функционала не существует)

### 1.4 Existing Reusable Components

| Компонент | Источник | Назначение |
|-----------|----------|------------|
| `listGames(env, { upcoming, withHidden })` | `functions/_lib/studio.js:67` | Получение игр с фильтром upcoming |
| `getGameBySlug(env, slug)` | `functions/_lib/studio.js:75` | Получение игры по слагу |
| `listGameMedia(env, gameId)` | `functions/_lib/studio.js:85` | Скриншоты и обложки игры |
| `gameCard(game, lang)` | `functions/_lib/studio.js:257` | HTML карточки игры |
| `gameArt(game, {eager, lang})` | `functions/_lib/studio.js:248` | Обложка или placeholder |
| `statusBadge(status, lang)` | `functions/_lib/studio.js:241` | Бейдж статуса |
| `listPosts(env, {status, kinds, gameId, limit, offset})` | `functions/_lib/studio.js:119` | Публикации студии |
| `recentThreads(env, {limit, categoryIds})` | `functions/_lib/studio.js:156` | Темы форума |
| `gameCategory(env, gameId)` | `functions/_lib/studio.js:191` | Категория форума игры |
| `emptyCard(title, text, action)` | `functions/_lib/studio.js:313` | Пустое состояние |
| `renderPage(...)` | `functions/_lib/layout.js:100` | Серверный рендеринг страницы |
| `t(lang)` | `functions/_lib/i18n.js:116` | Локализация RU/EN |
| `escapeHtml as e` | `functions/_lib/html.js:19` | Экранирование HTML |
| `.card`, `.card-media`, `.card-body` | `public/assets/studio.css` | Стили карточек |
| `.grid-games` | `public/assets/studio.css` | Сетка игр |
| `.section-head`, `.eyebrow` | `public/assets/ui.css` | Заголовки секций |

### 1.5 Database Schema (релевантные таблицы)

**`games`** (`migrations/0020_studio.sql:8-28`):
- `id`, `slug` (UNIQUE, lowercase, 2-60 chars), `title`, `tagline`, `description`
- `status` (NULL, `in_development`, `prototype`, `released`, `planned`)
- `platforms` (comma-separated TEXT, до 200 символов)
- `website_url` (https:// или пусто)
- `roadmap`, `known_issues` (TEXT до 5000)
- `cover_version` (INTEGER или NULL)
- `is_upcoming` (0/1), `published` (0/1), `position` (INTEGER)
- `created_at`, `updated_at`

**`game_media`** (`migrations/0020_studio.sql:32-40`):
- `id`, `game_id` (FK → games), `caption`, `content_type` (jpeg/png/webp/avif), `position`, `created_at`

**`studio_posts`** (`migrations/0020_studio.sql:54-69`):
- `id`, `slug`, `kind` (news/devlog/update/roadmap/announcement), `status` (draft/published/archived)
- `title`, `summary`, `body`, `game_id` (FK → games, SET NULL), `author_id`
- `image_version`, `published_at`, `created_at`, `updated_at`

**`forum_categories`** (`migrations/0020_studio.sql:75-86`):
- `id`, `slug`, `section` (general/games/development/community), `title`, `description`
- `game_id` (FK → games, SET NULL), `staff_only`, `position`

### 1.6 Existing Game Records (seed data, `0020_studio.sql:42-49`)

| Slug | Title | Status | Platforms | Website |
|------|-------|--------|-----------|---------|
| endemion-life | Endemion Life | in_development | Браузер | https://life.endemion.online |
| tetrus | TETRUS | NULL | — | — |
| life-city | LIFE_CITY | NULL | — | — |
| os-developer-simulator | OS Developer Simulator | NULL | — | — |
| liforae | Liforae | NULL | — | — |

Только Endemion Life имеет заполненные данные. Остальные — заготовки без описания, статуса, платформ.

---

## 2. Existing Wishlist and Forum Integration

### Wishlist
Функционала wishlist/избранного для игр **не существует**. В базе нет таблицы для избранных игр. Таблица `library` относится к удалённым разделам (аниме/манга), не к играм. Административного API для управления wishlist игр тоже нет.

### Forum Integration
- Каждая игра может иметь связанную категорию форума (`forum_categories.game_id`)
- На странице игры используется `gameCategory(env, game.id)` для получения ссылки на обсуждение
- Есть категории `feature-requests`, `bug-reports` (раздел development)
- `recentThreads(env, { limit, categoryIds })` получает темы по категориям игры

---

## 3. Identified Problems

| ID | Проблема | Severity | Компонент |
|----|----------|----------|-----------|
| G1 | `/games` не имеет фильтрации по статусу и платформе | Medium | functions/studio.js (gamesPage) |
| G2 | `/games` не имеет поиска, сортировки, URL-состояния | Medium | functions/studio.js (gamesPage) |
| G3 | `/games` не имеет пагинации | Low | functions/studio.js (gamesPage) |
| G4 | Хардкод английского текста на `/games` (через тернарный оператор) | Low | functions/studio.js (gamesPage) |
| G5 | `/games/:slug` не имеет премиального hero с раздельной компоновкой | Medium | functions/studio.js (gamePage) |
| G6 | `/games/:slug` не имеет галереи скриншотов с ленивой загрузкой | Low | functions/_lib/gamePage.js (screenshotsSection) |
| G7 | Wishlist для игр не существует | Medium | Нет в базе и коде |
| G8 | Нет i18n строк для каталога (фильтры, сортировка, пустые состояния) | Medium | functions/_lib/i18n.js |
| G9 | Нет уникальных og:image для страниц игр (кроме обложек) | Low | functions/studio.js (gamePage) |

---

## 4. Proposed Implementation

### 4.1 Projects Hub `/games`

1. **Server-side filtering**: Добавить параметры `status`, `platform`, `q` (search), `sort` в query string
2. **Поиск**: Интеграция с существующим `/api/search` или прямой запрос к БД (title/tagline/description)
3. **Сортировка**: position, title ASC/DESC, created_at DESC/ASC
4. **URL-состояние**: Сохранение фильтров в query параметрах, кнопка сброса
5. **Премиальный заголовок страницы**: page-head с описанием, счетчик результатов
6. **Empty state**: Локализованное пустое состояние с кнопкой сброса фильтров
7. **i18n**: Все строки через `t(lang)`

### 4.2 Game Product Pages `/games/:slug`

1. **Премиальный hero**: Большая обложка, заголовок, тэглайн, описание, статус, платформы, CTA
2. **Галерея скриншотов**: Через `listGameMedia()`, `loading="lazy"`, подписи из caption
3. **Roadmap**: Публикации с `kind: "roadmap"`
4. **News/Updates**: Публикации с `kind: "update", "news"` через `postCard()`
5. **Devlog**: Публикации с `kind: "devlog"`
6. **Community**: Ссылка на категорию форума игры
7. **CTA**: Играть (websiteUrl), Обсудить (форум), Подробнее (страница игры)
8. **SEO**: Уникальный title, description, Open Graph, VideoGame structured data (уже есть — сохранить)

### 4.3 Localization

Добавить строки в `functions/_lib/i18n.js`:
- Каталог: заголовок, описание, метки фильтров, сортировки, поиска, пустое состояние
- Страница игры: заголовки секций, CTA, метки мета-информации

### 4.4 Files Expected to Change

| Файл | Изменение |
|------|-----------|
| `functions/studio.js` | Переписать `gamesPage` и `gamePage` с новой структурой, фильтрами, поиском, сортировкой |
| `functions/_lib/i18n.js` | Добавить строки каталога и страниц игр (RU/EN) |
| `public/assets/studio.css` | Добавить CSS классы для каталога, hero игры, галереи скриншотов |
| `tests/portal.test.mjs` | Добавить тесты для фильтрации, поиска, сортировки, пустого состояния |

---

## 5. Risks and Mitigations

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Регрессия существующих страниц игр | Средняя | Средняя | Добавлять новые CSS-классы, не удалять старые; сохранить существующие тесты |
| Выдуманный контент | Низкая | Высокая | Использовать только данные из БД; нет wishlist — не добавлять кнопку |
| Поломка локализации | Низкая | Средняя | Все строки через `i18n.js`; проверять RU/EN |
| N+1 запросы к БД | Средняя | Средняя | Использовать существующие хелперы с эффективными запросами |
| Нет wishlist — пользователи ожидают кнопку | Средняя | Низкая | Документировать ограничение; не создавать фейковую кнопку |

---

## 6. Acceptance Criteria (предварительные)

- [ ] `/games` отображает все опубликованные игры
- [ ] Фильтрация по статусу работает сервер-side
- [ ] Фильтрация по платформе работает сервер-side
- [ ] Поиск интегрирован с существующим API
- [ ] Сортировка работает на реальных данных
- [ ] URL query state сохраняется
- [ ] Empty state при отсутствии результатов
- [ ] `/games/:slug` отображает полную информацию об игре
- [ ] Скриншоты из реальных записей `game_media`
- [ ] Roadmap, новости, обновления, devlog из реальных публикаций
- [ ] CTA на основе реальных данных (websiteUrl, категория форума)
- [ ] RU/EN локализация
- [ ] SEO мета-теги и VideoGame structured data сохранены
- [ ] `npm test` — все применимые тесты проходят
- [ ] Нет новых lint/typecheck ошибок
