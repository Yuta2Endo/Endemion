# STAGE_08_3_ROLLBACK_REPORT — Rollback Readiness Report

**Status:** **READY — NOT EXECUTED**  
**Deployment:** completed successfully; rollback not required  
**Deployed commit:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`  
**Previous commit:** `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e`  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/

---

## 1. Rollback points

| Point | Identifier | Status |
|---|---|---|
| Previous application commit | `42bad5cf2f5fafa41ecd8ddf45159d1a1090837e` | Available |
| Previous application image | `endemion-app:pre-stage083-42bad5c` = `sha256:328cecb00e56a2f0aa21a76867deefee3454ef9c0b7d2e1e7aea72da9b3dfe8e` | **Created before deployment** |
| Current application image | `sha256:e6ddb03c59120dd501abe23d773452be9acbfacbeb1969aa58c6ec78d9ae20a8` | Healthy |
| Manual site backup | `data/backups/endemion-2026-11-09T15-29-18.sqlite` | Verified, S3 copy |
| Automatic pre-migration backup | `data/backups/endemion-2026-11-09T15-41-50.sqlite` | Verified, 23 migrations, S3 copy |
| Auth database backup | `data/auth/backups/auth-2026-11-09T15-59-06.sqlite` | Verified: integrity `ok`, 10 migrations, 2 accounts |

The rollback image tag was created before the build, so fast rollback is available without rebuilding.

---

## 2. Rollback triggers

Rollback would have been triggered by:

- app not healthy within 2 minutes or a restart loop;
- migration `0024` failure or database integrity failure;
- material 5xx increase or previously working pages failing;
- broken home, games, community, studio, legal, auth, or PWA behaviour;
- unexpected production data changes.

No rollback trigger occurred. One expected Caddy 502 was recorded at 15:41:50 UTC during the app restart window (a bot request to `/wp-admin/install.php`); there were no 5xx after the container became healthy. The migration succeeded, integrity remained `ok`, row counts were unchanged, and the app logs had no errors in the observation window.

---

## 3. Fast application rollback (available, not used)

```bash
cd /opt/endemion
docker tag endemion-app:pre-stage083-42bad5c endemion-app
docker compose up -d --no-deps app
docker inspect --format '{{.State.Health.Status}} restarts={{.RestartCount}}' endemion-app-1
curl -fsS https://endemion.online/healthz
```

Then verify the public pages, auth discovery, and that `/sw.js` returns the previous version (`v6`).

### Rebuild alternative

```bash
cd /opt/endemion
git checkout 42bad5cf2f5fafa41ecd8ddf45159d1a1090837e
git status --porcelain=v1
docker compose build app
docker compose up -d --no-deps app
```

The production-only auth modifications are unchanged between the two commits and must remain in the working tree. Do not clean or reset.

---

## 4. Database rollback policy

Migration `0024` is additive:

- adds nullable `studio_posts.version`;
- creates `telegram_posts` and two indexes;
- does not rewrite existing rows.

The previous application (`42bad5c`) ignores the new column and table, so a normal application rollback does **not** require a database rollback. Do not drop `telegram_posts` or `studio_posts.version` during a normal rollback.

### Last-resort restore

Only with separate explicit approval, and only for corruption or a failed migration that cannot be corrected forward:

```bash
cd /opt/endemion
docker compose stop app
# Follow DEPLOY.md: preserve the current database and WAL/SHM for investigation;
# replace data/endemion.sqlite with a verified backup;
# remove data/endemion.sqlite-wal and data/endemion.sqlite-shm;
# keep ownership 1000:1000.
docker compose start app
curl -fsS https://endemion.online/healthz
```

The manual pre-deployment restore point is 2026-11-09 15:29 UTC. Data written after that time would be lost. The automatic pre-migration backup at 15:41:50 is an additional recovery point.

---

## 5. Auth rollback

Auth was not rebuilt, restarted, or migrated:

- `auth/` is unchanged between `42bad5c` and `7b11c0a`;
- the production Manga hotfix remains in the working tree;
- auth migrations remain at `0010_platform_manga.sql`;
- auth container uptime and image are unchanged.

No auth rollback is expected.

---

## 6. Current verification after deployment

| Check | Result |
|---|---|
| App health | healthy, 0 restarts |
| `/healthz` | 200 `ok` on every check |
| Public pages | 200 |
| PWA | `v7`; offline page works |
| Auth discovery | 200; issuer unchanged |
| Site database | integrity `ok`; 24 migrations |
| Auth database | integrity `ok`; 10 migrations |
| Row counts | users 1; games 1; studio posts 0 |
| App/Caddy logs | no app errors; one expected 502 during the restart window, none afterward |
| Telegram | disabled; no messages sent |

---

## 7. Conclusion

Rollback readiness was established before deployment and remains available. No rollback was needed or executed.

**Status: READY — NOT EXECUTED.**
