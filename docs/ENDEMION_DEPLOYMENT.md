# Выкладка Endemion ID на сервер

Сервер: 185.175.156.196 (1 CPU, 2 ГБ). Сайт — `/opt/endemion`, Life — `/opt/endemion-life`, HTTPS для всех доменов делает Caddy сайта. Выложено 2026-11-03 по этим шагам. При новой установке они повторяются целиком, для обновления кода есть раздел 8.

## 0. До начала (владелец)

1. **DNS.** У регистратора spaceweb.ru добавить A-запись `auth.endemion.online` → `185.175.156.196`. Проверка: `nslookup auth.endemion.online` возвращает этот адрес. Без записи Caddy не получит сертификат.
2. **Письма.** Подтвердить в Unisender Go (или Resend) отправителя для Endemion ID, например `Endemion ID <noreply@endemion.online>`. Можно взять тот же ключ, что у сайта. Без писем вход работает, но подтвердить почту и восстановить пароль нельзя, а старые аккаунты Life свяжутся только после подтверждения почты.
3. **Копии баз** сайта и Life (`ENDEMION_ACCOUNT_MIGRATION.md`, раздел 4, шаг 1).

## 1. Секреты

На сервере, в `/opt/endemion`. Значения нигде не печатаются в журнал и не попадают в git (`.env` в `.gitignore`).

```bash
cd /opt/endemion
mkdir -p data/auth && chown 1000:1000 data/auth
umask 077
SITE_SECRET=$(openssl rand -hex 32)
LIFE_SECRET=$(openssl rand -hex 32)
cat >> .env <<EOF

# Endemion ID
AUTH_COOKIE_KEYS=$(openssl rand -hex 32)
OIDC_CLIENTS=[{"client_id":"endemion-web","client_secret":"$SITE_SECRET","platform":"endemion","redirect_uris":["https://endemion.online/auth/callback"],"post_logout_redirect_uris":["https://endemion.online/"]},{"client_id":"endemion-life-web","client_secret":"$LIFE_SECRET","platform":"endemion_life","redirect_uris":["https://life.endemion.online/api/auth/oidc/callback"],"post_logout_redirect_uris":["https://life.endemion.online/"]}]
AUTH_MAIL_FROM=Endemion ID <noreply@endemion.online>
ENDEMION_ID=
ENDEMION_ID_ISSUER=https://auth.endemion.online
ENDEMION_ID_CLIENT_ID=endemion-web
ENDEMION_ID_CLIENT_SECRET=$SITE_SECRET
ENDEMION_ID_TOKEN_KEY=$(openssl rand -base64 32)
ENDEMION_LIFE_URL=https://life.endemion.online
EOF
echo "$LIFE_SECRET" > /root/endemion-life-client-secret   # нужен в шаге 4, потом удалить
unset SITE_SECRET LIFE_SECRET
```

`ENDEMION_ID` пока пустой: сайт работает по-старому, пока не проверен провайдер.

## 2. Код и провайдер

```bash
cd /opt/endemion
docker compose exec -T app node server/backup.mjs
git pull --ff-only                      # после слияния feature/endemion-auth в main
docker compose build auth app
# ключ подписи токенов, один раз. Файл секретный: права 600, в git его нет
docker compose run --rm --no-deps -T auth node scripts/generate-keys.mjs /app/data/auth-jwks.json </dev/null
# По одному сервису: «up -d auth app» через ssh на этом сервере зависал
docker compose up -d --no-deps auth
docker compose up -d --no-deps app
docker compose ps auth                   # healthy
```

Сайт при запуске сам делает копию базы и применяет миграцию `0017_endemion_id.sql` (только новые столбцы и таблица).

Сборка на сервере с 1 CPU занимает время и нагружает сайт. Если это мешает, образы собираются локально и переносятся `docker save | ssh … docker load`, как для Life.

## 3. Caddy

Caddyfile подключён одним файлом, поэтому после `git pull` работающий Caddy видит старую версию. Обычный `caddy reload` перечитает старый файл и уберёт `life.endemion.online`. Перезагружать только так:

```bash
docker cp Caddyfile endemion-caddy-1:/tmp/Caddyfile.new
docker exec endemion-caddy-1 caddy validate --config /tmp/Caddyfile.new
docker exec endemion-caddy-1 caddy reload --config /tmp/Caddyfile.new
```

Проверка:

```bash
curl -s https://auth.endemion.online/healthz                                   # {"status":"ok"}
curl -s https://auth.endemion.online/.well-known/openid-configuration | head -c 300
curl -sI https://life.endemion.online | head -1                                 # Life не пропал
```

## 4. Перенос пользователей и включение на сайте

1. Перенос — `ENDEMION_ACCOUNT_MIGRATION.md`, раздел 4, шаги 2–5.
2. Свой аккаунт: открыть `https://auth.endemion.online/login`, войти паролем от сайта. Проверить `/account`.
3. Включить: в `.env` `ENDEMION_ID=1`, затем `docker compose up -d app`.
4. Проверить на сайте: «Войти» уводит на auth.endemion.online, после входа виден свой профиль и полка; «Выйти» ведёт на страницу выхода Endemion ID.

Администраторы и модераторы сайта сохраняют роли: роль хранится в `users.role` сайта, перенос её не трогает.

## 5. Life

Образы Life собираются локально и переносятся, как описано в `docs/DEPLOYMENT.md` Life. Затем на сервере:

```bash
cd /opt/endemion-life
# копия базы Life — docs/DATABASE_BACKUPS.md
cat >> .env <<EOF
ENDEMION_ID=false
ENDEMION_ID_ISSUER=https://auth.endemion.online
ENDEMION_ID_CLIENT_ID=endemion-life-web
ENDEMION_ID_CLIENT_SECRET=$(cat /root/endemion-life-client-secret)
ENDEMION_ID_TOKEN_KEY=$(openssl rand -base64 32)
EOF
rm /root/endemion-life-client-secret
docker compose -f infrastructure/docker-compose.prod.yml -f infrastructure/docker-compose.behind-proxy.yml --env-file .env up -d --no-build
```

Сервис `migrate` применит миграцию `20261103120000_endemion_id`. После проверки — `ENDEMION_ID=true` и ещё раз `up -d --no-build`. Проверить: на `/account` кнопка «Войти через Endemion ID»; если вход на сайте уже выполнен, Life пускает без пароля.

## 6. Мониторинг

- Журналы: `docker compose logs --tail 200 auth` (JSON по строке на событие). Ошибки — `"level":"error"`.
- Доступность: `https://auth.endemion.online/healthz` — добавить в тот же монитор, что следит за Life (`MONITOR_*` в Life) или во внешний сервис.
- События безопасности — таблица `audit_log` в `data/auth/auth.sqlite`: `login.invalid`, `login.locked`, `login.rate_limited`, `password.reset`, `session.revoke` и другие.
- Копии базы Endemion ID — `data/auth/backups`, раз в сутки, 14 штук. В S3 они пока не отправляются: при поломке диска сервера пропадут вместе с ним (см. известные ограничения в `ENDEMION_SECURITY.md`).

## 7. Откат

`ENDEMION_ACCOUNT_MIGRATION.md`, раздел 6. Коротко: `ENDEMION_ID=` у сайта и `ENDEMION_ID=false` у Life возвращают старый вход без восстановления баз. Сервис `auth` можно остановить: `docker compose stop auth`.

Копии `.env` до включения Endemion ID лежат в `/root/endemion.env.before-endemion-id` и `/root/endemion-life.env.before-endemion-id`, работавший до этого Caddyfile — в `/root/Caddyfile.running-before-endemion-id`.

## 8. Обновление кода

С сайта разработчика, одной командой (нужна запушенная ветка и ключ `~/.ssh/endemion_vps`):

```bash
npm run deploy:prod
```

Скрипт `scripts/deploy-prod.mjs` сам переключает сервер на `origin/site-improve` (detached HEAD), пересобирает `app`, ждёт `/healthz` и прогоняет `npm run smoke`. Воркер Cloudflare прод не обслуживает: `npm run deploy` — только предпросмотр на `*.workers.dev`.

Вручную то же самое:

```bash
cd /opt/endemion
docker compose exec -T app node server/backup.mjs
git fetch origin
git checkout --detach origin/site-improve
docker compose build auth app
docker compose up -d --no-deps auth
docker compose up -d --no-deps app
```

`git pull --ff-only` не подходит: сервер стоит на detached HEAD, а production-only правок в рабочем дереве быть не должно — всё, что нужно на проде, живёт в ветке.

Если изменился Caddyfile, перезагрузка только через `docker cp` (раздел 3). Life обновляется по `docs/DEPLOYMENT.md` Life: образы собираются локально, код приходит через `git bundle`.
