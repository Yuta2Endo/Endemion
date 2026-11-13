# STAGE_08_3_DEPLOYMENT_PLAN — Controlled Production Deployment Plan

**Status:** **EXECUTED — 2026-11-09 15:41 UTC** (see `STAGE_08_3_DEPLOYMENT_REPORT.md`)  
**Deployment executed:** **YES** — app-only, no deviations  
**Previous production commit:** `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e`  
**Target commit:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Telegram publishing:** must remain disabled (`TELEGRAM_PUBLISH` unset or `0`)

---

## 1. Approval gate

This plan is not authorization to deploy. Execution starts only after explicit operator approval.

Once approved, the deployment must **not**:

- run `git reset --hard`, `git clean`, or force-push;
- overwrite `.env`;
- rebuild or restart `auth` or `caddy` (no changes in the target commit);
- publish anything to Telegram;
- delete backups or production data;
- reverse migration `0024`.

---

## 2. Preconditions already satisfied

| Precondition | Evidence |
|---|---|
| Exact target commit verified | `7b11c0a2ca682fb8d08483de632f6a28b6f601c6` |
| Local quality gates | 141/141 integration, 50/50 auth, lint, typecheck |
| Browser E2E | 65/65 on rerun; one transient Firefox flake documented |
| Auth image | Built and run locally; `/healthz` OK; cookies `Secure; HttpOnly; SameSite=Lax` |
| Fresh database | 24 migrations applied; `/healthz` 200 |
| Production containers | app/auth healthy, restarts 0 |
| Production disk | 7.5 GB available (image build needs well under 1 GB) |
| Pre-deployment backup | `endemion-2026-11-09T15-29-18.sqlite`, 130,523,136 bytes, integrity `ok`, also in S3 |
| Auth backup | `auth-2026-11-09T14-59-06.sqlite`, integrity `ok` |
| Migration state | `0023` last in production; `0024` pending and additive |
| Auth hotfix preservation | `git diff 42bad5c..7b11c0a -- auth` is empty |

---

## 3. Deployment runbook (after approval)

Run as `root` in `/opt/endemion`. Use `set -euo pipefail`. Keep the existing `.env`.

### Step 1 — Read-only preflight

```bash
cd /opt/endemion
date -u
df -h /
docker compose ps
git log -1 --format='%H %ci %s'
git status --porcelain=v1
curl -fsS https://endemion.online/healthz
```

Expected: app/auth healthy; HEAD `42bad5c`; working tree contains only the three modified auth files, `auth/migrations/0010_platform_manga.sql`, and `..env.swp`.

### Step 2 — Tag the current image for fast rollback

```bash
docker tag endemion-app endemion-app:pre-stage083-42bad5c
docker image inspect endemion-app:pre-stage083-42bad5c --format '{{.Id}}'
```

Expected image ID: `sha256:328cecb00e56a2f0aa21a76867deefee3454ef9c0b7d2e1e7aea72da9b3dfe8e`.

### Step 3 — Fetch and verify the exact commit

```bash
git fetch origin site-improve
git cat-file -e 7b11c0a2ca682fb8d08483de632f6a28b6f601c6^{commit}
git diff --name-only 42bad5cf2f5fafa41ecd8ddf45159d1a1090837e..7b11c0a2ca682fb8d08483de632f6a28b6f601c6 -- auth
git diff --name-only 42bad5cf2f5fafa41ecd8ddf45159d1a1090837e..7b11c0a2ca682fb8d08483de632f6a28b6f601c6 -- Dockerfile docker-compose.yml Caddyfile auth
```

Expected: the two diff commands print nothing. If either prints a path, stop and re-audit.

### Step 4 — Checkout the target, preserving the hotfix

```bash
git checkout 7b11c0a2ca682fb8d08483de632f6a28b6f601c6
git status --porcelain=v1
git diff --stat
git log -1 --format='%H %ci %s'
```

Expected status is unchanged: the three `M auth/src/*` files, `?? auth/migrations/0010_platform_manga.sql`, `?? ..env.swp`. The checkout must not delete or overwrite them. Do **not** run `git clean` or `git reset`.

### Step 5 — Validate configuration and build only the app

```bash
docker compose config --quiet
docker compose build app
docker image inspect endemion-app --format '{{.Id}}'
```

The old app keeps serving during the build. If the build fails, stop; production is untouched.

### Step 6 — Recreate only the app

```bash
docker compose up -d --no-deps app
```

Expected: old app container stops, new one starts; Caddy and auth are not recreated. Downtime should be seconds; the healthcheck has a 20 s start period and up to 3 retries.

### Step 7 — Verify startup, migration, and health

```bash
docker compose ps app
docker inspect --format '{{.State.Health.Status}} restarts={{.RestartCount}}' endemion-app-1
docker logs --tail 100 endemion-app-1
curl -fsS https://endemion.online/healthz
```

Expected log lines include a pre-migration backup and `Миграция применена: 0024_telegram_announcements.sql`, then the startup line. Wait up to 90 seconds for `healthy`.

Read-only database verification:

```bash
docker exec -i endemion-app-1 node --input-type=module - <<'JS'
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/app/data/endemion.sqlite", { readOnly: true });
console.log("integrity", db.prepare("PRAGMA integrity_check").get());
console.log("migrations", db.prepare("SELECT COUNT(*) AS n, MAX(name) AS last FROM d1_migrations").get());
console.log("telegram_posts", db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='telegram_posts'").get());
console.log("studio_version", db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('studio_posts') WHERE name='version'").get());
console.log("users", db.prepare("SELECT COUNT(*) AS n FROM users").get());
console.log("games", db.prepare("SELECT COUNT(*) AS n FROM games").get());
console.log("studio_posts", db.prepare("SELECT COUNT(*) AS n FROM studio_posts").get());
db.close();
JS
```

Expected: integrity `ok`; 24 migrations, last `0024_telegram_announcements.sql`; `telegram_posts` = 1; `studio_version` = 1; users 1; games 1; studio_posts 0.

### Step 8 — External smoke tests

```bash
for u in \
  https://endemion.online/ \
  https://endemion.online/games \
  https://endemion.online/community \
  https://endemion.online/studio \
  https://endemion.online/privacy \
  https://endemion.online/copyright \
  https://endemion.online/about \
  https://endemion.online/offline \
  https://endemion.online/manifest.webmanifest \
  https://endemion.online/healthz \
  https://auth.endemion.online/healthz \
  https://auth.endemion.online/.well-known/openid-configuration
do
  curl -sS -o /dev/null -w "%{http_code} $u\n" "$u"
done

curl -sS https://endemion.online/sw.js | grep -m1 'const VERSION'
curl -sSI https://endemion.online/ | grep -Ei 'strict-transport|content-security|x-content-type|x-frame|referrer-policy|permissions-policy'
curl -sS https://auth.endemion.online/.well-known/openid-configuration | grep -Eo '"issuer":"[^"]+"|"code_challenge_methods_supported":\[[^]]+\]'
```

Expected: 200 for all listed pages; `sw.js` version `v7`; security headers present; issuer `https://auth.endemion.online`; PKCE `S256`.

Optional auth cookie check (creates only a short-lived interaction, no account):

```bash
curl -sS -D - -o /dev/null \
  'https://auth.endemion.online/auth?client_id=endemion-web&redirect_uri=https%3A%2F%2Fendemion.online%2Fauth%2Fcallback&response_type=code&scope=openid&state=stage083&nonce=stage083&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc&code_challenge_method=S256' \
  | grep -i '^set-cookie:' | sed -E 's/^(set-cookie: [^=]+)=[^;]+/\1=<redacted>/I'
```

Expected: interaction cookies include `secure; httponly; samesite=lax`.

### Step 9 — Telegram safety check

```bash
docker exec endemion-app-1 printenv TELEGRAM_PUBLISH TELEGRAM_CHANNEL TELEGRAM_BOT_TOKEN | sed 's/.*/&/' | awk '{ if ($0=="") print "<empty>"; else print length($0) " chars" }'
```

Expected: `TELEGRAM_PUBLISH` unset/empty or `0`; `TELEGRAM_CHANNEL` unset/empty; bot token empty. Do not send a Telegram message. Verify that the public pages still link to the official channel, and that an unauthenticated admin request is rejected:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://endemion.online/api/admin/telegram/pending
```

Expected: 401 or 403. Publishing remains preview-only.

### Step 10 — Monitoring

For 15 minutes:

```bash
docker compose ps
docker logs --since 15m endemion-app-1 | grep -Ei 'error|exception|failed' || true
docker logs --since 15m endemion-caddy-1 | grep -Ei 'error| 5[0-9][0-9] ' || true
curl -fsS https://endemion.online/healthz
```

Expected: app stays healthy, restarts 0, no new error/5xx entries. Record results in `STAGE_08_3_DEPLOYMENT_REPORT.md` and `STAGE_08_3_PRODUCTION_QA_REPORT.md`.

---

## 4. Authenticated production QA

No production admin credentials were provided. To complete the authenticated checks without touching real users, choose one:

1. Operator provides a dedicated test account; or
2. Approve creation of one clearly marked disposable account, for example `stage083-qa-<timestamp>@example.test`, used only for registration/login/logout/profile, then deleted through the normal account deletion flow.

Do not use a real user's account. Do not create admin or production content beyond the disposable test account. If neither option is approved, mark authenticated journeys as **NOT TESTED** rather than claiming a pass.

---

## 5. Rollback plan

Rollback triggers: app not healthy after 2 minutes, repeated restart loop, migration error, 5xx rate increase, broken home/games/community/studio pages, auth redirect failure, or PWA regression.

Fast application rollback:

```bash
docker tag endemion-app:pre-stage083-42bad5c endemion-app
docker compose up -d --no-deps app
docker inspect --format '{{.State.Health.Status}} restarts={{.RestartCount}}' endemion-app-1
curl -fsS https://endemion.online/healthz
```

Alternative rollback from source:

```bash
git checkout 42bad5cf2f5fafa41ecd8ddf45159d1a1090837e
docker compose build app
docker compose up -d --no-deps app
```

Migration `0024` is additive; the old application ignores the new column and table. Do **not** drop `telegram_posts` or `studio_posts.version` as part of a normal rollback.

Database restore is a last resort, requires separate explicit approval, and uses the verified backup:

```bash
docker compose stop app
# Preserve WAL/SHM for investigation; do not delete live data without approval.
# Replace data/endemion.sqlite with data/backups/endemion-2026-11-09T15-29-18.sqlite
# using the project restore procedure, keep ownership 1000:1000, then:
docker compose start app
```

Auth was not rebuilt or migrated; no auth rollback is expected. The latest verified auth backup is `auth-2026-11-09T14-59-06.sqlite`.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Auth Manga hotfix lost | Verified `auth/` is unchanged by the target; never clean/reset; re-check status after checkout |
| Migration failure | Transactional per-migration runner; pre-migration backup; verified external backup; old app compatible |
| Caddy DNS cache after app recreation | App service name unchanged; verify health and external pages; restart only Caddy if 502 persists |
| Image build failure | Old container keeps serving; stop before `up` |
| Brief downtime | Build before switching; `up -d --no-deps app` only; expected seconds |
| Telegram accidental publish | Token empty, flag unset/0, no admin action; do not test publish |
| `.env.swp` secret exposure | Do not print; recommend secure removal by operator after confirming no vim session |
| Unauthenticated QA gap | Use operator account or approved disposable account; otherwise report NOT TESTED |
| Firefox favorites flake | Monitor; targeted 30/30 and rerun 65/65 passed; no code change at this SHA |

---

## 7. Estimated timing

| Phase | Time |
|---|---|
| Preflight and checkout | 2-5 minutes |
| App image build | 3-10 minutes (old app serving) |
| Container switch and health | 1-2 minutes |
| Migration and DB verification | 2 minutes |
| External smoke | 5 minutes |
| Monitoring | 15 minutes |
| **Total** | **~30-40 minutes** |

---

## 8. Go / No-Go

**Result: GO — approval received and deployment executed successfully.**

- Production baseline was healthy.
- Target commit and migrations were verified.
- Backup and rollback paths were ready.
- Auth hotfix preservation was confirmed.
- Telegram publishing remains disabled.
- Deployment and QA results: `STAGE_08_3_DEPLOYMENT_REPORT.md`, `STAGE_08_3_PRODUCTION_QA_REPORT.md`.

**Current state: EXECUTED — SUCCESS. No rollback was required.**
