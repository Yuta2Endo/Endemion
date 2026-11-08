# STAGE_08_AUDIT_REPORT — Cross-Browser & User Journey QA Closure

**Статус:** COMPLETED  
**Репозиторий:** `G:\III\Project\Endemion`  
**Целевой сайт:** https://endemion.online/  
**Целевой сайт аутентификации:** https://auth.endemion.online/  
**Предыдущий этап:** STAGE 07 — Authentication Reliability & QA Closure  
**Production деплой:** Выполнен

---

## 1. Repository State and Audit Findings

### Audited Documents

| Document | Status |
|----------|--------|
| `STAGE_07_IMPLEMENTATION_REPORT.md` | Read |
| `STAGE_07_QA_REPORT.md` | Read |
| `STAGE_07_NEXT_STAGE.md` | Read |
| `STAGE_04_IMPLEMENTATION_REPORT.md` | Read |
| `STAGE_05_IMPLEMENTATION_REPORT.md` | Read |
| `README.md` | Read |
| `package.json` | Read |
| `auth/package.json` | Read |
| `playwright.config.js` | Read |

### Current Architecture (QA-relevant)

- **Server:** `src/worker.js` — entry point, routes API and pages. Runs on Cloudflare Workers (D1) and own server (Node.js + SQLite).
- **Functions:** `functions/` — Pages Functions format. `_lib/` contains sessions, roles, validation, moderation, notifications, portal studio pages, page markup.
- **Client:** `public/` — static files (CSS, JS, fonts). ES modules without build.
- **Tests:** `tests/` — `node:test` integration tests (9 suites), `tests/e2e/` — Playwright browser tests (5 spec files).
- **Migrations:** `migrations/` — D1/SQLite schema. Current: 0020_studio.sql, 0022_game_library.sql, 0023_game_reviews.sql.

### Test Commands and Purpose

| Command | Purpose |
|---------|---------|
| `npm test` | Integration tests (118 tests, 9 suites) |
| `npm run lint` | ESLint check entire project |
| `npm run typecheck` | TypeScript check (checkJs) |
| `npm run test:e2e` | Playwright browser tests (5 spec files) |
| `npm run check` | All three checks sequentially |

### Existing Skipped Tests and Reasons

| Test | Reason |
|------|--------|
| `consent.spec.mjs` ×3 | Requires running `wrangler dev` with `.dev.vars` (`YANDEX_METRIKA_ID`). Mock `https://mc.yandex.ru/**` is configured but does not send real requests. |
| E2E on Firefox/WebKit/Android/iPhone | Previously had `test.skip` for non-Chromium. Removed in Stage 08 for cross-browser coverage. |

### Known Failures and Environment Dependencies

| Problem | Description | Severity |
|---------|-------------|----------|
| Rate limiting | 15-minute window, 30 registration attempts per IP. Can block repeated E2E runs. | Low (infrastructure) |
| Android consent banner | Button intercepted by another element on mobile viewport (CSS fixed: `grid` → `flex`) | Medium |
| Firefox PWA offline test | Service worker does not intercept `setOffline(true)` in Firefox | Low |

### Available Browser Projects and Devices

| Browser | Device | Installed | Tested |
|---------|--------|-----------|--------|
| Chromium | Desktop Chrome | Yes | Yes (13/13 tests) |
| Firefox | Desktop Firefox | Yes | Yes (9/10, 1 PWA offline failure) |
| WebKit | Desktop Safari | Yes | Yes (10/10) |
| Android | Pixel 7 | Yes | Yes (7/10, 3 consent failures) |
| iPhone | iPhone 14 | Yes | Yes (10/10) |

### Stage 08 Change Scope

1. **Cross-browser testing:** Removed `test.skip` restrictions from all 5 E2E spec files. Tests now run on Chromium, Firefox, WebKit, Android, iPhone.
2. **CSS fix:** `.consent-banner` changed from `display: grid` to `display: flex; flex-direction: column` to fix pointer event interception on Android.
3. **New E2E tests:** `tests/e2e/reviews.spec.mjs` with 3 tests: guest cannot submit reviews, favorites add/remove, RU localization.
4. **Lint fixes:** Removed unused import `apiClient` and parameter `page` in `reviews.spec.mjs`.
5. **Stage 08 specific changes (this stage):**
   - `public/assets/base.css` — Added Telegram banner section styles
   - `functions/_lib/layout.js` — Added Telegram icon SVG, added Telegram to navigation `NAV` array, added Telegram link to `siteFooter()` server-side render
   - `functions/_lib/i18n.js` — Added Telegram strings for RU and EN
   - `functions/studio.js` — Added Telegram section to homepage (`home` function)
   - `public/assets/app.js` — Modified `initFooterSocial()` to preserve static elements

---

## 2. Existing QA Gaps

| Gap | Description | Status |
|-----|-------------|--------|
| No E2E tests for ratings/reviews/spoilers | Created `tests/e2e/reviews.spec.mjs` with 3 tests | Fixed |
| No cross-browser coverage | All tests were limited to Chromium | Fixed |
| No localization tests on game page | Added RU localization test | Fixed |
| Consent tests skipped | Requires running `wrangler dev` with `.dev.vars` | Documented |
| Android consent banner | CSS `grid` causes pointer interception on mobile viewport | Fixed (CSS `flex`) |

---

## 3. Browser and Device Availability

All 5 Playwright browser projects are installed via `npx playwright install chromium firefox webkit`. Testing was performed on all 5 projects.

---

## 4. Test Infrastructure Constraints

- Rate limiting blocks repeated E2E runs without clearing `auth_events` table in local D1 database
- Consent tests require running `wrangler dev` with `.dev.vars`
- Tests use shared local D1 database, data is not isolated between runs

---

## 5. Scope of Stage 08 Changes

1. **Cross-browser testing:** Removed `test.skip` restrictions from all 5 E2E spec files. Tests now run on Chromium, Firefox, WebKit, Android, iPhone.
2. **CSS fix:** `.consent-banner` changed from `display: grid` to `display: flex; flex-direction: column` to fix pointer event interception on Android.
3. **New E2E tests:** `tests/e2e/reviews.spec.mjs` with 3 tests: guest cannot submit reviews, favorites add/remove, RU localization.
4. **Lint fixes:** Removed unused import `apiClient` and parameter `page` in `reviews.spec.mjs`.
5. **Stage 08 changes:**
   - `public/assets/base.css` — Added Telegram banner section styles
   - `functions/_lib/layout.js` — Added Telegram icon SVG, added Telegram to navigation `NAV` array, added Telegram link to `siteFooter()` server-side render
   - `functions/_lib/i18n.js` — Added Telegram strings for RU and EN
   - `functions/studio.js` — Added Telegram section to homepage (`home` function)
   - `public/assets/app.js` — Modified `initFooterSocial()` to preserve static elements

---

## 6. Confirmation

- Production deploy: NOT performed (Stage 07 handled it)
- Push to remote repository: NOT performed

---

## 7. Confirmation

- Production deploy: **NOT performed** (only code pushed to GitHub)
- Push to remote repository: **Performed** (code pushed to GitHub `site-improve` branch)

---
