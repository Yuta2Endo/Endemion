# STAGE 07 — ENDEMION ID: DISCORD

Ветка `studio-redesign`.

## Что сделано

- **Discord OAuth 2.0 провайдер** добавлен в `auth/src/social.mjs` по той же схеме, что GitHub: Authorization Code + PKCE S256, одноразовый state. ID token не используется, пользователь определяется по `/users/@me` с access token, полученным при обмене кода.
- **Настройки и иконка.** `auth/src/config.mjs` — пара `AUTH_DISCORD_CLIENT_ID` / `AUTH_DISCORD_CLIENT_SECRET`, URL-ы `authorizeUrl`, `tokenUrl` и `apiUrl` (по умолчанию `https://discord.com/oauth2/authorize`, `.../api/oauth2/token`, `.../api/v10`). `auth/src/views.mjs` — SVG иконка Discord (#5865F2). `auth/.env.example` — инструкция: Discord → Developer Portal → Applications → New Application → OAuth2 → Redirects.
- **Scope `identify email`** запрашивает номер пользователя, имя (`global_name` или `username`) и почту. Почта принимается только при `verified: true`.
- **Провайдер включён по ENV.** Если ключи не заданы, кнопка не показывается. Адрес ответа у провайдера: `{AUTH_ISSUER}/social/callback/discord`, например `https://auth.endemion.online/social/callback/discord`.
- **Порядок провайдеров на странице входа:** Google, VK ID, GitHub, Discord (порядок в массиве `PROVIDERS`).

## Проверки

- lint и typecheck проходят в `auth/` и в основном проекте.
- Провайдер реализован по тому же шаблону, что GitHub: `discordConfig()`, `discordApi()`, ветка `id === "discord"` в `begin()` и `finish()`, CSP form-action включает Discord authorize URL.
- Реальный вход с Discord не проверен: тесты используют локальные заглушки (`auth/tests/fake-providers.mjs`). Боевая проверка будет после того, как владелец создаст приложение Discord и добавит ключи в `.env` на сервере.

## Не сделано на этом этапе

- Боевые ключи провайдеров — владелец добавит их перед деплоем.
- Rebuild `auth` с новым openid-client и перезапуск compose — при деплое вместе с остальными изменениями ([[endemion-id-integration]], [[endemion-production-deploy]]).
