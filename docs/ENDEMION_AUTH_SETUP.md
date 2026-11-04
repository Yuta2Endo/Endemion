# Endemion ID: запуск и настройка

Код — `auth/` в этом репозитории. Провайдер — `oidc-provider` 9.13, своя база SQLite, страницы без сборки.

## Локальный запуск всех трёх частей

Нужны Node.js 24+, для Life — pnpm 12 и Docker (PostgreSQL и Redis).

```bash
# 1. Endemion ID на http://localhost:3001
cd auth
npm install
cp .env.example .env          # в образце уже есть клиенты для локальных адресов сайта и Life
npm run dev                   # ключ подписи для разработки создастся сам в ../data/auth

# 2. Сайт на http://127.0.0.1:8788 (из корня репозитория)
npm install
# в .env сайта:
#   ENDEMION_ID=1
#   ENDEMION_ID_ISSUER=http://localhost:3001
#   ENDEMION_ID_CLIENT_ID=endemion-web
#   ENDEMION_ID_CLIENT_SECRET=<секрет endemion-web из auth/.env>
#   ENDEMION_ID_TOKEN_KEY=<openssl rand -base64 32>
#   ENDEMION_LIFE_URL=http://localhost:3000
PUBLIC_URL=http://127.0.0.1:8788 PORT=8788 npm start

# 3. Life на http://localhost:3000 (в G:\III\endemion-life)
# в .env Life: ENDEMION_ID=true и четыре ENDEMION_ID_* (секрет endemion-life-web из auth/.env)
pnpm infra:up && pnpm db:migrate && pnpm dev
```

Письма в разработке (`MAIL_DRIVER=outbox` по умолчанию) лежат JSON-файлами в `data/auth/outbox`: оттуда берутся ссылки подтверждения почты и восстановления пароля.

`http://` провайдер сайты принимают только на `localhost` и `127.0.0.1`. В рабочей среде Endemion ID не запустится без `https://` в `AUTH_ISSUER`.

## Настройки Endemion ID

Все переменные описаны в `auth/.env.example`.

| Переменная | Что задаёт |
|---|---|
| `AUTH_ISSUER` | Адрес провайдера без пути, например `https://auth.endemion.online`. Попадает в токены как `iss` |
| `AUTH_COOKIE_KEYS` | Ключи подписи cookie через запятую, каждый от 32 символов. При смене новый ставится первым |
| `AUTH_JWKS_FILE` | Файл ключа подписи токенов RS256. Создаётся `npm run keys -- путь` |
| `OIDC_CLIENTS` | JSON-массив сайтов: `client_id`, `client_secret` (от 32 символов), `platform`, точные `redirect_uris` и `post_logout_redirect_uris` |
| `MAIL_*`, `UNISENDER_*`, `RESEND_API_KEY` | Письма, как у сайта. Без них подтверждение почты и восстановление пароля недоступны |
| `TRUST_PROXY=1` | За Caddy: адрес посетителя и https из `X-Forwarded-*` |
| `AUTH_BACKUP_HOURS`, `AUTH_BACKUP_KEEP` | Копии базы в `data/auth/backups` (по умолчанию раз в 24 часа, 14 штук) |

В рабочей среде провайдер не запустится, если нет ключа подписи, ключи cookie короче 32 символов, секрет клиента короче 32 символов, адрес клиента не `https` или содержит `*`.

## Вход через Google, VK ID и GitHub

Провайдеры подключены к Endemion ID, а не к сайтам: кнопки есть на странице входа auth.endemion.online, поэтому они работают и для Endemion, и для Endemion Life. Сайты по-прежнему получают только `sub` Endemion ID. Провайдер включён, если в `.env` заданы его ключи; без ключей кнопки нет.

| Провайдер | Где создать приложение | Адрес ответа (redirect URI) | Переменные | Scope |
|---|---|---|---|---|
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client ID, тип «Web application». Экран согласия — в статусе «In production» | `https://auth.endemion.online/social/callback/google` | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | `openid email profile` |
| GitHub | Settings → Developer settings → OAuth Apps → New OAuth App, Homepage `https://endemion.online` | `https://auth.endemion.online/social/callback/github` | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` | `user:email` |
| VK ID | Кабинет VK ID для бизнеса (id.vk.ru) → приложение «Веб», базовый домен `auth.endemion.online`, доступ к почте | `https://auth.endemion.online/social/callback/vk` | `AUTH_VK_CLIENT_ID` (числовой ID), `AUTH_VK_SERVICE_TOKEN` (сервисный ключ, только для конфиденциального приложения) | `vkid.personal_info email` |

Адрес ответа указывается у провайдера точно, без `*` и лишнего `/`. После правки `.env` перезапустите только `auth` (`docker compose up -d --no-deps auth`). Сайт и Life перезапускать не нужно.

Как это работает:

- Первый вход: пользователь подтверждает почту, username и согласие с политикой. Пароль не нужен. Почта от провайдера подставляется в форму, но подтверждённой не считается, пока пользователь не откроет письмо Endemion ID.
- Повторный вход сразу возвращает на сайт. Аккаунт находится по постоянному номеру у провайдера (Google `sub`, GitHub `id`, VK `user_id`), а не по почте.
- Если почта уже принадлежит другому Endemion ID, аккаунты не объединяются. Пользователь входит в свой аккаунт паролем и привязывает провайдера на странице аккаунта.
- Страница `/account` → «Способы входа»: привязать и отвязать Google, ВКонтакте и GitHub. Для этого нужен вход не раньше 10 минут назад. Последний способ входа у аккаунта без пароля не отвязывается.

## Клиенты

| client_id | redirect_uri | post_logout_redirect_uri |
|---|---|---|
| `endemion-web` | `https://endemion.online/auth/callback` | `https://endemion.online/` |
| `endemion-life-web` | `https://life.endemion.online/api/auth/oidc/callback` | `https://life.endemion.online/` |

Для обоих: только `code`, PKCE S256 обязателен, `client_secret_basic`, ID token RS256, `auth_time` всегда в ID token. Секрет клиента одинаковый в `OIDC_CLIENTS` провайдера и в `ENDEMION_ID_CLIENT_SECRET` сайта.

## Настройки сайтов

| endemion.online (`.env`) | life.endemion.online (`.env`) | Что задаёт |
|---|---|---|
| `ENDEMION_ID=1` | `ENDEMION_ID=true` | Включить вход через Endemion ID. Без этого всё работает по-старому |
| `ENDEMION_ID_ISSUER` | `ENDEMION_ID_ISSUER` | `https://auth.endemion.online` |
| `ENDEMION_ID_CLIENT_ID` | `ENDEMION_ID_CLIENT_ID` | `endemion-web` / `endemion-life-web` |
| `ENDEMION_ID_CLIENT_SECRET` | `ENDEMION_ID_CLIENT_SECRET` | Секрет клиента |
| `ENDEMION_ID_TOKEN_KEY` | `ENDEMION_ID_TOKEN_KEY` | 32 байта base64 для шифрования refresh token в базе сайта. Смена ключа завершает входы через Endemion ID |
| `ENDEMION_LIFE_URL` | — | Ссылка «Играть» на странице профиля |

## Страницы Endemion ID

| Адрес | Что там |
|---|---|
| `/login`, `/register` | Вход и регистрация в сам Endemion ID (без сайта) |
| `/interaction/:uid` | Вход, на который сайт отправил пользователя |
| `/forgot-password`, `/reset-password` | Восстановление пароля по ссылке из письма (1 час) |
| `/verify-email` | Подтверждение почты по ссылке (24 часа), отдельной кнопкой: почтовые сканеры не тратят ссылку |
| `/account` | Профиль: Endemion ID, username, имя, почта и статус, дата, аватар, смена почты и пароля |
| `/sessions` | Активные сессии, завершение одной или всех остальных |
| `/logout` | Выход (страница подтверждения провайдера) |
| `/healthz` | Проверка для Docker и мониторинга |
| `/.well-known/openid-configuration`, `/jwks`, `/auth`, `/token`, `/me`, `/session/end` | OpenID Connect |

Внешний вид взят у сайта: цвета, шрифты Manrope и Unbounded, формы из `public/assets/account.css`. Тёмная тема, как у сайта; светлой темы на сайте нет, поэтому нет и здесь.

## Проверки

```bash
npm run test:auth      # 34 теста провайдера, переноса пользователей и входа через Google, VK ID, GitHub
npm test               # тесты сайта, в том числе 8 тестов входа через Endemion ID
npm run lint && npm run typecheck
```

В Life: `pnpm test:api` (62 теста, из них 11 — вход через Endemion ID).
