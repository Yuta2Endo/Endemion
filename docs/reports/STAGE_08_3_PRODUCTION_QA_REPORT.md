# STAGE_08_3_PRODUCTION_QA_REPORT — Production QA Report

**Status:** **COMPLETED — PASS (with limitations)**  
**Deployment:** completed 2026-11-09 15:41:56 UTC  
**Verified commit:** `7b11c0a2ca682fb8d08483de632f6a28b6f601c6`  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Telegram publishing:** disabled

---

## 1. Pre-deployment baseline

| Check | Baseline (before deploy) | After deploy |
|---|---|---|
| Home | 200 | 200 |
| `/games` | 200 | 200 |
| `/community` | 200 | 200 |
| `/studio` | 200 | 200 |
| Legal pages | 200 | 200 |
| `/healthz` | 200 `ok` | 200 `ok` |
| `sw.js` version | `v6` | **`v7`** |
| Site migrations | 23 | **24** |
| Auth migrations | 10 | 10 |
| Users / games / studio posts | 1 / 1 / 0 | 1 / 1 / 0 |
| App container | healthy, 0 restarts | healthy, 0 restarts |

---

## 2. Public pages and assets

| Test | Result |
|---|---|
| Home page | 200, rendered, no console errors |
| Games catalog | 200, no console errors |
| Game page `/games/endemion-life` | 200, no console errors |
| Community `/community` | 200, no console errors |
| Studio `/studio` | 200, no console errors |
| Privacy `/privacy` | 200, no console errors |
| Copyright `/copyright` | 200, no console errors |
| About `/about` | 200, no console errors |
| Offline `/offline` | 200, no console errors |
| Manifest | 200, `application/manifest+json` |
| Icon `/icons/icon-192.png?v=2` | 200, PNG |
| CSS `/assets/base.css` | 200, CSS |
| Consent banner | visible, clickable, stored `endemion:analytics` locally |
| Header width at 412 px | `clientWidth=412`, `scrollWidth=412`, `bodyScrollWidth=412` |

The legacy `/forum` path remains 404; the actual forum route is `/community` and returns 200. `/encyclopedia` remains a 301 to `/` by design.

---

## 3. PWA

| Test | Result |
|---|---|
| `sw.js` version | `v7` |
| Service worker scope | `https://endemion.online/` |
| Active worker | `/sw.js` |
| Page controlled by worker | yes |
| Cache | `endemion-v7` only |
| Offline navigation | offline page rendered with title "Нет связи — Endemion" |
| Console errors | none |

---

## 4. Auth / Endemion ID

| Test | Result |
|---|---|
| Discovery | 200; issuer `https://auth.endemion.online` |
| PKCE | `S256` advertised and required |
| Authorize request | 303 to `/interaction/...` |
| Interaction cookies | `Secure; HttpOnly; SameSite=Lax` |
| Auth CSP | site, Life, and Manga origins allowed |
| Client registrations | `endemion-web`, `endemion-life-web`, `endemion-manga-web` |
| Login page flow | reached through the real site login redirect |
| Registration | disposable Endemion ID created; redirected to `/profile` |
| Site session | `/api/me` returned the expected user |
| Site account deletion | 200 `{"ok":true}` |
| Auth account deletion | notice shown, account removed |
| Post-deletion site state | `/api/me` returned `user: null` |
| App database | test users 0; users back to 1; profiles 1; orphan sessions 0 |
| Auth database | test accounts 0; accounts back to 2; links 1 |
| Database integrity | both `ok` |

Disposable account: `stage083qa39217012`. It was created only for this QA run and removed. No password or email address is reproduced here.

---

## 5. Telegram

| Test | Result |
|---|---|
| Public channel link | `https://t.me/EndemionOfficial` present |
| `TELEGRAM_PUBLISH` | empty |
| `TELEGRAM_CHANNEL` | empty |
| `TELEGRAM_BOT_TOKEN` | empty |
| Unauthenticated `/api/admin/telegram/pending` | 401 |
| Publish/preview | not exercised; publishing intentionally disabled |

No Telegram message was sent. Admin preview/publish with an authenticated administrator remains untested and must remain disabled.

---

## 6. Database and infrastructure

| Test | Result |
|---|---|
| Site migration count | 24, last `0024_telegram_announcements.sql` |
| `telegram_posts` table | present |
| `studio_posts.version` column | present |
| Site integrity | `ok` |
| Users / games / studio posts | 1 / 1 / 0 |
| Auth migration count | 10, last `0010_platform_manga.sql` |
| Auth integrity | `ok` |
| Manual backup | `endemion-2026-11-09T15-29-18.sqlite`, integrity `ok`, S3 copy |
| Automatic pre-migration backup | `endemion-2026-11-09T15-41-50.sqlite`, integrity `ok`, S3 copy |
| App container | healthy, restarts 0 |
| Auth container | healthy, restarts 0, unchanged uptime |
| Disk | 7.4 GB free |
| Security headers | HSTS, CSP, nosniff, DENY, referrer and permissions policies present |
| Caddy | one expected 502 at 15:41:50 during the app restart (bot request); none after |

---

## 7. Monitoring

Ten checks between 15:48:17 and 16:01:49 UTC, plus immediate post-deployment checks:

- `/healthz` = `ok` on every check;
- app healthy, restarts 0;
- no app error/exception/failed/fatal entries in the 20-minute observation window;
- one expected Caddy 502 at 15:41:50 during the app restart (bot request to `/wp-admin/install.php`); no 5xx after the container became healthy;
- auth healthy, restarts 0;
- no unexpected row-count changes.

---

## 8. Test basis

Local exact-commit verification before deployment:

| Check | Result |
|---|---|
| `npm test` | 141/141 |
| `npm --prefix auth test` | 50/50 |
| Lint / typecheck | clean |
| Full Playwright | 65/65 on rerun |
| Targeted Firefox reviews | 30/30 |

One transient Firefox favorites E2E failure occurred on the first full local run and did not reproduce. It was not observed in production.

---

## 9. Limitations

1. No authenticated administrator was available; Telegram admin preview/publish and admin panel flows were not exercised.
2. Telegram publishing was intentionally left disabled; no live delivery was tested.
3. No physical iOS or Android device; mobile checks are viewport emulation.
4. HTTP/3 could not be probed directly with the local curl build; `Alt-Svc: h3` is advertised.
5. No load, stress, penetration, or accessibility audit was performed.
6. Authenticated QA used one disposable account only; broader multi-user/permission scenarios were covered by local automated tests, not production.
7. One local Firefox favorites flake remains a low-frequency test risk.

---

## 10. Conclusion

Production QA passes for the deployed public site, PWA, Endemion ID authentication, registration/login/deletion journey, database migration, backups, and monitoring. Admin/Telegram publishing and physical-device checks remain limited as described.

**Status: COMPLETED — PASS (with limitations).**
