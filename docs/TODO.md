# Endemion Auth — Следующие шаги

## Что сделано в этой сессии ✅

1. **Технический аудит** — полный анализ обеих платформ (48KB документации)
2. **Архитектура** — OpenID Connect Provider с отдельной SQLite базой
3. **Код основы** — 838 строк: сервер, adapter, миграции, импорт пользователей
4. **База данных** — создана и мигрирована (`data/auth.sqlite`)
5. **Ветка git** — `feature/endemion-auth` с первым коммитом

## Что нужно сделать дальше

### 1. Завершить базовый сервер (2-3 часа)

**Файл:** `auth/src/server.mjs`

Текущие проблемы:
- Формы входа с inline styles (нарушают CSP)
- Нет регистрации
- Нет обработки ошибок
- Не проверено, работает ли вообще

Нужно:
```bash
cd auth
npm run dev  # Запустить и проверить
```

Если запустится:
- Открыть http://localhost:3001/.well-known/openid-configuration
- Должен вернуть JSON с конфигурацией OIDC
- Проверить что формы входа открываются

### 2. Создать нормальный UI (2-3 часа)

**Создать:** `auth/public/style.css`, обновить формы в `server.mjs`

Требования:
- Убрать inline styles
- Использовать цвета Endemion (purple #8b5cff, dark bg)
- Шрифты Unbounded + Manrope
- Адаптивность (mobile-friendly)
- Кнопки "Войти", "Создать аккаунт", "Забыли пароль?"

### 3. Добавить регистрацию (1-2 часа)

**Создать:** `auth/src/routes/register.mjs`

Логика:
```javascript
POST /auth/register
- Проверить email уникальность
- Хешировать пароль (scrypt)
- Создать UUID для sub
- Вставить в accounts
- Создать сессию OIDC
- Вернуть в приложение
```

### 4. Тестировать импорт (1 час)

```bash
cd auth
node scripts/import-endemion-users.mjs
```

Проверить:
- Пользователи импортированы
- legacy_password_hash заполнен
- Можно войти со старым паролем
- После входа пароль перехеширован в scrypt

### 5. Интеграция с Endemion (3-4 часа)

**В основном сайте:**

1. Установить openid-client:
```bash
npm install openid-client
```

2. Создать `functions/api/auth/oidc-login.js`:
```javascript
// Перенаправить на auth.endemion.online
```

3. Создать `functions/api/auth/oidc-callback.js`:
```javascript
// Принять code, обменять на tokens
// Получить sub из ID token
// Найти в platform_links или создать
// Создать сессию
```

4. Обновить `functions/_lib/session.js`:
```javascript
if (process.env.USE_OIDC_AUTH === '1') {
  // Проверить OIDC сессию
} else {
  // Старая логика (для отката)
}
```

### 6. Интеграция с Life (3-4 часа)

**В apps/api:**

1. Установить openid-client
2. Добавить OIDC endpoints в auth.controller.ts
3. При регистрации:
   - Создать аккаунт в Auth
   - Вернуться в Life
   - Связать с guest Player
   - Вызвать transferGuestLives

### 7. Production deployment (2-3 часа)

**Обновить docker-compose.yml:**
```yaml
services:
  auth:
    build: ./auth
    environment:
      ISSUER: auth.endemion.online
      AUTH_DB_FILE: /app/data/auth.sqlite
      COOKIE_SECRET: ${AUTH_COOKIE_SECRET}
      TOKEN_SECRET: ${AUTH_TOKEN_SECRET}
      OIDC_CLIENTS: ${AUTH_OIDC_CLIENTS}
    volumes:
      - ./data:/app/data
    expose:
      - "3001"
```

**Обновить Caddyfile:**
```
auth.{$SITE_DOMAIN} {
  encode zstd gzip
  reverse_proxy auth:3001
}
```

**На VPS:**
```bash
cd /opt/endemion
# Импортировать пользователей
docker compose run --rm auth node scripts/import-endemion-users.mjs

# Запустить
docker compose up -d --build

# Проверить
curl https://auth.endemion.online/.well-known/openid-configuration
```

## Оценка времени до production

- **Минимальный MVP** (без UI красоты): ~10 часов
- **Хороший MVP** (с нормальным UI): ~15 часов  
- **Production-ready** (тесты, безопасность, документация): ~20-25 часов

## Приоритет задач

1. **Критично:** Завершить базовый сервер и проверить что он работает
2. **Важно:** Создать нормальный UI
3. **Важно:** Добавить регистрацию
4. **Нормально:** Интеграция с Endemion
5. **Нормально:** Интеграция с Life
6. **Когда готово:** Production deployment

## Что может пойти не так

- oidc-provider может требовать дополнительную настройку (не все опции проверены)
- UI может не совпадать с дизайном Endemion (нужны примеры стилей)
- Импорт пользователей может упасть на production данных
- Интеграция может выявить неожиданные edge cases

## Рекомендация

Следующая сессия: **сфокусироваться на пунктах 1-3** (завершить Auth как standalone сервис). Только когда он работает сам по себе, начинать интеграцию с платформами.

Не пытаться делать всё сразу. Одна рабочая часть лучше трёх наполовину готовых.

---

**Branch:** `feature/endemion-auth`  
**Status:** Foundation complete, server implementation in progress  
**Next:** `cd auth && npm run dev` и починить всё что сломается
