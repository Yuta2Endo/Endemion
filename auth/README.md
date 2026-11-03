# Endemion ID

Единый аккаунт для endemion.online и life.endemion.online: OpenID Connect провайдер на `auth.endemion.online`.
Провайдер — [oidc-provider](https://github.com/panva/node-oidc-provider) 9.13, база SQLite, страницы без сборки.

```
src/server.mjs      запуск, копии базы, очистка
src/app.mjs         настройка провайдера и свои страницы: вход, регистрация, письма, аккаунт, сессии
src/config.mjs      настройки из окружения, проверки для рабочей среды
src/adapter.mjs     хранилище oidc-provider в SQLite
src/accounts.mjs    аккаунты: проверки, вход с блокировкой, профиль, пароль
src/passwords.mjs   scrypt, проверка перенесённых хешей PBKDF2 сайта
src/limits.mjs      лимиты попыток и журнал событий
src/mail.mjs        письма: Unisender Go, Resend, файлы (разработка)
src/views.mjs       HTML-страницы
migrations/         схема базы
public/assets/      стили и скрипт загрузки аватара
scripts/            ключ подписи, перенос пользователей сайта
tests/              node --test: путь входа глазами сайта, перенос
```

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3001
npm test
```

Документы: `../docs/ENDEMION_AUTH_SETUP.md` (настройка), `ENDEMION_ECOSYSTEM_ARCHITECTURE.md`, `ENDEMION_ACCOUNT_MIGRATION.md`, `ENDEMION_DEPLOYMENT.md`, `ENDEMION_SECURITY.md`.
