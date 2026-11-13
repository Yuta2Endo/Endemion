# STAGE_08_3_AUDIT_REPORT — Controlled Production Deployment Audit

**Status:** COMPLETED — audit used for deployment; deployment executed separately  
**Production deployment:** **EXECUTED 2026-11-09 15:41 UTC** — see `STAGE_08_3_DEPLOYMENT_REPORT.md`  
**Repository:** `G:\III\Project\Endemion` (GitHub: `Yuta2Endo/Endemion`, branch `site-improve`)  
**Verified commit:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`  
**Production commit at audit:** `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e`  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Telegram publishing:** disabled (`TELEGRAM_PUBLISH` unset, bot token empty)  
**Previous stage:** STAGE 08.2 — Final QA & Deployment Readiness

---

## 1. Scope

Audit performed before any production application change:

- exact commit identity and local quality gates;
- production Git state, working-tree changes, containers, logs, and configuration;
- SQLite migration state for the site and Endemion ID databases;
- environment completeness (names and non-secret values only);
- disk, backup, and restore readiness;
- DNS, TLS, HTTP, security headers, and baseline pages;
- auth cookie security in a production-mode container;
- preservation of the production-only Endemion ID "Manga" hotfix;
- deployment and rollback feasibility.

No checkout, build, container restart, migration, `.env` edit, or live Telegram action was executed. The only production write was a new SQLite backup (section 7).

---

## 2. Verified commit and local quality gates

| Check | Result |
|---|---|
| Local `HEAD` | `7b11c0a2ca682fb8d08483de632f6a28b6f601c6` |
| Local branch / remote | `site-improve` / `origin/site-improve` = same SHA |
| `npm test` | **141 / 141 passed** (12 files, ~21.5 s) |
| `npm --prefix auth test` | **50 / 50 passed** (~7.8 s) |
| `npm run lint` | 0 errors |
| `npm run typecheck` | 0 errors |
| Fresh local database | 24 migrations applied, last `0024_telegram_announcements.sql`; `/healthz` 200 `ok` |
| Auth image build | `endemion-auth:stage083-check` built successfully; one warning `SecretsUsedInArgOrEnv` on `AUTH_DATA_DIR` (false positive: directory path) |
| Auth production-mode run | `/healthz` 200; OIDC discovery 200; PKCE authorize 303 to interaction; cookies `Secure; HttpOnly; SameSite=Lax` |

### Browser E2E — honest result

| Run | Result |
|---|---|
| Full suite, first run | **64 passed, 1 failed** — `[firefox] tests/e2e/reviews.spec.mjs:36`, favorites expected `data-favorited="1"`, received `"0"` after 5 s |
| Targeted Firefox reviews, `--repeat-each=10` | **30 / 30 passed** |
| Full suite, rerun | **65 / 65 passed** in 52.9 s |

The single Firefox favorites failure was transient and did not reproduce in 30 targeted repeats or the full rerun. It is recorded as a low-frequency hydration/test flake, not as a confirmed product defect. No code was changed for it.

---

## 3. Production snapshot

### 3.1 Containers

| Service | Image | Status | Started | Restarts |
|---|---|---|---|---|
| `endemion-app-1` | `endemion-app:latest` (`328cecb00e56`) | **healthy** | 2026-11-08 19:05:06 UTC | 0 |
| `endemion-auth-1` | `endemion-auth:latest` (`6f30e451e18f`) | **healthy** | 2026-11-08 18:59:05 UTC | 0 |
| `endemion-caddy-1` | `caddy:2` | running (no healthcheck) | — | — |

Only Caddy publishes ports `80/tcp`, `443/tcp`, `443/udp`. App (`3000`) and auth (`3001`) are internal.

### 3.2 Git

| Item | Value |
|---|---|
| Branch / remote | `site-improve` / `git@github.com:Yuta2Endo/Endemion.git` |
| HEAD | `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e` — `Stage 08: Game Ratings & Reviews` |
| Target present locally | **No** (`git cat-file -e 7b11c0a` fails; fetch required) |
| Tracked modifications | `auth/src/app.mjs`, `auth/src/config.mjs`, `auth/src/views.mjs` (3 files, 3 insertions / 3 deletions) |
| Untracked | `auth/migrations/0010_platform_manga.sql` (780 bytes), `..env.swp` (1024 bytes, mode `644`) |
| `.env` | mode `600 root:root`, 3883 bytes; not tracked |
| Compose / Caddyfile / Dockerfile | mode `644`, tracked, unmodified |

The three auth modifications and migration `0010_platform_manga.sql` are the production-only Manga hotfix. Migration `0010` was already applied to the auth database on 2026-11-06 10:35 UTC. **These changes must be preserved.** The deployment target does not touch `auth/` (section 4).

### 3.3 Site database `/app/data/endemion.sqlite`

| Check | Result |
|---|---|
| Integrity | `ok` |
| Last migration | `0023_game_reviews.sql` (23 applied) |
| `0024` | **not applied** |
| `telegram_posts` | absent |
| `studio_posts.version` | absent |
| Users / games / studio posts | 1 / 1 / 0 |
| Size | 125 MB; WAL 821 KB; SHM 32 KB |

### 3.4 Auth database `/app/data/auth/auth.sqlite`

| Check | Result |
|---|---|
| Integrity | `ok` |
| Last migration | `0010_platform_manga.sql` (10 applied) |
| Accounts / platform links | 2 / 1 (`endemion`) |
| `platform_links` CHECK | includes `endemion_manga` |

### 3.5 Environment (names and non-secret values only)

| Variable | App | Auth |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `TRUST_PROXY` | `1` (compose) | `1` (compose) |
| `PUBLIC_URL` | `https://endemion.online` | — |
| `AUTH_ISSUER` | — | `https://auth.endemion.online` |
| `ENDEMION_URL` / `ENDEMION_LIFE_URL` | — | set |
| `TELEGRAM_PUBLISH` | **unset** | — |
| `TELEGRAM_CHANNEL` | **unset** | — |
| `TELEGRAM_BOT_TOKEN` | empty (0 chars) | — |
| `AUTH_COOKIE_KEYS` | — | set (1 key, 64 chars) |
| `AUTH_ADMIN_TOKEN` | — | set (64 chars) |
| `OIDC_CLIENTS` | — | 3 clients: `endemion-web`, `endemion-life-web`, `endemion-manga-web` |
| Mail | — | Unisender |
| Social login | — | Google + VK enabled |
| `BACKUP_HOURS` / `BACKUP_KEEP` | 24 / 14 | hourly auth backups |

`TELEGRAM_PUBLISH` being unset is treated as disabled by the code. The bot token is empty, so live publishing is impossible. `docker compose config --quiet` succeeds.

### 3.6 Disk, backups, network

| Item | Result |
|---|---|
| Root filesystem | 22 GB total, 14 GB used, **7.5 GB available** (66%) |
| Site backups | 1.59 GB; previous latest `endemion-2026-11-08T17-12-37.sqlite` (130,482,176 bytes) |
| Auth backups | hourly; latest `auth-2026-11-09T14-59-06.sqlite` (548,864 bytes) |
| `data/files` | 4.6 MB |
| DNS | `endemion.online`, `www`, `auth`, `life`, `staging` all A → production VPS; TTL 600 |
| TCP | 80 and 443 open externally |
| TLS | CN `endemion.online`; issuer Let's Encrypt `YE1`; expires 2027-01-30 |
| HTTP/3 | `Alt-Svc: h3` advertised; direct UDP probe not possible with the local curl build |

---

## 4. Delta from production to target

Production is four commits behind:

```
7b11c0a Stage 08.2: Final QA - fix Firefox PWA offline, mobile header overflow, E2E isolation, Telegram publish
15f210b Add STAGE_08_1_QA_CLOSURE_REPORT.md
6585d90 Add STAGE_08_1_QA_CLOSURE_REPORT.md
c7e192f Stage 08.1: QA Closure - Fix Android spoiler CSS, fix Firefox PWA service worker, add Telegram integration tests
```

34 files changed, 2252 insertions, 438 deletions.

Deployment-relevant configuration delta:

| Path | Delta |
|---|---|
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `auth/` | **none** |
| `.env.example` | Telegram variables documented |
| `wrangler.toml` | Telegram channel + `TELEGRAM_PUBLISH="0"` (Cloudflare path only) |
| `server/index.mjs` | forwards `TELEGRAM_*` env to the app |
| `migrations/0024_telegram_announcements.sql` | new additive migration |

The target commit does **not** modify `auth/`. `git diff --name-only 42bad5c..7b11c0a -- auth` is empty, so the production-only Manga hotfix can survive a checkout. No compose rebuild of `auth` or `caddy` is required.

---

## 5. Migration audit

`0024_telegram_announcements.sql`:

```sql
ALTER TABLE studio_posts ADD COLUMN version TEXT;

CREATE TABLE telegram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL UNIQUE REFERENCES studio_posts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'failed')) DEFAULT 'pending',
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX telegram_posts_post ON telegram_posts(post_id);
CREATE INDEX telegram_posts_status ON telegram_posts(status);
```

- Additive only: one nullable column, one new table, two indexes.
- No existing row rewrite, no destructive statement.
- A fresh local Node database applied all 24 migrations and returned `/healthz` 200; `telegram_posts` and `studio_posts.version` exist.
- Production has 23 migrations; `0024` will apply automatically at app startup.
- The previous application (`42bad5c`) ignores the new column/table, so an application rollback after `0024` is safe. Reversing the migration is not required.

---

## 6. Security review

| Item | Result |
|---|---|
| Auth cookies | Local production-mode container returns `Secure; HttpOnly; SameSite=Lax` for interaction cookies |
| PKCE | Discovery advertises `S256`; authorize without PKCE is rejected |
| Auth issuer | `https://auth.endemion.online` |
| OIDC clients | Site, Life, and Manga redirects registered |
| Proxy trust | `TRUST_PROXY=1` behind Caddy; Caddy overwrites `X-Forwarded-For` |
| HTTPS | Valid Let's Encrypt certificate; HSTS/CSP present on the site |
| Secrets in git | `.env`, `.dev.vars`, keys, data, backups not tracked |
| Telegram token | empty; no token in logs or source |
| Database exposure | app/auth ports internal; only Caddy public |
| Container users | app/auth run as non-root `node` |

### Findings

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | `..env.swp` existed in `/opt/endemion` during the audit, mode `644`, likely a vim swap file for `.env`; may have contained secret fragments | **High** | **Absent at deployment preflight (15:40:52 UTC); not removed by this operation.** Operator should confirm it was intentionally cleaned and check for other swap files |
| F2 | `TELEGRAM_PUBLISH` is absent rather than explicitly `0` | Low | Code treats unset as disabled and token is empty; operator may add explicit `TELEGRAM_PUBLISH=0` |
| F3 | Production-only auth hotfix is uncommitted | Medium | Preserve during checkout; do not clean/reset; commit separately later if desired |
| F4 | One transient Firefox favorites E2E failure | Low | 30/30 targeted repeats and 65/65 rerun passed; monitor after deploy |
| F5 | No physical iOS/Android devices | Medium | Accepted; viewport emulation only |
| F6 | No authenticated production test account initially provided | Medium | Resolved for this stage: an approved disposable account was created, used, and deleted; admin-only flows remain untested |
| F7 | HTTP/3 not directly probeable locally | Low | Caddy advertises `h3`; not a deployment blocker |

No secret values are reproduced in this report.

---

## 7. Pre-deployment backup evidence

Created with the project procedure inside the running app container:

```
docker compose exec -T app node server/backup.mjs
```

| Item | Value |
|---|---|
| Local file | `/app/data/backups/endemion-2026-11-09T15-29-18.sqlite` |
| Size | 130,523,136 bytes |
| Created | 2026-11-09 15:29:19 UTC |
| Integrity | `ok` |
| Migrations in backup | 23, last `0023_game_reviews.sql` |
| Users / games / studio posts | 1 / 1 / 0 |
| `telegram_posts` | absent (expected before deployment) |
| Off-host copy | `s3://endemio/backups/endemion-2026-11-09T15-29-18.sqlite` |

Latest auth backup verification:

| Item | Value |
|---|---|
| File | `data/auth/backups/auth-2026-11-09T14-59-06.sqlite` |
| Size | 548,864 bytes |
| Integrity | `ok` |
| Migrations / accounts / links | 10 (last `0010_platform_manga.sql`) / 2 / 1 |

Old backups were not deleted. The app also creates a pre-migration backup automatically when `0024` is applied.

---

## 8. Production HTTP baseline

| URL | Result |
|---|---|
| `https://endemion.online/` | 200, HTML |
| `/games` | 200 |
| `/community` | 200 (the forum route is `/community`; `/forum` is intentionally 404) |
| `/studio` | 200 |
| `/privacy`, `/copyright`, `/about` | 200 |
| `/healthz` | 200 `ok` |
| `/sw.js` | 200, `VERSION = "v6"` (target is `v7`) |
| `/encyclopedia` | 301 → `/` (legacy path) |
| `https://www.endemion.online/` | 301 → `https://endemion.online/` |
| `https://auth.endemion.online/healthz` | 200 |
| `https://auth.endemion.online/.well-known/openid-configuration` | 200, issuer `https://auth.endemion.online`, PKCE `S256` |
| `https://auth.endemion.online/` | 302 → `/account` |
| `https://endemion.online/account` | 404 (account UI is served from the auth host) |

During the pre-deployment baseline, app logs contained only the startup line. Caddy logs contained ACME/ARI renewal information, with no error or 5xx entries. Auth logs showed normal `/auth` 303 probes and no errors. (One expected 502 occurred later, during the deployment restart window; see the deployment report.)

---

## 9. Audit conclusion

The production baseline was healthy, the target commit was fully verified locally, the pending migration was additive, the production-only auth hotfix could be preserved, and a verified pre-deployment backup existed on disk and in S3. On this basis the deployment was approved and executed successfully.

## 10. Post-audit deployment note

- Approved app-only deployment executed on 2026-11-09 at 15:41:49–15:41:56 UTC.
- Production HEAD: `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`.
- Migration `0024` applied; site database integrity `ok`.
- Auth hotfix preserved; auth/caddy not restarted.
- No rollback was required.
- Details: `STAGE_08_3_DEPLOYMENT_REPORT.md`, `STAGE_08_3_PRODUCTION_QA_REPORT.md`.

**Status: COMPLETED — audit findings used; deployment successful.**
