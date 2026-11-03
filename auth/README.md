# Endemion Auth

Централизованный OpenID Connect Provider для единой авторизации в экосистеме Endemion.

## Что это

**Endemion ID** — единый аккаунт для всех сервисов:
- endemion.online (платформа для читателей манги)
- life.endemion.online (симулятор жизни)
- будущие сервисы Endemion

Пользователь регистрируется один раз на auth.endemion.online и входит на все сайты без повторного ввода пароля (Single Sign-On через OpenID Connect).

## Технологии

- **Node.js 24+**
- **oidc-provider 9.13** (сертифицированная реализация OpenID Connect)
- **Koa 3** (веб-фреймворк)
- **SQLite** (база аккаунтов Endemion ID)

## Локальный запуск

```bash
cd auth
cp .env.example .env
# Отредактируйте .env: задайте COOKIE_SECRET и TOKEN_SECRET (случайные строки)

npm install
npm run migrate          # Создать базу auth.sqlite
npm run dev              # Сервер на http://localhost:3001
```

Откройте http://localhost:3001/.well-known/openid-configuration — если видите JSON с конфигурацией OIDC, провайдер работает.

## Импорт пользователей Endemion

После развёртывания Auth нужно импортировать существующих пользователей основного сайта:

```bash
npm run import-users
```

Скрипт:
1. Читает `../data/endemion.sqlite` (база основного сайта)
2. Копирует users + user_profiles в auth.sqlite
3. Сохраняет старые хеши паролей PBKDF2 (проверяются при первом входе и перехешируются в scrypt)
4. Создаёт связь `platform_links`: endemion users.id → auth accounts.sub

## Структура

```
auth/
├── src/
│   ├── server.mjs           # Точка входа: Koa + oidc-provider
│   ├── migrate.mjs          # Применение миграций
│   ├── config.mjs           # Чтение .env
│   ├── adapter.mjs          # SQLite adapter для oidc-provider
│   ├── account.mjs          # Поиск аккаунтов, проверка паролей
│   └── routes/
│       ├── login.mjs        # GET/POST /auth/login
│       ├── register.mjs     # GET/POST /auth/register
│       ├── logout.mjs       # POST /auth/logout
│       └── profile.mjs      # GET /account (профиль Endemion ID)
├── migrations/
│   ├── 0001_init.sql        # accounts, sessions, platform_links
│   └── 0002_legacy_hashes.sql
├── public/                  # Статические файлы (CSS, JS)
├── scripts/
│   └── import-endemion-users.mjs
├── tests/
└── package.json
```

## Миграции

Схема базы auth.sqlite:

**accounts** — аккаунты Endemion ID
- `sub` UUID PRIMARY KEY (OIDC subject claim, неизменяемый)
- `email` TEXT UNIQUE
- `email_verified_at` TEXT (timestamp подтверждения)
- `username` TEXT UNIQUE (3-24 символа, alphanumeric + underscore)
- `display_name` TEXT (отображаемое имя)
- `avatar_url` TEXT
- `password_hash` TEXT (scrypt$...)
- `legacy_password_hash` TEXT (pbkdf2$... для импортированных из Endemion, NULL после первого входа)
- `created_at`, `updated_at`

**platform_links** — связь аккаунтов с платформами
- `account_sub` UUID → accounts(sub)
- `platform` TEXT ('endemion' | 'endemion_life')
- `platform_user_id` TEXT (Endemion: users.id INTEGER, Life: players.id UUID)
- PRIMARY KEY (account_sub, platform)

**auth_tokens** — коды подтверждения email и токены сброса пароля
- SHA-256 хранение, TTL, max attempts

**Таблицы oidc-provider:** Session, AccessToken, AuthorizationCode, RefreshToken, etc. (управляются adapter.mjs)

## Интеграция с сайтами

### Endemion (основной сайт)

1. Установить `openid-client` в основной сайт
2. Добавить `functions/api/auth/oidc-callback.js`
3. В `functions/_lib/session.js` добавить `currentUserFromOIDC()`
4. После OIDC login создать запись в platform_links
5. Переключатель `.env`: `USE_OIDC_AUTH=1`

### Endemion Life

1. Установить `openid-client` в apps/api
2. Добавить OIDC endpoints в auth.controller.ts
3. На регистрацию: создать аккаунт в Auth → вернуться в Life → связать с guest Player → transfer lives
4. Переключатель: `USE_OIDC_AUTH=true`

## Production

В docker-compose.yml основного сайта:

```yaml
services:
  auth:
    build: ./auth
    environment:
      ISSUER: auth.endemion.online
      PUBLIC_URL: https://auth.endemion.online
      AUTH_DB_FILE: /app/data/auth.sqlite
      COOKIE_SECRET: ${AUTH_COOKIE_SECRET}
      TOKEN_SECRET: ${AUTH_TOKEN_SECRET}
      OIDC_CLIENTS: ${AUTH_OIDC_CLIENTS}
    volumes:
      - ./data:/app/data
    expose:
      - "3001"
```

В Caddyfile:

```
auth.{$SITE_DOMAIN} {
  encode zstd gzip
  reverse_proxy auth:3001
}
```

## Документация

См. `../docs/`:
- ENDEMION_ECOSYSTEM_AUDIT.md — аудит существующих систем
- ENDEMION_ECOSYSTEM_ARCHITECTURE.md — архитектура SSO
- ENDEMION_AUTH_SETUP.md — подробная настройка
- ENDEMION_ACCOUNT_MIGRATION.md — стратегия миграции
- ENDEMION_SECURITY.md — безопасность

## Лицензия

Приватный проект. Код не для публичного использования.
