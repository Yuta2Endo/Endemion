# STAGE_09_IMPLEMENTATION_REPORT — Телеграм-движок анонсов Endemion Life

Ветка: `site-improve`. Изменения не закоммичены, не запушены и не деплоены.
Автоматический деплой не выполнен. Перед публикацией в канал администратор должен явно вызвать админ-API.

## 1. Аудит архитектуры (этап 01)

- Проект: Endemion (портал studoEndemion, own server + Cloudflare Worker), код без сборки: ES-модули, Pages Functions, один код на Workers (D1, R2) и на своём сервере (SQLite, диск/S3).
- Входные точки: `src/worker.js` — маршрутизатор; `functions/` — обработчики; `server/` — адаптер своего сервера.
- База: миграции `migrations/` (D1 и SQLite одинаковые), актуальная схема — до `0023_game_reviews.sql`.
- Источник релиза: таблица `studio_posts` (миграция `0020_studio.sql`): виды `news/devlog/update/roadmap/announcement`, статусы `draft/published/archived`, дата публикации `published_at`, ссылка на игру `game_id` → `games.website_url` (для Endemion Life — `https://life.endemion.online`).
- Планировщика задач/вебхуков/ cron в проекте нет. Автоматической публикации ничего не требуется — анонс публикуется явно администратором.
- Уже существовал неиспользованный клиент `functions/_lib/telegram.js` (sendTelegramMessage с повторами, 429/5xx, маска токена, без parse_mode) — переиспользован, не перезаписан.
- Переменных Telegram в `.env.example`, `wrangler.toml`, `server/index.mjs` не было.
- Секреты: `.env` и `.dev.vars` не в git; секреты Cloudflare через `wrangler secret put`. Токен бота никогда не попадает в `wrangler.toml` [vars] и не логируется полностью.

## 2. Реализация

### Новые файлы

- `migrations/0024_telegram_announcements.sql` — столбец `version TEXT` в `studio_posts` и таблица `telegram_posts` (post_id UNIQUE → studio_posts, status pending/published/failed, chat_id, message_id, error, attempts, даты). Защита от дублей: один пост — одна запись; статус `published` означает, что анонс уже ушёл в канал.
- `functions/_lib/telegram-announce.js` — ядро движка:
  - `channelOf(env)` — канал из `TELEGRAM_CHANNEL` (по умолчанию `@EndemionOfficial`).
  - `isPublishingAllowed(env)` — публикация разрешена только при `TELEGRAM_PUBLISH=1`.
  - `releaseFromPost(post, game)` — релиз из записи студии: версия, заголовок, заметки, дата, ссылка на игру.
  - `releaseProblems(release)` — проверка обязательных полей (заголовок, заметки, ссылка на игру).
  - `formatAnnouncement(release)` — текст по стилю Endemion (русский, обычный текст без parse_mode, под 4096 знакам):
    ```
    🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ

    Версия: 1.2.0

    Обновление Endemion Life

    ✨ Что нового:
    ...

    📅 9 ноября 2026

    🎮 Играть:
    https://life.endemion.online/

    Официальный Телеграм:
    https://t.me/EndemionOfficial
    ```
  - `announceRelease(env, postId, { dryRun })` — защита от дублей (повторный вызов возвращает `duplicate: true` без новой отправки), валидация метadanych, запись `pending` → отправка через `sendTelegramMessage` (повторы 3×, 429 с `Retry-After`, 5xx) → запись `published`/`failed`. Неуспешная отправка не создаёт дубля: запись остаётся `failed` и повторяется при следующем вызове. `dryRun` — только текст, без отправки и записи. Токен не попадает в логи (`console.error` с ошибкой доставки без токена).
  - `previewRelease(env, postId)` — предварительный просмотр текста без отправки и записи.
  - `pendingReleases(env)` — опубликованные обновления игр, ещё не отправленные в Телеграм.
- `tests/telegram.test.mjs` — 23 теста: формат, маска токена, канал по умолчанию, валидация, удачная публикация, дубль, отсутствие метadanych, неопубликованная/не обновление запись, ошибка API (500 ×3, запись failed, повтор), повременная ошибка (500 → 200), лимит 429 с Retry-After, сухой режим, `TELEGRAM_PUBLISH=0`, токен не в логах, отсутствие токена, админ-API превью/публикация, список pending, 404.

### Изменённые файлы

- `functions/api/adminStudio.js` — поддержка `version` при создании и обновлении публикации; три новых обработчика:
  - `GET /api/admin/studio-posts/:id/telegram-preview` — превью текста (админ, 400 при нехватке данных, 404 если нет публикации).
  - `POST /api/admin/studio-posts/:id/telegram-publish` — явно publicadoвка (админ, `dryRun` — без отправки; 409 если `TELEGRAM_PUBLISH` не включён; 400/404 при ошибках; 200 с `duplicate: true` при повторной публикации).
  - `GET /api/admin/telegram/pending` — список обновлений, не отправленных в Телеграм.
- `src/worker.js` — три новых маршрута в `ROUTE_LIST`.
- `.env.example` — раздел Telegram: `TELEGRAM_BOT_TOKEN` (секрет), `TELEGRAM_CHANNEL=@EndemionOfficial`, `TELEGRAM_PUBLISH=0`.
- `wrangler.toml` — `[vars]`: `TELEGRAM_CHANNEL`, `TELEGRAM_PUBLISH`; токен только секретом (`npx wrangler secret put TELEGRAM_BOT_TOKEN`).
- `server/index.mjs` — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL`, `TELEGRAM_PUBLISH` добавлены в `WORKER_VARS` (своё серверное окружение).

## 3. Требуемые переменные окружения

| Переменная | Где | Примечание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `.env` / секрет Cloudflare | Токен от @BotFather. Только секрет: не в `wrangler.toml`, не в git, не в логах, не во фронтенд. |
| `TELEGRAM_CHANNEL` | `.env`, `wrangler.toml [vars]` | Канал по умолчанию `@EndemionOfficial`. |
| `TELEGRAM_PUBLISH` | `.env`, `wrangler.toml [vars]` | `1` — разрешить публикацию в канал; `0` — только превью (по умолчанию). |

## 4. Настройка бота Telegram (владелец проекта)

1. Создать бота через @BotFather, получить токен.
2. Добавить бота как администратора канала @EndemionOfficial с правом публикации сообщений (проверить вручную, что бот может писать в канал).
3. Сервер (VPS): `TELEGRAM_BOT_TOKEN=...` в `.env`, перезапуск `docker compose up -d app`.
4. Cloudflare: `npx wrangler secret put TELEGRAM_BOT_TOKEN`, затем `npm run deploy` (сначала `npm test` через `predeploy`).
5. Когда готово к публикациям: `TELEGRAM_PUBLISH=1`. До этого момента любые вызовы публикации возвращают 409.

## 5. Рабочий цикл публикации релиза

1. Администратор создаёт в админке публикацию студии kind `update`, статус `published`, привязанную к игре (Endemion Life — ссылка `https://life.endemion.online`), с версией и текстом обновления.
2. (Опционально) `GET /api/admin/studio-posts/:id/telegram-preview` — проверить текст анонса без отправки.
3. `GET /api/admin/telegram/pending` — список обновлений, ещё не отправленных.
4. `POST /api/admin/studio-posts/:id/telegram-publish` — явная публикация в канал. Работает только при `TELEGRAM_PUBLISH=1`.
5. Результат записывается в `telegram_posts`; повторный вызов того же поста вернёт `duplicate: true` без новой отправки.
6. Автоматизации нет: ни по расписанию, ни при сохранении публикации.

## 6. Результаты тестирования

- `npm test`: 118 из 118 (все существующие suite) — пройдены.
- `tests/telegram.test.mjs`: 23 из 23 — пройдены (формат сообщения, дубли, ошибки API, повторы, лимит 429, сухой режим, защита токена, админ-API, превью, 404).
- `npm run lint` — чисто.
- `npm run typecheck` — чисто.
- E2E/браузерные тесты и проверка на рабочем домене не運行лись (требуют развёрнутого окружения и браузеры Playwright).

## 7. Меры безопасности

- Токен бота только в переменной окружения/секрете; никогда не в коде, не в git, не в `wrangler.toml [vars]`, не в фронтенде.
- Полный токен не логируется: ошибки доставки пишутся без токена; `maskToken` показывает только первые и последние 4 символа.
- Публикация только от администратора (`requireAdmin` на каждом админ-маршруте, CSRF-проверка Origin через `_middleware.js`).
- Публикация в канал заблокирована пока `TELEGRAM_PUBLISH != "1"`.
- Нет публичного endpoints для произвольной рассылки в Telegram.
- Сообщения обычным текстом без `parse_mode` — нет риска интерпретации пользовательского разметки; длина обрезается клиентом Telegram API до 4000 знаков.

## 8. Инструкция по развёртыванию (не автоматическая)

Своё сервер (Docker + VPS, см. DEPLOY.md):
1. Добавить переменные в `.env`, `mkdir -p data && chown 1000:1000 data`.
2. `docker compose up -d --build` — миграция `0024` применяется автоматически при запуске (с резервной копией рабочей базы).
3. Убедиться, что `https://<домен>/healthz` отвечает `ok`.

Cloudflare Worker:
1. `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
2. `npm run deploy` (`predeploy` запускает тесты).

Никакое автоматическое опубликование в канал не настроено.

## 9. Ограничения

- Публикация только по явному действию администратора; нет автоматического расписания (в проекте нет инфраструктуры cron/очередей).
-дин администратор может опубликовать один пост один раз (уникальность post_id).
- Текст анонса — обычный текст без Markdown/HTML-разметки Telegram.
- Проверка прав бота в канале (@EndemionOfficial) выполнена вручную владельцем; код не сверяет `can_post_messages`.
- E2E-тесты Playwright для новых маршрутов не добавлены.
- Изменения не закоммичены, не запушены, не деплоены.

## 10. Итог

Движок анонсов реализован над существующими сущностями (`studio_posts` — обновления игр, `telegram.js` — клиент Bot API). Публикация безопасна (секрет вне кода и логов), надёжна (защита от дублей, повторы, обработка 429, статус доставки) и контролируема (превью, сухой режим, отдельный флажок `TELEGRAM_PUBLISH`, только админ, только явно).
