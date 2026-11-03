# Endemion Ecosystem

Единая цифровая экосистема с централизованной системой аккаунтов.

## Проекты

### [Endemion](Project/Endemion/) — endemion.online
Платформа для читателей манги, манхвы и маньхуа: каталог, рекомендации, сообщество.

- **Stack**: Buildless (ES modules), SQLite, Node.js, Docker, Caddy
- **Repo**: https://github.com/Yuta2Endo/Endemion
- **Production**: `/opt/endemion` на VPS 185.175.156.196

### [Endemion Life](endemion-life/) — life.endemion.online
Браузерный симулятор жизни с элементами RPG.

- **Stack**: Next.js 16, NestJS 12, PostgreSQL 18, Redis, Prisma 7, pnpm monorepo
- **Repo**: https://github.com/Yuta2Endo/Endemion-Life (private)
- **Production**: `/opt/endemion-life` на том же VPS, за Caddy основного сайта

### Endemion Auth — auth.endemion.online *(в разработке)*
Централизованный Identity Provider для единой авторизации.

- **Протокол**: OAuth 2.0 / OpenID Connect
- **Цель**: Single Sign-On между всеми сервисами экосистемы

## Цель интеграции

Пользователь регистрируется **один раз** и использует свой аккаунт на всех платформах:

- Единый username, email, аватар
- Вход без повторного ввода пароля
- Общий профиль (Endemion ID)
- Игровой прогресс привязан к постоянному ID
- Безопасное управление сессиями

## Документация интеграции

См. [docs/](docs/) — документы по архитектуре, миграции, deployment и безопасности.

**Текущий статус**: Аудит существующих систем авторизации обоих проектов.

## Инфраструктура

- **VPS**: 185.175.156.196 (1 CPU, 2GB RAM)
- **Caddy**: Reverse proxy + HTTPS для обоих сайтов
- **Docker Compose**: Изолированные окружения для каждого проекта
- **DNS**: A-записи на spaceweb.ru

---

**Last Updated**: 2026-11-03
