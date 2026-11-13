# STAGE_08_3_DEPLOYMENT_REPORT — Controlled Production Deployment Report

**Status:** **COMPLETED — SUCCESS**  
**Deployment executed:** **YES** — 2026-11-09 15:41:49–15:41:56 UTC  
**Approval:** operator approved deployment with a disposable QA account  
**Target commit:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`  
**Previous production commit:** `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e`  
**Resulting production HEAD:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6` (detached)  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Telegram publishing:** disabled (flag empty, token empty)

---

## 1. Deployment summary

The app-only deployment succeeded with no rollback. The site moved from `42bad5c` to `7b11c0a`, migration `0024_telegram_announcements.sql` applied, and the production-only Endemion ID "Manga" hotfix was preserved.

| Item | Result |
|---|---|
| App image built | `sha256:e6ddb03c59120dd501abe23d773452be9acbfacbeb1969aa58c6ec78d9ae20a8` |
| Previous image retained | `endemion-app:pre-stage083-42bad5c` = `sha256:328cecb00e56a2f0aa21a76867deefee3454ef9c0b7d2e1e7aea72da9b3dfe8e` |
| Migration | `0024_telegram_announcements.sql` applied |
| Site database | 24 migrations; integrity `ok` |
| App health | healthy; 0 restarts |
| Downtime | approximately 1–7 seconds (under 10 seconds) |
| Auth/caddy | not rebuilt or restarted |
| Rollback | not required |

---

## 2. Timeline (UTC)

| Time | Event |
|---|---|
| 15:29:18 | Pre-deployment backup created and uploaded to S3 |
| 15:40:52 | Preflight passed; rollback image tag created |
| 15:41:49 | `docker compose up -d --no-deps app` started |
| 15:41:50 | New app container started; automatic pre-migration backup created |
| 15:41:50 | Migration `0024_telegram_announcements.sql` applied |
| 15:41:56 | App healthy; deployment complete |
| 15:42 | External HTTP, auth cookie, and discovery checks passed |
| ~15:44 | PWA, offline, mobile-width, and page checks passed |
| ~15:45 | Disposable Endemion ID account created, verified, and deleted |
| 15:48:17–16:01:49 | Ten health checks across the post-deployment monitoring window; all healthy |

---

## 3. Commands executed

```bash
cd /opt/endemion

# preflight and rollback tag
docker tag endemion-app endemion-app:pre-stage083-42bad5c

# exact target
git fetch origin site-improve
git cat-file -e 7b11c0a2ca682fb8d08483de632f6a28b6f601c6^{commit}
git diff --name-only 42bad5c..7b11c0a -- auth
git checkout 7b11c0a2ca682fb8d08483de632f6a28b6f601c6

# build and switch only the app
docker compose config --quiet
docker compose build app
docker compose up -d --no-deps app
```

No `git reset`, `git clean`, force-push, `.env` edit, auth rebuild, caddy restart, or database deletion was performed.

---

## 4. Git and hotfix preservation

| Check | Result |
|---|---|
| Production HEAD | `7b11c0a2ca682fb8d08483de632f6a28b6f601c6` |
| `git diff 42bad5c..7b11c0a -- auth` before checkout | empty |
| Modified after checkout | `auth/src/app.mjs`, `auth/src/config.mjs`, `auth/src/views.mjs` |
| Untracked after checkout | `auth/migrations/0010_platform_manga.sql` |
| Manga hotfix lost | **No** |
| `..env.swp` | present during the audit, **absent at preflight**; not removed by this operation |
| `.env` | not modified |

The working tree still contains the three Manga hotfix modifications and the applied `0010` migration. Auth was not rebuilt; its container uptime and image are unchanged.

---

## 5. Migration and database verification

| Check | Result |
|---|---|
| Migration log | `Миграция применена: 0024_telegram_announcements.sql` |
| Migration count | 24, last `0024_telegram_announcements.sql` |
| Site integrity | `ok` |
| `telegram_posts` | present |
| `studio_posts.version` | present |
| Users / games / studio posts | 1 / 1 / 0 |
| Auth migrations | 10, last `0010_platform_manga.sql` |
| Auth accounts / links | 2 / 1 |
| Auth integrity | `ok` |

Row counts are unchanged from the pre-deployment baseline. Migration `0024` was applied transactionally.

### Backups

| Backup | Time | Size | Integrity |
|---|---|---|---|
| Manual pre-deployment | 15:29:18 | 130,523,136 bytes | `ok` |
| Automatic pre-migration | 15:41:50 | 130,523,136 bytes | `ok` |

Both were uploaded to `s3://endemio/backups/`. The automatic backup contains 23 migrations and one user, matching the pre-migration state.

---

## 6. Post-deployment verification

### 6.1 Public pages

| URL | Result |
|---|---|
| `/` | 200, no console errors |
| `/games` | 200, no console errors |
| `/games/endemion-life` | 200, no console errors |
| `/community` | 200, no console errors |
| `/studio` | 200, no console errors |
| `/privacy` | 200, no console errors |
| `/copyright` | 200, no console errors |
| `/about` | 200, no console errors |
| `/offline` | 200, no console errors |
| `/manifest.webmanifest` | 200, `application/manifest+json` |
| `/healthz` | 200 `ok` |

The consent banner was visible, clickable, and stored `endemion:analytics` locally. No JavaScript console errors or page errors were observed on the checked pages.

### 6.2 PWA and mobile

| Check | Result |
|---|---|
| `sw.js` version | `v7` |
| Service worker scope | `https://endemion.online/` |
| Active worker | `/sw.js`; page controlled |
| Cache | `endemion-v7` only |
| Offline navigation | offline page rendered: "Нет связи — Endemion" |
| Mobile width (412 px) | `clientWidth=412`, `scrollWidth=412`, `bodyScrollWidth=412` |

### 6.3 Auth

| Check | Result |
|---|---|
| Discovery | 200; issuer `https://auth.endemion.online`; PKCE `S256` |
| Authorize with PKCE | 303 to interaction |
| Interaction cookies | `Secure; HttpOnly; SameSite=Lax` |
| Auth CSP | includes site, Life, and Manga callback origins |
| Manga client | `endemion-manga-web` registered |

### 6.4 Disposable account journey

A clearly marked disposable account was created through the real Endemion ID registration flow and then removed:

- username: `stage083qa39217012`;
- registration completed and redirected to `/profile`;
- `/api/me` returned the expected user;
- site account deletion returned 200 `ok`;
- auth account deletion showed the deletion notice;
- `/api/me` returned `user: null` afterward;
- app users returned to 1, app test users 0, orphan sessions 0;
- auth accounts returned to 2, auth test accounts 0, links 1;
- both databases remained integrity `ok`.

No password or email address is reproduced in this report.

### 6.5 Telegram

| Check | Result |
|---|---|
| Public link | `https://t.me/EndemionOfficial` present |
| `TELEGRAM_PUBLISH` | empty |
| `TELEGRAM_CHANNEL` | empty |
| `TELEGRAM_BOT_TOKEN` | empty |
| Unauthenticated admin pending endpoint | 401 |
| Publishing | not exercised; remains disabled |

### 6.6 Headers and infrastructure

HSTS, CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Alt-Svc: h3` were present.

---

## 7. Monitoring

Ten checks from 15:48:17 to 16:01:49 UTC, plus immediate post-deployment checks:

- `/healthz` returned `ok` every time;
- app health stayed `healthy`, restarts 0;
- no app error/exception/failed/fatal log entries in the 20-minute observation window;
- one expected Caddy 502 at 15:41:50 UTC during the app restart window (a bot request to `/wp-admin/install.php`); no 5xx after the container became healthy;
- auth stayed healthy, restarts 0;
- disk free: 7.4 GB.

---

## 8. Deviations and outstanding items

| Item | Status |
|---|---|
| `.env.swp` | Was present during the audit but absent at deployment preflight; not removed by this operation. Operator should confirm it was intentionally cleaned. |
| Restart-window 502 | One 502 at 15:41:50 UTC for a bot request to `/wp-admin/install.php` during the expected app restart; no 5xx after health. |
| `.env` explicit `TELEGRAM_PUBLISH=0` | Not added; flag is empty and token is empty, so publishing is disabled. |
| Admin Telegram preview/publish | Not tested; requires an authenticated admin and publishing must remain disabled. |
| Physical iOS/Android devices | Not available; mobile checks are viewport emulation. |
| HTTP/3 direct probe | Not possible with the local curl build; `Alt-Svc: h3` is advertised. |
| Reports commit/push | Not performed; Stage 08.3 reports are untracked. |

---

## 9. Rollback status

No rollback was triggered. The previous image is retained as `endemion-app:pre-stage083-42bad5c`; the migration is additive and backward-compatible. See `STAGE_08_3_ROLLBACK_REPORT.md`.

**Final status: COMPLETED — SUCCESS.**
