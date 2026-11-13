# STAGE_08_2_DEPLOYMENT_READINESS — Deployment Readiness Report

**Status:** READY — conditional on operator checklist  
**Deployment performed:** **NO**  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Telegram publishing:** disabled (`TELEGRAM_PUBLISH=0`)

---

## 1. Architecture confirmed

Two supported deployments exist in the repository.

### A. Own server (documented production path)

`docker-compose.yml` runs:

| Service | Purpose | Exposure |
|---|---|---|
| `app` | Node.js server (`server/index.mjs`), SQLite in `./data`, optional S3 images | internal `3000` only |
| `auth` | Endemion ID (`auth/Dockerfile`), data in `./data/auth` | internal `3001` only |
| `caddy` | HTTPS, Let's Encrypt, reverse proxy, `www` redirect | ports `80`, `443`, `443/udp` |

`Caddyfile` routes:

- `{$SITE_DOMAIN}` → `app:3000`
- `www.{$SITE_DOMAIN}` → permanent redirect
- `auth.{$SITE_DOMAIN}` → `auth:3001`
- `life.{$SITE_DOMAIN}` → `endemion-life-nginx:80`
- `staging.endemion.online` → `endemion-city-staging-web:8080`

`Caddy` overwrites `X-Forwarded-For` with the real remote host, and `app`/`auth` trust it only when `TRUST_PROXY=1`.

### B. Cloudflare Worker (static/API configuration)

`wrangler.toml` defines the Worker entry `src/worker.js`, static assets from `public/`, D1 database `endemion`, R2 bucket `endemion-pages`, and `REDIRECT_TO=https://endemion.online`. This path was statically reviewed but not deployed.

---

## 2. Validation performed

| Check | Command | Result |
|---|---|---|
| Compose syntax and interpolation | `docker compose config --quiet` with a temporary `.env` copied from `.env.example` (removed afterwards) | **OK** |
| Main Dockerfile lint | `docker build --check .` | **No warnings** |
| Main image build | `docker build -t endemion:stage082-check .` | **Success** |
| Container startup | `docker run` with tmpfs `/app/data`, `NODE_ENV=production`, `BACKUP_HOURS=0` | **healthz 200 `ok`**; migrations 0001–0024 applied |
| Node server without Docker | `node server/index.mjs` with a fresh temporary `DATA_DIR` | **healthz 200 `ok`**; migrations 0001–0024 applied |
| Auth Dockerfile lint | `docker build --check auth` | 1 warning only: `SecretsUsedInArgOrEnv` on `AUTH_DATA_DIR` — **false positive** (it is a directory path, not a secret) |
| Auth image build/run | — | **Not performed** in this stage |

All temporary containers, images, `.env`, and smoke-test data were removed after the checks.

---

## 3. Security review

| Item | Result |
|---|---|
| `.env` tracked in git | No (absent locally; `.gitignore` covers it) |
| `.dev.vars` tracked in git | No (gitignored, local only) |
| `*.key`, `data/`, `backups/` tracked | No |
| Hardcoded Telegram token | Not found |
| Hardcoded AWS/Access keys | Not found |
| Telegram token location | Environment/secret only; `wrangler.toml` has only channel + `TELEGRAM_PUBLISH` |
| `TELEGRAM_PUBLISH` default | `"0"` in `wrangler.toml` and `.env.example` |
| Token in logs | Delivery errors log status only; tests assert the token is absent |
| Container user | `node` (non-root) |
| Database port exposure | App and auth are internal; only Caddy is published |
| Auto-publish to Telegram | None; announcement requires an explicit admin API call |

No secret values are reproduced in this report.

---

## 4. Data and backup readiness

- On startup, `server/index.mjs` checks pending migrations and, if the database already has migrations, creates a backup before applying new ones.
- `startScheduledBackups()` runs every `BACKUP_HOURS` (default 24) and keeps `BACKUP_KEEP` copies (default 14).
- Optional off-host copies use `BACKUP_S3_*` (private bucket, write/read/delete only).
- Migration `0024_telegram_announcements.sql` only adds `studio_posts.version` and the `telegram_posts` table; it does not rewrite existing data.
- Import path from Cloudflare D1: `npm run db:backup` → `server/import-d1.mjs` (see `DEPLOY.md`).

---

## 5. Operator checklist before deployment

1. On the server, ensure the repository is at the reviewed commit and `git status` is clean.
2. Create `.env` from `.env.example` and set at minimum:
   - `SITE_DOMAIN=endemion.online`
   - `PUBLIC_URL=https://endemion.online`
   - Endemion ID variables (`AUTH_COOKIE_KEYS`, `OIDC_CLIENTS`, `ENDEMION_ID_*`, `AUTH_ADMIN_TOKEN`) if single sign-on is enabled.
3. Verify DNS A records exist for `endemion.online`, `www.endemion.online`, and `auth.endemion.online`.
4. Ensure ports `80`, `443/tcp`, `443/udp` are open.
5. Create the data directory with the container UID: `mkdir -p data && sudo chown 1000:1000 data`.
6. Keep `TELEGRAM_PUBLISH=0` until the bot is an administrator of `@EndemionOfficial` and a publish is explicitly intended.
7. Update the site: `git pull && docker compose up -d --build`.
8. Verify `https://endemion.online/healthz` returns `ok`, then sign in and open the admin panel.
9. Check logs: `docker compose logs --tail 200 app`.

---

## 6. Rollback

Application rollback:

```
git checkout <previous-deployed-commit>
docker compose up -d --build
```

Database rollback (only if a migration must be reverted):

```
docker compose stop app
# replace data/endemion.sqlite with the latest copy from data/backups
rm -f data/endemion.sqlite-wal data/endemion.sqlite-shm
docker compose start app
```

The automatic pre-migration backup is the primary recovery point. Off-host `BACKUP_S3_*` copies cover server loss.

---

## 7. Go / No-Go

**GO — conditional.**

- Code, configuration, tests, image build, container startup, and fresh-database migrations are verified.
- The deployment is safe to perform after the operator completes section 5.
- Telegram remains in preview-only mode.
- This report does **not** claim that production was updated; no deployment was executed.

### Accepted limitations

- TLS/Let's Encrypt issuance and DNS were not exercised from this environment.
- The `auth` image was linted but not built or started.
- No live-domain smoke test, load test, or penetration test was performed.
- The Cloudflare Worker path was reviewed statically, not deployed.
