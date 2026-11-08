# STAGE_04_AUDIT_REPORT — Endemion Authentication & Identity

**Статус:** Завершён (аудит)  
**Репозиторий:** `G:\III\Project\Endemion`  
**Целевой сайт:** https://endemion.online/  
**Предыдущие этапы:** STAGE 01 — Audit & Design System; STAGE 02 — Homepage Redesign; STAGE 03 — Projects Hub & Product Pages

---

## 1. Existing Authentication Architecture and OIDC Flow

### 1.1 Two authentication modes

Реализованы два режима входа, переключаемых настройкой `ENDEMION_ID` (`functions/_lib/endemionId.js:19-21`):

| Режим | Когда включается | Описание |
|-------|-----------------|----------|
| **Локальный пароль** | `ENDEMION_ID` не равен `"1"` | Вход по email + паролю через `/api/auth/login`, регистрация через `/api/auth/register`, сброс через `/api/auth/forgot` и `/api/auth/reset` |
| **Endemion ID (OIDC)** | `ENDEMION_ID = "1"` | Все запросы на `/api/auth/login|register|forgot|reset` возвращают 410. Вход через `auth.endemion.online` по OIDC Authorization Code + PKCE S256 |

### 1.2 OIDC flow (через Endemion ID)

1. Пользователь нажимает «Войти» → `GET /auth/login?next=/путь` → `startLogin()` в `functions/_lib/endemionId.js:127` создаёт запись в `oidc_logins` с `state_hash`, `code_verifier`, `nonce`, `next_path` и перенаправляет на `auth.endemion.online/auth`
2. Провайдер возвращает код на `GET /auth/callback` → `exchangeCode()` обменивает код на токены, проверяя подпись ID token, `iss`, `aud`, `exp`, `nonce`, `state`, PKCE
3. `resolveUser()` ищет или создаёт пользователя в `users` по `endemion_sub` (sub), legacy_user_id или email
4. `createOidcSession()` создаёт сессию сайта с зашифрованным `refresh_token` (AES-GCM, `ENDEMION_ID_TOKEN_KEY`)
5. `refreshSession()` (`endemionId.js:273`) сверяет сессию с Endemion ID раз в 5 минут (`REFRESH_MS`). При отзыве/блокировке — сессия удаляется

### 1.3 Session management

- Cookie `endemion_session` (`HttpOnly; Secure; SameSite=Lax; Max-Age=30 дней`)
- В базе `sessions` хранится только `SHA-256` токена
- `currentUser()` (`session.js:51`) проверяет токен, срок действия, блокировку пользователя, и при OIDC — сверяет с провайдером
- `destroySession()` удаляет сессию из базы и стирает cookie
- `destroyAllSessions()` — после смены пароля

### 1.4 CSRF protection

`functions/api/_middleware.js:11-16` — все изменяющие запросы к `/api/*` принимаются только с заголовком `Origin`, совпадающим с источником запроса. Без Origin — 403.

### 1.5 Rate limiting

`functions/_lib/rateLimit.js` — 5 неудачных входов на email, 30 попыток с IP за 15 мин → 429.

---

## 2. Existing Session and User Identity Resolution

### 2.1 Database tables (relevant to identity)

| Таблица | Миграция | Назначение |
|---------|----------|------------|
| `users` | `0001_init.sql` | id, name, email, password_hash, consent_at, created_at, role, blocked_at, muted_until, endemion_sub |
| `sessions` | `0001_init.sql` | token_hash, user_id, expires_at, created_at (+ refresh_token, refreshed_at, last_ok_at, auth_time для OIDC) |
| `user_profiles` | `0016_platform.sql` | user_id, username, bio, avatar_version, avatar_color, is_public, show_library, show_activity, notify_* |
| `oidc_logins` | `0017_endemion_id.sql` | state_hash, code_verifier, nonce, next_path, expires_at (временные записи входа) |

### 2.2 User identity object (`currentUser()`)

Возвращает: `id`, `name`, `email`, `role`, `username`, `avatar`, `avatarColor`, `isAdmin`, `isModerator`, `viaEndemionId`, `authTime`, `mutedUntil`.

### 2.3 API routes for identity

| Route | Метод | Описание |
|-------|-------|----------|
| `/api/auth/login` | POST | Локальный вход (закрыт при OIDC) |
| `/api/auth/register` | POST | Локальная регистрация (закрыт при OIDC) |
| `/api/auth/logout` | POST | Выход, при OIDC — адрес выхода у провайдера |
| `/api/auth/forgot` | POST | Письмо восстановления (закрыт при OIDC) |
| `/api/auth/reset` | POST | Новый пароль по ссылке (закрыт при OIDC) |
| `/auth/login` | GET | OIDC authorize (когда `ENDEMION_ID=1`) |
| `/auth/callback` | GET | OIDC callback |
| `/auth`, `/reset` | GET | Перенаправление на OIDC (когда `ENDEMION_ID=1`), иначе статические HTML |
| `/api/me` | GET/PATCH/DELETE | Текущий пользователь, смена имени, удаление аккаунта |
| `/api/me/password` | POST | Смена пароля |
| `/api/me/profile` | PATCH | Настройки профиля (имя, username, bio, цвет, приватность) |
| `/api/me/avatar` | PUT/DELETE | Аватар |

---

## 3. Current `/auth`, `/profile`, and `/reset` Behavior

### `/auth` (и `/reset`)

При `ENDEMION_ID=1` (`oidc.js:89-97`):
- `/auth` → 302 на `/auth/login?next=...` (OIDC вход)
- `/auth?mode=register` → `/auth/login?screen=register&next=...`
- `/reset` → 302 на `${ENDEMION_ID_ISSUER}/forgot-password` (восстановление пароля только в Endemion ID)

При `ENDEMION_ID` не установлен:
- `/auth` → `public/auth.html` (страница с формой входа/регистрации, `public/assets/auth.js`)
- `/reset` → `public/reset.html` (страница сброса пароля, `public/assets/reset.js`)

### `/profile` (`site.js:103-195`)

- Сервер отдаёт HTML-каркас с пустыми контейнерами
- `public/assets/profile.js` загружает данные через `/api/me`, `/api/me/profile`
- Вкладки: Обзор (статистика форума, последние темы), Достижения, Настройки (имя, username, bio, цвет аватара, приватность, смена пароля, удаление аккаунта)
- Для OIDC-пользователей: имя/username/パсword меняются только в Endemion ID (`showEndemionId()` скрывает локальные поля)

### `/reset`

При `ENDEMION_ID=1` — перенаправление на `auth.endemion.online/forgot-password`.  
Иначе — `public/reset.html` с формой запроса ссылки (`/api/auth/forgot`) и формы нового пароля (`/api/auth/reset`).

---

## 4. Current Authorization and CSRF Protections

| Защита | Реализация |
|--------|-----------|
| CSRF | `Origin` заголовок на все небезопасные `/api/*` запросы (`_middleware.js`) |
| Session fixation | `destroySession()` перед созданием новой сессии при OIDC callback |
| One-time reset link | `DELETE ... RETURNING` при проверке токена сброса пароля |
| All sessions revoked | `destroyAllSessions()` после смены пароля |
| Rate limiting | 5 попыток на email, 30 с IP за 15 мин |
| Turnstile CAPTCHA | На входе, регистрации, сбросе пароля (если задан `TURNSTILE_SECRET_KEY`) |
| Re-authentication | Опасные действия (удаление аккаунта, выдача ролей) требуют свежего `auth_time` (10 мин) |

---

## 5. Existing Database Tables That Could Support Game Favorites

**Нет подходящей таблицы для favourites игр.** Существующие таблицы относятся к удалённым разделам:

| Таблица | Миграция | Проблема |
|---------|----------|----------|
| `library` | `0002_catalog.sql` | Ссылается на `anime(id)` (таблица из удалённого раздела аниме) |
| `library_new` | `0016_platform.sql` | Ссылается на `titles(id)` (удалённый раздел энциклопедии) |
| `favorites` | `0018_encyclopedia.sql` | Ссылается на `entries(kind, ext_id)` (внешний каталог аниме/манги) |
| `user_list` | `0018_encyclopedia.sql` | Ссылается на `entries(kind, ext_id)` |

**Необходима новая миграция** для таблицы `game_library` (или `game_favorites`) со ссылкой на `users(id)` и `games(id)`.

`functions/_lib/users.js:46` уже содержит `DELETE FROM favorites WHERE user_id = ?` в `deleteUserStatements()` — это код из старой системы, который не повредит новой таблице.

---

## 6. Existing Profile UI and Reusable Components

### 6.1 Private profile (`/profile`)

Серверный каркас в `site.js:103`, клиентская логика в `public/assets/profile.js`:
- Вкладки: Обзор, Достижения, Настройки
- Обзор: статистика форума (темы, ответы, подписчики, достижения), ссылки на форум/уведомления, последние темы
- Настройки: имя, username, bio, цвет аватара, приватность (isPublic, showActivity), смена пароля, удаление аккаунта
- Endemion ID панель: ссылка на аккаунт и Endemion Life

### 6.2 Public profile (`/users/:username`)

Серверный каркас в `site.js:89-100`, клиентская логика загружается через `public/assets/user.js`.

### 6.3 Reusable frontend components (`public/assets/app.js`)

- `api(path, {method, body})` — общий запрос к API с `credentials: "same-origin"`
- `getMe()` — текущий пользователь (`/api/me`)
- `getConfig()` — публичные настройки (`/api/config`)
- `loginUrl()` — ссылка на вход с `?next=`
- `safeNext()` — защита от открытого редиректа
- `avatar(user, extraClass)` — аватар пользователя
- `userLink(user, {small, size})` — имя со ссылкой на профиль
- `openDialog({title, build, submitText, onSubmit})` — модальное окно
- `toast(message, {html, duration})` — уведомление

---

## 7. Existing Test Infrastructure and Authentication Mocks

### 7.1 Integration tests (`tests/`)

| Тестовый файл | Описание |
|---------------|----------|
| `platform.test.mjs` | Вход, регистрация, пароли, сессии, профили, роли |
| `forum.test.mjs` | Форум, комментарии, реакции, модерация |
| `portal.test.mjs` | Главная, игры, разработка, «О студии», безопасность |
| `endemion-id.test.mjs` | OIDC вход через настоящий auth-провайдер (требует запущенного `auth/`) |
| `admin-accounts.test.mjs` | Аккаунты Endemion ID в админке |
| `studio-admin.test.mjs` | Админка портала студии |
| `legal.test.mjs`, `roadmap.test.mjs`, `crypto.test.mjs`, `mail.test.mjs`, `engines.test.mjs` | Разное |

### 7.2 Test helper (`tests/helpers/app.mjs`)

Создаёт временную SQLite базу, применяет все миграции, предоставляет `client()` с cookie сессией и `user(name, role)` для регистрации и входа.

### 7.3 E2E tests (`tests/e2e/`)

Playwright браузерные тесты: `account.spec.mjs` (восстановление пароля), `admin.spec.mjs`, `consent.spec.mjs`, `forum.spec.mjs`, `pwa.spec.mjs`.

### 7.4 Problem: `endemion-id.test.mjs` requires external auth provider

Тест запускает настоящий `auth/` сервис на свободном порту и проводит полный OIDC цикл. Это работает, но требует зависимости от `auth/` проекта.

### 7.5 Known test failure (Stage 03)

Тест скриншотов (`game_media`) в `portal.test.mjs` не проходит — `INSERT` через `app.db` не отображается в ответе сервера. Возможная причина: изоляция базы или разные экземпляры.

---

## 8. Security and UX Issues Found

| ID | Проблема | Severity |
|----|----------|----------|
| S1 | Нет таблицы `game_library` для favourites игр | Medium |
| S2 | Кнопка регистрации скрыта на экранах <=1679px (CSS media query) | Low |
| S3 | Нет API для управления favourite играми | Medium |
| S4 | Нет раздела «Избранные игры» в профиле | Medium |
| S5 | Тест `game_media` не проходит в изолированном окружении | Low |
| S6 | 8 тестов `endemion-id.test.mjs` требуют внешнего auth-провайдера | Medium (преду-existing) |

---

## 9. Files Expected to Change

| Файл | Изменение |
|------|-----------|
| `migrations/0022_game_library.sql` | Новая миграция: таблица `game_library(user_id, game_id, created_at)` |
| `functions/_lib/studio.js` | Хелперы `listGameLibrary(userId)`, `addGameFavorite(userId, gameId)`, `removeGameFavorite(userId, gameId)`, `isGameFavorited(userId, gameId)` |
| `functions/api/users/` | Новые API: `POST /api/users/:username/library`, `DELETE /api/users/:username/library/:game_id`, `GET /api/users/:username/library` |
| `functions/_lib/users.js` | Добавить `DELETE FROM game_library WHERE user_id = ?` в `deleteUserStatements()` |
| `public/assets/profile.js` | Раздел «Избранные игры» в профиле |
| `public/assets/app.js` | Возможно, хелперы для favourite (опционально) |
| `functions/_lib/i18n.js` | Строки для favourites (RU/EN) |
| `public/assets/base.css` или `studio.css` | Стили для кнопки favourites и секции профиля |
| `tests/portal.test.mjs` | Тесты для favourites API |
| `STAGE_04_*.md` | Отчёты |

---

## 10. Implementation Plan Based on Actual Code

### Phase 1 — Game Favorites / Wishlist

1. Создать миграцию `0022_game_library.sql` с таблицей `game_library(user_id, game_id, created_at, PRIMARY KEY(user_id, game_id))`, FOREIGN KEY на `users(id)` и `games(id)`
2. Добавить хелперы в `functions/_lib/studio.js`: `listGameLibrary`, `addGameFavorite`, `removeGameFavorite`, `isGameFavorited`
3. Создать API маршруты в `functions/api/users/`:
   - `GET /api/users/:username/library` — список favourite игр текущего пользователя
   - `POST /api/users/:username/library` — добавить игру в favourite
   - `DELETE /api/users/:username/library/:game_id` — удалить из favourite
4. Зарегистрировать маршруты в `src/worker.js`
5. Добавить кнопку «В избранное/Убрать из избранного» на страницу игры (`/games/:slug`) — только для авторизованных
6. Добавить раздел «Избранные игры» в приватный профиль (`/profile`)
7. Добавить строки в `i18n.js` (RU/EN)
8. Добавить CSS стили

### Phase 2 — Authentication UX

1. Исправить видимость кнопки регистрации на мобильных (<=1679px) — показать кнопку регистрации всегда или сделать её доступной через страницу входа
2. Улучшить визуальную иерархию `/auth` (уже есть хорошая структура, можно уточнить отступы)
3. `/reset` — при `ENDEMION_ID=1` перенаправляет на провайдер, это уже корректно

### Phase 3 — Test Infrastructure

1. Добавить тесты для favourites API в `tests/portal.test.mjs` (или новый файл)
2. Протестировать: добавление, удаление, дубликаты, доступ без авторизации, доступ к чужим favourite, недопустимый game_id
3. Исследовать неисправный тест скриншотов

### Phase 4 — Localization and Responsive QA

1. Все новые строки через `i18n.js`
2. Проверка RU/EN, десктоп/планшет/мобильный

### Phase 5 — Verification

1. `npm test`, `npm run lint`, `npm run typecheck`
2. Исправить новые регрессии
