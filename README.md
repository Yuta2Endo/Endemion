# Endemion

Каталог манги, манхвы и маньхуа на Cloudflare Workers: статические страницы в `public/`, API в `functions/`, база — Cloudflare D1.
Сайт: https://endemion.sasha-guseynov2005tm.workers.dev

## Структура

```
src/worker.js           точка входа Worker: маршруты API и страниц, остальное отдаётся из public/
public/                 статика: index, auth, profile, privacy, 404, _headers, assets/
functions/              обработчики в формате Pages Functions, их вызывает src/worker.js
  _lib/                 общий код: сессии, хеширование, проверки, ограничение попыток
  api/                  /api/* — регистрация, вход, профиль, каталог (/api/titles), полка (/api/library)
  title/[id].js         /title/:id — страница тайтла, HTML собирается на сервере
  robots.txt.js, sitemap.xml.js
migrations/             схема D1 и демо-каталог
tests/                  юнит-тесты и проверка API
```

## Безопасность аккаунтов

- Пароли: PBKDF2-SHA256, 100 000 итераций, своя соль у каждого пароля. Сам пароль нигде не хранится.
- Сессия: случайный токен в cookie `HttpOnly; Secure; SameSite=Lax` на 30 дней. В базе хранится только SHA-256 токена.
- Перебор пароля: 5 неудачных входов в аккаунт или 30 попыток с одного IP за 15 минут, дальше ответ 429.
- CSRF: изменяющие запросы к `/api/*` принимаются только с заголовком `Origin` своего сайта.
- После смены пароля завершаются все остальные сессии. Удаление аккаунта требует пароль.
- Turnstile (капча) включается, если задать ключи. Без ключей форма работает без капчи.
- CSP без `unsafe-inline`: в страницах нет встроенных скриптов и стилей.

## Локальный запуск

```
npm install
npm run db:migrate:local
npm run dev                 # http://localhost:8787
npm test                    # юнит-тесты
npm run test:api            # проверка API на запущенном dev-сервере
npm run test:admin          # проверка админки на запущенном dev-сервере
npm run test:e2e            # читалка в Chromium, Firefox, WebKit, Android и iPhone (Playwright)
```

Браузеры для `test:e2e` ставятся один раз: `npx playwright install chromium firefox webkit`. Если dev-сервер не запущен, Playwright запустит его сам. Тесты создают свои тайтлы с демо-страницами и в конце удаляют их.

## Деплой

База D1 `endemion` уже создана, её id записан в `wrangler.toml`.

1. Войти в Cloudflare: `npx wrangler login`
2. Если в `migrations/` появились новые файлы: `npm run db:migrate:remote`. Перед миграцией скрипт сам выгружает рабочую базу в `backups/` (`npm run db:backup`); без резервной копии миграция не запускается. Папка `backups/` не попадает в git: в выгрузке почты и хеши паролей.
3. Деплой: `npm run deploy`. Сначала запускаются юнит-тесты (`predeploy`), при ошибке сайт не выкладывается.

Восстановление базы: `npx wrangler d1 execute endemion --remote --file backups/<файл>.sql` в пустую базу или откат на момент до миграции через `npx wrangler d1 time-travel restore endemion --timestamp=<время>`.

## Восстановление пароля

Письма со ссылкой для нового пароля отправляет [Resend](https://resend.com). Пока ключ и отправитель не заданы, восстановление выключено и ссылка «Забыли пароль?» не показывается. Адрес `workers.dev` подтвердить в Resend нельзя, поэтому нужен свой домен.

1. Зарегистрироваться в Resend, добавить домен (Domains → Add Domain) и внести показанные DNS-записи у регистратора. Дождаться статуса Verified.
2. Создать ключ API с правом Sending access и сохранить его секретом: `npx wrangler secret put RESEND_API_KEY`.
3. В `wrangler.toml` указать отправителя: `MAIL_FROM = "Endemion <noreply@ваш-домен>"`, затем `npm run deploy`.

Локально письма не отправляются: в файле `.dev.vars` задать `MAIL_DEV_MODE=1`, и ссылка из письма появится прямо на странице `/reset`. На сайте этот режим не работает, даже если переменная задана.

## Админка

Страница `/admin`: тайтлы, главы и загрузка страниц в R2 (бакет `endemion-pages`). Права выдаются только командой, через сайт стать администратором нельзя:

```
npx wrangler d1 execute endemion --remote --command "UPDATE users SET is_admin = 1 WHERE email = 'почта@example.com'"
```

Снять права: то же с `is_admin = 0`. Страницы главы сначала грузятся в черновик и видны читателям только после публикации, поэтому оборванная загрузка не ломает главу. Проверка админки на локальном сервере: `npm run test:admin`.

Публикуйте только главы, на которые есть права.

Не загружайте сайт через панель Cloudflare перетаскиванием папки: так заменится Worker, и API с базой перестанут работать.

При переходе на свой домен заменить адрес `https://endemion.sasha-guseynov2005tm.workers.dev/` в `public/index.html` (canonical и og).

Необязательно:
- Turnstile: создать виджет в панели Cloudflare, публичный ключ вписать в `TURNSTILE_SITE_KEY` в `wrangler.toml`, секретный задать командой `npx wrangler secret put TURNSTILE_SECRET_KEY`.
- Web Analytics: включить в панели Cloudflare. CSP уже разрешает его скрипт.
- Git: подключить репозиторий в панели Workers (Settings → Build), чтобы сайт обновлялся при каждом push.

## Перед запуском для людей

- Заполнить данные оператора в `public/privacy.html` и проверить текст с юристом (152-ФЗ).
- Каталог пуст: тайтлы добавляются миграциями. Публиковать можно только главы, на которые есть права.
