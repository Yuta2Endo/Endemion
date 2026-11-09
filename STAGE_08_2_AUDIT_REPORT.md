# STAGE_08_2_AUDIT_REPORT — Final QA & Deployment Readiness Audit

**Status:** COMPLETED  
**Repository:** `G:\III\Project\Endemion` (GitHub: `Yuta2Endo/Endemion`, branch `site-improve`)  
**HEAD at audit start:** `15f210b Add STAGE_08_1_QA_CLOSURE_REPORT.md`  
**Production:** https://endemion.online/  
**Auth:** https://auth.endemion.online/  
**Previous stage:** STAGE 08.1 — Cross-Browser & User Journey QA Closure

---

## 1. Scope

Audit of the Stage 08.1 claims and the working tree before final QA:

- browser matrix (Chromium, Firefox, WebKit, Pixel 7, iPhone 14);
- PWA offline behaviour;
- mobile consent banner;
- authentication/rate-limit behaviour in E2E;
- Telegram announcement engine (Stage 09) and its tests;
- deployment readiness (Docker + Caddy + Node server, plus Cloudflare Worker configuration);
- repository hygiene and secret handling.

Production deployment and live Telegram publishing were explicitly **out of scope** and were not performed.

---

## 2. Documents and configuration audited

| Document / file | Result |
|---|---|
| `STAGE_08_1_QA_CLOSURE_REPORT.md` | Read; several claims did not match the code |
| `STAGE_08_QA_REPORT.md` | Read |
| `STAGE_09_REPORT.md`, `STAGE_09_IMPLEMENTATION_REPORT.md` | Read |
| `package.json`, `playwright.config.js`, `wrangler.toml` | Read |
| `DEPLOY.md`, `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `.env.example` | Read |
| `public/sw.js`, `public/assets/base.css`, `public/assets/app.js` | Read |
| `functions/_lib/rateLimit.js`, `functions/_lib/http.js`, `functions/_lib/telegram*.js` | Read |
| `tests/e2e/*`, `tests/telegram.test.mjs` | Read |
| `migrations/0024_telegram_announcements.sql` | Read |

Repository state at audit start had uncommitted modifications in:

- `functions/_lib/studio.js` (UNIQUE violation → `null`);
- `functions/_lib/telegram-announce.js` (broken intermediate atomic-dedupe rewrite);
- `functions/api/games/reviews.js` (409 on duplicate review).

These changes were preserved, not reset or discarded.

---

## 3. Discrepancies found

### 3.1 Integration-test count was understated in the script

`package.json` `test` ran 11 files and produced **118** tests, while `tests/telegram.test.mjs` (23 tests) existed but was not part of `npm test`. Stage 08.1/09 reports reported 118 tests while separately claiming Telegram tests passed. The script did not exercise them.

### 3.2 Stage 08.1 Firefox PWA root cause was wrong

The closure report stated that Firefox `fetch()` returns a non-OK response when offline. Direct instrumentation showed a different behaviour:

- Playwright Firefox `context.setOffline(true)` does **not** block network requests made by a service worker;
- `page.evaluate(fetch("/copyright"))` fails with `NetworkError`, but the service worker's `fetch` still succeeds;
- `navigator.onLine` inside the service worker stays `true`;
- `context.serviceWorkers()` returns `[]` in Firefox (workers are not exposed through the Playwright API);
- `context.route(...).abort()` intercepts the top-level navigation and bypasses the service worker.

The fix therefore had to let the **page** signal the service worker that the test wants an offline simulation, not rely on browser network emulation.

### 3.3 Stage 08.1 Android consent root cause was wrong

The reported root cause was flexbox/`display:flex` pointer interception. The actual defect was a real horizontal overflow in the header:

- Pixel 7 emulation: `clientWidth = 412`, `scrollWidth = 469`, `body.scrollWidth = 469`;
- `.nav-actions` extended to `right = 469` (width 399);
- Chrome expanded the layout viewport to `469×956` while the visual viewport stayed `412×839`;
- the fixed consent banner was laid out at `y = 743…940`, so its buttons were below the visual viewport;
- Playwright clicked at visual-viewport coordinates, where `.home-featured-media` sat above the banner.

The header overflow was caused by `.nav-search` not being hidden or compacted at phone widths.

### 3.4 E2E rate-limit contamination across projects

All five Playwright projects shared one local IP `127.0.0.1` in `.wrangler` D1:

- `auth_attempts` reached the IP cap (30 per 15 min), producing 429 on iPhone;
- each project shared the same global-setup admin user, so per-user action limits (thread 3/10 min, comment 6/min) and duplicate-comment detection (409 "Такой комментарий уже отправлен.") blocked later projects.

`wrangler dev` does honour a supplied `CF-Connecting-IP` header locally (verified with `203.0.113.5`, recorded as `ip:203.0.113.5`), so projects can be isolated without weakening production.

### 3.5 Telegram dedupe implementation was broken in the working tree

The uncommitted `announceRelease()` performed only:

```sql
UPDATE telegram_posts SET status = 'pending', ... WHERE post_id = ? AND status NOT IN (...)
```

For a post that had never been published there was no row to update, so `changes === 0` and the first publish returned HTTP 400 ("Отправка уже выполняется другим запросом.") instead of 201. `attempts` was also incremented twice (in the pending update and again in `setFailed`), so tests expected 1 but received 2.

### 3.6 Reporting inconsistencies

- Stage 08.1 mentioned a `telegram_announcements` table; migration `0024` creates `telegram_posts`.
- Stage 08.1 marked Firefox PWA as "PASS (with limitation)" while the test failed.
- Stage 08.1 listed Android/iPhone as "not tested"; the failures were later reproduced and are addressed in this stage.

---

## 4. Risk register

| ID | Risk | Severity | Status after this stage |
|---|---|---|---|
| A1 | First Telegram publish impossible (no INSERT) | Critical | Fixed |
| A2 | Duplicate `attempts` count | Medium | Fixed |
| A3 | Firefox offline test not actually exercising the SW | High | Fixed |
| A4 | Mobile header overflow breaks consent UX | High | Fixed |
| A5 | Cross-project E2E limits cause false failures | High | Fixed |
| A6 | Telegram tests not part of `npm test` | Medium | Fixed |
| A7 | Mobile validation available only as viewport emulation | Medium | Accepted limitation |
| A8 | No physical-device, load, or penetration testing | Medium | Accepted limitation |
| A9 | Production not deployed in this stage | — | Intentionally deferred |

---

## 5. Audit conclusion

The Stage 08.1 closure report could not be accepted as-is: two "fixed" issues were misdiagnosed, the Telegram engine had a blocking first-publish bug, and the browser suite was not deterministic. Stage 08.2 re-diagnosed the failures, fixed them, and re-ran the full suite. No production change was made.
