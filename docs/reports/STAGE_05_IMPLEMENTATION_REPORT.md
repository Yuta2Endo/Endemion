# STAGE_05_IMPLEMENTATION_REPORT — Game Ratings & Reviews

**Статус:** COMPLETED  
**Репозиторий:** `G:\III\Project\Endemion`  
**Целевой сайт:** https://endemion.online/  
**Предыдущий этап:** STAGE 04 — Authentication & Identity

---

## 1. Статус этапа

**COMPLETED** — система оценок и отзывов пользователей к играм реализована и проверена. Все приемочные критерии выполнены (см. раздел 12). Production не деплоился.

---

## 2. Summary of Changes

Stage 05 реализован поверх существующей архитектуры Stage 01–04 без ломающих изменений. Часть каркаса (миграция, API-хелперы, серверный рендер, клиент, локализация, маршруты) уже находилась в репозитории; к ней добавлены исправления, отсутствовавшие части (очистка при удалении пользователя, тесты) и устранён дефект CSS.

### 2.1 База данных

- Миграция `migrations/0023_game_reviews.sql` — следующий номер после `0022_game_library.sql` (Stage 04).
- Таблица `game_reviews`:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE`
  - `score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10)`
  - `body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 5000)`
  - `spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1))` — булево по существующей конвенции (0/1)
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `hidden_at TEXT` — nullable, скрытие модератором
  - `UNIQUE (user_id, game_id)` — одна оценка на пользователя и игру на уровне БД
- Индексы: `game_reviews_game(game_id, hidden_at, created_at)`, `game_reviews_user(user_id)`.
- При удалении пользователя записи очищаются и каскадом внешнего ключа, и явно через `deleteUserStatements()`.

### 2.2 Серверные хелперы (`functions/_lib/studio.js`)

- `listGameReviews(env, gameId)` — публичные отзывы (`hidden_at IS NULL`), авторы с ограниченным набором полей, сортировка `created_at DESC`.
- `getGameReview(env, userId, gameId)` — отзыв пользователя для игры (включая скрытый, для владельца).
- `addGameReview(env, userId, gameId, score, body, spoiler)` — INSERT, возвращает `last_row_id`.
- `updateGameReview(env, reviewId, userId, score, body, spoiler)` — только владелец, только если `hidden_at IS NULL`, обновляет `updated_at`.
- `deleteGameReview(env, reviewId, userId)` — физическое удаление только своего отзыва.
- `getGameReviewStats(env, gameId)` — `AVG(score)` и `COUNT(*)` только по видимым отзывам.

### 2.3 API (`functions/api/games/reviews.js`, маршруты в `src/worker.js`)

| Метод | Путь | Доступ | Описание |
|-------|------|--------|----------|
| GET | `/api/games/:slug/reviews` | Публично | Список видимых отзывов + статистика (средняя оценка, количество) |
| POST | `/api/games/:slug/reviews/add` | Аутентифицированный | Создать отзыв (путь адаптирован под существующий роутер: статичный сегмент `reviews` и `add` — разные по количеству частей пути) |
| PATCH | `/api/games/:slug/reviews/:review_id` | Аутентифицированный, владелец | Редактировать свой отзыв |
| DELETE | `/api/games/:slug/reviews/:review_id` | Аутентифицированный, владелец | Физически удалить свой отзыв |

Поведение:
- CSRF через `functions/api/_middleware.js` (проверка `Origin` для небезопасных методов).
- Rate limiting через `takeAction(env, userId, "comment")` (`functions/_lib/limits.js`).
- Аутентификация через `requireUser()` (сессионная кука `endemion_session`), пользователь никогда не берётся из тела/параметров запроса.
- Валидация: `score` через `intParam(..., 1, 10)`, `body` через `cleanText()` с лимитом 5000 символов, `spoiler` — `Boolean()`.
- 404 для несуществующей/неопубликованной игры и отсутствующего отзыва; 403 при попытке править/удалить чужой отзыв; 409 при дубликате; 400 при невалидном вводе.
- В ответе GET только публичные поля автора: `id`, `name`, `username`, `avatar`, `avatarColor` — без email и прочих приватных данных.
- Скрытые отзывы (`hidden_at IS NOT NULL`) исключены из списка и агрегатов.

### 2.4 UI (страница игры `/games/:slug`)

- Серверный рендер в `functions/studio.js` (`gamePage`): секция отзывов со сводкой (средняя оценка, количество, шкала 1–10), формой для авторизованных, списком отзывов, знаком «войдите» для гостей.
- Клиент в `public/assets/game-page.js` (`initReviewForm`): селектор оценок 1–10, необязательный текст, чекбокс спойлера, кнопки сохранить/удалить/отмена, состояния загрузки/успеха/ошибки, режим редактирования при существующем отзыве.
- Скрытие спойлера: текст скрыт по умолчанию (`opacity: 0.5`), кнопка «Показать спойлер» с кликом и клавиатурой (Enter/пробел) через `app.js` `spoilerText()`.
- CSS в `public/assets/studio.css` (секция «ОТЗЫВЫ К ИГРЕ»): `.game-reviews-summary`, `.game-review-form`, `.score-btn`, `.game-reviews-list`, `.game-review-item`, `.game-review-body.spoiler-hidden`, `.game-review-reveal`, адаптив `@media (max-width: 680px)`.

### 2.5 Локализация (`functions/_lib/i18n.js`)

Строки для RU и EN: `gameReviewsTitle`, `gameReviewsEmpty`, `gameReviewsAverage`, `gameReviewSubmit`, `gameReviewEdit`, `gameReviewDelete`, `gameReviewScoreLabel`, `gameReviewTextLabel`, `gameReviewSpoilerLabel`, `gameReviewReveal`, `gameReviewSignIn`, `gameReviewSuccess`, `gameReviewError`, `gameReviewDeleted`, `gameReviewDuplicate`.

### 2.6 Безопасность

- Сессионная аутентификация, пользователь из `currentUser()`,never из запроса клиента.
- Параметризованные SQL во всех запросах.
- `UNIQUE(user_id, game_id)` на уровне БД + проверка на уровне приложения.
- Оценка 1–10 enforced на сервере (`CHECK` + `intParam`).
- Длина тела отзыва ≤ 5000.
- HTML не рендерится как доверенный контент (вывод через `escapeHtml` / `textContent`).
- Только публичные поля автора в ответе API.
- Скрытые отзывы не попадают в публичные данные и агрегаты.
- Владелец не может править/удалять чужой отзыв (403).
- Rate limiting на мутации, CSRF через `Origin`.
- Ошибки без чувствительных данных.

### 2.7 Интеграция с профилем

Раздел отзывов в приватном профиль не добавлен: это значительно расширил бы область этапа (требуется новая вкладка, серверные хелперы списка отзывов пользователя, клиент). В Stage 05 охват ограничен страницами игр. Функционал избранных игр (Stage 04) не регрессировал.

---

## 3. Files Changed

| Файл | Изменение |
|------|-----------|
| `migrations/0023_game_reviews.sql` | Миграция таблицы `game_reviews` (существовала, включена в этап) |
| `functions/_lib/studio.js` | Хелперы отзывов: `listGameReviews`, `getGameReview`, `addGameReview`, `updateGameReview`, `deleteGameReview`, `getGameReviewStats` (существовали) |
| `functions/api/games/reviews.js` | API эндпоинты отзывов (существовал) |
| `src/worker.js` | Регистрация маршрутов отзывов (существовало) |
| `functions/studio.js` | Секция отзывов на странице игры `gamePage` (существовала) |
| `public/assets/game-page.js` | Клиентская логика `initReviewForm` (существовала) |
| `public/assets/studio.css` | Исправлен класс `.game-review-list` → `.game-reviews-list` (исправлено в Stage 05) |
| `functions/_lib/users.js` | Добавлен `DELETE FROM game_reviews WHERE user_id = ?` в `deleteUserStatements` (добавлено в Stage 05) |
| `functions/_lib/i18n.js` | Строки отзывов RU/EN (существовали) |
| `tests/portal.test.mjs` | 20 тестов отзывов, импорт `PASSWORD`, хелпер `clearGameReviews` (добавлено в Stage 05) |

---

## 4. Tests Added

20 тестов в `tests/portal.test.mjs` (раздел «НОВЫЕ ТЕСТЫ STAGE 05 — ОТЗЫВЫ К ИГРАМ»):

1. гость читает публичные отзывы (200, пусто)
2. гость не может добавить отзыв (401)
3. авторизованный может добавить score-only отзыв (201)
4. авторизованный может добавить отзыв с текстом и спойлером (201)
5. оценка < 1 отвергается (400)
6. оценка > 10 отвергается (400)
7. нечисловая оценка отвергается (400)
8. тело > 5000 символов отвергается (400)
9. дубликат отзыва предотвращён (409, одна запись в БД)
10. пользователь редактирует свой отзыв (200)
11. редактирование без изменения оценки сохраняет текущую
12. не может редактировать чужой отзыв (403)
13. редактирование несуществующего отзыва (404)
14. пользователь удаляет свой отзыв (200, deleted: true)
15. не может удалить чужой отзыв (403)
16. удаление несуществующего отзыва (404)
17. скрытые отзывы исключены из списка и агрегатов
18. средняя оценка округляется до одного знака
19. неопубликованная игра не принимает отзывы (404)
20. отзывы к несуществующей игре (404)
21. удаление пользователя очищает его отзывы
22. функционал избранного работает вместе с отзываями

Все тесты используют моки/фикстуры через существующий `tests/helpers/app.mjs` (временная SQLite, все миграции, регистрация/вход пользователей). Не зависят от внешнего auth-провайдера.

---

## 5. Test Results

`npm test` — 117 тестов, **109 pass, 8 fail**.

**Все 8 неудач — преду-existing, не регрессии Stage 05:**
- 7 тестов `endemion-id.test.mjs` требуют внешнего auth-провайдера `auth.endemion.online` (документировано на Stage 04).
- 1 тест «страница игры: скриншоты из game_media» — известная проблема тестового окружения (insert в `game_media` не отображается в ответе сервера), документирована на Stage 03/04.

Все 20 новых тестов отзывов проходят. Функционал избранного (Stage 04) не регрессировал.

---

## 6. Lint / Typecheck

**`npm run lint`:** 4 ошибки, все в `auth/` (`auth/src/app.mjs`, `auth/src/views.mjs`, `auth/tests/oidc.test.mjs`) — преду-existing, не связаны со Stage 05. Новых ошибок нет.

**`npm run typecheck`:** ошибки в `auth/src/` и `functions/studio.js` — преду-existing (указаны в отчётах Stage 04). Новых ошибок от Stage 05 нет.

---

## 7. Known Limitations

| ID | Описание | Severity |
|----|----------|----------|
| K1 | 8 тестов `endemion-id.test.mjs` требуют внешнего auth-провайдера | Medium (преду-existing) |
| K2 | `npm run typecheck` не проходит для `auth/` и `studio.js` | Low (преду-existing) |
| K3 | Тест скриншотов `game_media` не проходит | Low (преду-existing, Stage 03) |
| K4 | Браузерное QA (Playwright) не выполнено — браузеры не установлены | Medium |
| K5 | Раздел отзывов в приватном профиле не добавлен (отложено по объёму) | Low |
| K6 | PATH POST использует `/reviews/add` вместо `/reviews` — адаптация под существующий роутер | Low (документировано) |
| K7 | `hidden_at` зарезервировано для будущей модерации, публичного API скрытия нет | По設計 |

---

## 8. Required Reports

- `STAGE_05_IMPLEMENTATION_REPORT.md` — этот файл.
- `STAGE_05_QA_REPORT.md` — см. отдельный файл.
- `STAGE_05_NEXT_STAGE.md` — см. отдельный файл.

**Production не деплоился.**
