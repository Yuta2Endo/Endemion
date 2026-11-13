# Мониторинг и алерты

Сайт проверяется отдельным Cloudflare Worker'ом `endemion-monitor` каждые 5 минут. При падении в канал `@EndemionOfficial` уходит одно сообщение со списком упавших проверок, при восстановлении — одно сообщение о том, что всё снова работает.

Почему не с сервера: с VPS `api.telegram.org` недоступен (соединение обрывается по таймауту), а у Cloudflare доступ к Telegram есть. Поэтому алерты шлёт Worker, а не cron на сервере.

## Что проверяется

| Проверка | Адрес | Успех |
| --- | --- | --- |
| главная | `https://endemion.online/` | 200 |
| игры | `/games` | 200 |
| сообщество | `/community` | 200 |
| аккаунт | `/account` | 200 |
| API входа | `/api/me` | 200 |
| sitemap | `/sitemap.xml` | 200 |
| healthz | `/healthz` | 200 и тело `ok` |
| бэкапы | `/healthz/backup` | 200 (503 — копия устарела или выгрузка в хранилище не удалась) |
| Endemion ID | `https://auth.endemion.online/.well-known/openid-configuration` | 200 |

Таймаут на запрос — 10 секунд. Список задан в `monitor/src/index.js` в функции `checks()`, адреса сайта и провайдера можно переопределить переменными `SITE_URL` и `AUTH_URL`.

## Проверка резервных копий

`/healthz/backup` отдаёт JSON о состоянии бэкапов и код 503, если что-то не так:

```json
{"ok":true,"latest":"2026-11-14T03:17:08.548Z","ageHours":0,"maxAgeHours":30,"remote":{"at":"2026-11-14T03:17:10.000Z","ok":true,"key":"s3://endemio/backups/endemion-...sqlite"},"problems":[]}
```

- Бэкап старше `BACKUP_HOURS + 6` часов (по умолчанию 30) — `ok: false` и причина в `problems`.
- После каждой копии в `data/backups/last-remote.json` пишется отчёт о выгрузке в S3: успешная (`ok: true`, ключ объекта) или неудачная (`ok: false`, текст ошибки). Ошибка выгрузки тоже даёт 503 — иначе копия могла бы годами лежать только на диске сервера.
- Если S3 не настроен (`BACKUP_S3_BUCKET` пуст), отчёта нет и проверяется только свежесть локального файла.

Логика вынесена в `server/backupStatus.mjs` и покрыта тестами `tests/backup-status.test.mjs`.

## Состояние и антиспам

Состояние «сайт лежит» хранится в KV (`STATE`, namespace `endemion-monitor-state`). Благодаря этому:

- при долгом падении приходит одно сообщение, а не по одному каждые 5 минут;
- когда сайт поднимается, приходит отдельное сообщение с временем начала падения.

Если KV недоступен, монитор просто пришлёт алерт о падении ещё раз — это безопаснее, чем промолчать.

## Секреты

| Секрет | Зачем |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота `@EndemionUpdateBot` из @BotFather |
| `MONITOR_KEY` | ключ для ручных проверок `?test=1`, `?me=1` и админ-запросов `/admin` |

Ставятся один раз:

```
npx wrangler secret put TELEGRAM_BOT_TOKEN --config monitor/wrangler.toml
npx wrangler secret put MONITOR_KEY --config monitor/wrangler.toml
```

Секреты живут только в Cloudflare, в репозиторий и в `.env` они не попадают. Бот должен быть администратором канала `@EndemionOfficial` с правом публикации.

## Ручные проверки

```bash
# все проверки прямо сейчас, ответ — JSON
curl https://endemion-monitor.<account>.workers.dev/

# тестовое сообщение в канал
curl "https://endemion-monitor.<account>.workers.dev/?test=1&key=<MONITOR_KEY>"

# кто такой бот (имя, id, права)
curl "https://endemion-monitor.<account>.workers.dev/?me=1&key=<MONITOR_KEY>"
```

## Управление каналом

С машины и с сервера Telegram недоступен, поэтому канал можно править через воркер: `POST /admin?key=<MONITOR_KEY>` с телом `{"method": "...", "params": {...}}`. Метод можно передать и в query (`?key=...&method=getChat`).

| Метод | Что делает |
| --- | --- |
| `getChat`, `getChatMemberCount`, `getChatAdministrators`, `getChatMember`, `getChatMenuButton` | чтение состояния канала и прав |
| `sendMessage`, `editMessageText`, `deleteMessage`, `pinChatMessage`, `unpinChatMessage` | посты |
| `setChatTitle`, `setChatDescription`, `setChatPhoto` | оформление канала |
| `exportChatInviteLink`, `createChatInviteLink`, `revokeChatInviteLink` | ссылки-приглашения |
| `preview` | посты публичной ленты (`{id, text}`); `{"method":"preview","params":{"raw":true}}` — исходный HTML `t.me/s` |
| `downloadPhoto` | байты текущего фото канала (`getFile` + проксирование) |

Список разрешённых методов задан в `monitor/src/index.js` (`ADMIN_READ` и `ADMIN_WRITE`) — всё остальное отклоняется, чтобы ключ не превратился в универсальный доступ к боту.

```bash
# описание канала
curl -X POST "https://endemion-monitor.<account>.workers.dev/admin?key=<MONITOR_KEY>" \
  -H "content-type: application/json" \
  -d '{"method":"setChatDescription","params":{"description":"Официальный канал Endemion — цифровая экосистема: игры, сообщество и единый вход Endemion ID.\n🌐 endemion.online"}}'

# пост в канал (HTML, без превью ссылок)
curl -X POST "https://endemion-monitor.<account>.workers.dev/admin?key=<MONITOR_KEY>" \
  -H "content-type: application/json" \
  -d '{"method":"sendMessage","params":{"text":"<b>Привет</b>","parse_mode":"HTML","link_preview_options":{"is_disabled":true}}}'

# что сейчас в публичной ленте
curl -X POST "https://endemion-monitor.<account>.workers.dev/admin?key=<MONITOR_KEY>" \
  -H "content-type: application/json" -d '{"method":"preview"}'
```

Права бота ограничены тем, что владелец выдал в настройках канала: например, без права «Изменение информации канала» `setChatDescription` вернёт `not enough rights to set chat description`.

## Выкладка и логи

```bash
npm run monitor:deploy   # выложить воркер и cron
npm run monitor:tail     # смотреть логи в реальном времени
```

Адрес воркера: `https://endemion-monitor.sasha-guseynov2005tm.workers.dev`. Cron задан в `monitor/wrangler.toml` (`*/5 * * * *`), 288 запусков в сутки — в бесплатный лимит укладывается с запасом.

## Связь с публикацией анонсов

Тот же бот используется сайтом для анонсов публикаций (`functions/_lib/telegram.js`). Публикация выключена переменной `TELEGRAM_PUBLISH=0`. Чтобы включить, нужно:

1. положить токен секретом сайта: `npx wrangler secret put TELEGRAM_BOT_TOKEN`;
2. поставить `TELEGRAM_PUBLISH=1` в `wrangler.toml`;
3. выложить сайт (`npm run deploy`).

Проверять публикацию лучше в сухом режиме — в админке есть предпросмотр текста без отправки.
