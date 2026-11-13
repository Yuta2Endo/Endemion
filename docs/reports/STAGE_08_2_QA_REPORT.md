# STAGE_08_2_QA_REPORT — Final Regression Results

**Status:** PASS  
**Date:** 2026-11-09  
**Branch:** `site-improve`  
**Node:** v26.13.0  
**Playwright:** 1.64.1  
**Wrangler:** 4.156.0  
**Environment:** Windows, local `wrangler dev` on `127.0.0.1:8787`, local D1

---

## 1. Integration tests

Command:

```
npm test
```

Result:

| Metric | Value |
|---|---|
| Test files in script | 12 |
| Tests | 141 |
| Passed | 141 |
| Failed | 0 |
| Skipped | 0 |
| Duration | ~23.7 s |

`tests/telegram.test.mjs` is now part of `npm test` (23 tests). Its simulated delivery failures intentionally print two `Телеграм: … не доставлен` lines to stderr; those are expected assertions about logging without the token, not failures.

---

## 2. Static checks

| Command | Result |
|---|---|
| `npm run lint` | 0 errors |
| `npm run typecheck` | 0 errors |

---

## 3. Browser E2E

Command:

```
npx playwright test --reporter=list
```

Result: **65 passed, 0 failed, 0 skipped** in 53.6 s.

Every project contains 13 tests (account 1, admin 2, consent 3, forum 2, PWA 2, reviews 3):

| Project | Device / engine | Passed | Failed | Status |
|---|---|---|---|---|
| `chromium` | Desktop Chrome | 13 | 0 | PASS |
| `firefox` | Desktop Firefox | 13 | 0 | PASS |
| `webkit` | Desktop Safari | 13 | 0 | PASS |
| `android` | Pixel 7 (viewport emulation) | 13 | 0 | PASS |
| `iphone` | iPhone 14 (viewport emulation) | 13 | 0 | PASS |

No retries were required.

### Targeted runs performed during the stage

| Command | Result |
|---|---|
| `npx playwright test tests/e2e/pwa.spec.mjs --project=chromium --project=firefox --project=webkit` | 6 passed |
| `npx playwright test tests/e2e/consent.spec.mjs --project=android --project=iphone` | 6 passed |
| `npx playwright test tests/e2e/{admin,forum,reviews,account,consent}.spec.mjs --project=chromium` | 11 passed |
| `npx playwright test tests/e2e/{admin,forum,reviews,account,consent}.spec.mjs --project=android --project=iphone` | 22 passed |

---

## 4. Previously failing scenarios — before/after

| Scenario | Before | After |
|---|---|---|
| Firefox PWA offline page | Failed (SW ignored `setOffline`) | Pass |
| Android consent (3 tests) | Timeout / pointer intercepted by `.home-featured-media` | Pass |
| Android/admin role tag | Element not found | Pass |
| iPhone account/admin 429 | 429 Too Many Requests | Pass |
| Android/iPhone forum thread | `waitForURL` timeout | Pass |
| Firefox/WebKit forum reply | 409 duplicate comment | Pass |
| Telegram first publish | 400 "Отправка уже выполняется другим запросом." | 201 + `published` |
| Telegram `attempts` | 2 instead of 1 | 1 |
| Telegram pending list | Post remained after publish | Removed after publish |

---

## 5. Test-design changes affecting results

- Each browser project now authenticates as its own administrator and sends its own `CF-Connecting-IP`.
- Local `auth_attempts` and `rate_events` are cleared in setup and teardown.
- Test data (e-mails, subjects, replies, slugs) is unique per test run.
- These changes remove false 429/409 failures; they do **not** relax any production limiter.

---

## 6. Known limitations

1. **Mobile results are viewport emulation.** Pixel 7 and iPhone 14 run in desktop Chromium/WebKit with mobile emulation; no physical iOS/Android device was available.
2. **Firefox offline simulation is test-only.** The service worker accepts the simulation message only on `localhost`/`127.0.0.1`. Real offline behaviour in Firefox could not be reproduced because Playwright Firefox does not expose service workers and does not apply `setOffline` to them.
3. **No load, penetration, or accessibility audit** was performed in this stage.
4. **Full browser suite was run once.** Focused subsets were run multiple times; a long flakiness soak was not performed.
5. **No production testing.** The suite targets the local Worker emulator; `https://endemion.online/` was not exercised.
6. **Auth service tests** (`npm --prefix auth test`) were not part of this run.
7. **Cloudflare Worker deployment path** was not exercised with `wrangler deploy`; deployment readiness was validated through the Docker/Node path and static configuration checks.

---

## 7. Conclusion

All available automated checks pass: 141 integration tests, 65 browser tests across five projects, lint, and typecheck. The verification is sufficient for a **conditional deployment readiness** decision, with the limitations above recorded in `STAGE_08_2_DEPLOYMENT_READINESS.md`.
