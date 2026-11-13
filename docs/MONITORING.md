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
| Endemion ID | `https://auth.endemion.online/.well-known/openid-configuration` | 200 |

Таймаут на запрос — 10 секунд. Список задан в `monitor/src/index.js` в функции `checks()`, адреса сайта и провайдера можно переопределить переменными `SITE_URL` и `AUTH_URL`.

## Состояние и антиспам

Состояние «сайт лежит» хранится в KV (`STATE`, namespace `endemion-monitor-state`). Благодаря этому:

- при долгом падении приходит одно сообщение, а не по одному каждые 5 минут;
- когда сайт поднимается, приходит отдельное сообщение с временем начала падения.

Если KV недоступен, монитор просто пришлёт алерт о падении ещё раз — это безопаснее, чем промолчать.

## Секреты

| Секрет | Зачем |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота `@EndemionUpdateBot` из @BotFather |
| `MONITOR_KEY` | ключ для ручных проверок `?test=1` и `?me=1` |

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
