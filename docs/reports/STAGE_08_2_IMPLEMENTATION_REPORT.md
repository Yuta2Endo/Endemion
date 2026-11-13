# STAGE_08_2_IMPLEMENTATION_REPORT — Final QA Fixes

**Status:** COMPLETED  
**Branch:** `site-improve`  
**Base commit:** `15f210b`  
**Production deployment:** not performed  
**Telegram production publishing:** not enabled (`TELEGRAM_PUBLISH=0`)

---

## 1. Summary of changes

| Area | File(s) | Change |
|---|---|---|
| PWA / Firefox | `public/sw.js`, `tests/e2e/pwa.spec.mjs` | Localhost-only offline simulation hook, navigation fallback corrected, service-worker version `v7` |
| Mobile layout | `public/assets/base.css` | Hide header search on phones, constrain consent banner to the viewport, remove duplicate `.consent-actions` rule |
| E2E determinism | `tests/e2e/helpers.mjs`, `global-setup.mjs`, `global-teardown.mjs`, `playwright.config.js` | Per-project users and per-project `CF-Connecting-IP`, unique test data, limiter reset |
| E2E specs | `tests/e2e/account.spec.mjs`, `admin.spec.mjs`, `consent.spec.mjs`, `forum.spec.mjs`, `reviews.spec.mjs` | Use the admin of the current project, unique values, project IP |
| Telegram | `functions/_lib/telegram-announce.js` | Atomic `INSERT … ON CONFLICT DO UPDATE`, single attempt increment, `published_at`, scoped `setFailed` |
| Test script | `package.json` | `tests/telegram.test.mjs` added to `npm test` |
| Existing work preserved | `functions/_lib/studio.js`, `functions/api/games/reviews.js` | Duplicate-review UNIQUE handling retained |

No production files, secrets, or deployment configuration were changed beyond the items above.

---

## 2. Firefox PWA offline test

### Root cause

Playwright Firefox does not apply `context.setOffline(true)` to service-worker network requests. The page sees a network error, the service worker does not. Because Firefox also does not expose service workers through `context.serviceWorkers()`, the test cannot manipulate the worker from the outside.

### Implementation

`public/sw.js`:

- `VERSION = "v7"`, cache `endemion-v7`;
- a `message` handler accepts `endemion:simulate-offline` / `endemion:simulate-online` **only** when `self.location.hostname` is `localhost` or `127.0.0.1`;
- the handler returns a `{ type: "endemion:simulation", offline }` acknowledgement so the test can synchronise;
- `networkFirst()` and navigation requests honour the simulated state;
- navigation fallback is used on network errors and HTTP `5xx`, while `4xx` responses are preserved;
- the compiled/offline page is returned from the `endemion-v7` cache.

Production hosts (`endemion.online`, `auth.endemion.online`) never enter the simulation branch.

`tests/e2e/pwa.spec.mjs`:

- added `setSimulatedOffline(page, offline)`, which posts the message and waits for the acknowledgement;
- offline test sets both the simulated state and `context.setOffline(true)`, navigates to `/copyright`, expects the offline page, then restores both flags.

---

## 3. Mobile consent banner

### Root cause

The header row could not fit on a 412 px phone: `.nav-search` plus the notification, account, language, and menu buttons reached 399 px inside a 412 px viewport, pushing `scrollWidth` to 469 px. The fixed consent banner then used the expanded layout viewport, so its buttons fell below the visual viewport and Playwright clicked the featured-media block instead.

### Implementation

`public/assets/base.css`:

- in `@media (max-width: 680px)`, `.nav-search { display: none; }` (search remains on tablets and desktop);
- consent banner now has `max-height: calc(100vh - 32px)` / `calc(100dvh - 32px)` and `overflow-y: auto`;
- the duplicated `.consent-actions` declaration was merged into one rule (`flex-wrap`, `gap: 8px`).

### Verification result

With the fix, Pixel 7 emulation reports:

- `clientWidth = 412`, `scrollWidth = 412`, `bodyScrollWidth = 412`;
- banner at `x=16, y=626, width=380, height=197`, bottom `823` inside the `839` visual viewport;
- the primary button is fully visible and clickable.

---

## 4. Deterministic E2E authentication and limits

### Implementation

`tests/e2e/helpers.mjs`:

- `PROJECT_IPS` assigns a distinct documentation-range IP to each project (`10.10.0.1` … `10.10.0.5`);
- `apiClient(cookie, ip)` always sends `CF-Connecting-IP`;
- `clearRateLimits()` removes `auth_attempts` and `rate_events` from local D1;
- `adminFor(projectName)`, `uniqueSuffix()` added.

`playwright.config.js`:

- every project sets `extraHTTPHeaders: { "CF-Connecting-IP": PROJECT_IPS[name] }`.

`tests/e2e/global-setup.mjs`:

- clears local limiter tables;
- registers one administrator per project (unique e-mail, project IP);
- grants admin rights via the existing local command;
- publishes `E2E_STATE = { password, admins }`.

`tests/e2e/global-teardown.mjs`:

- deletes every project administrator via `DELETE /api/me`;
- clears limiter tables again.

Spec changes:

- `admin`, `consent`, `forum`, `reviews` use `adminFor(test.info().project.name).cookie`;
- `account` and `forum` register users with the project IP;
- e-mails, thread subjects, reply bodies, and game slugs include `uniqueSuffix()`;
- reply assertions use the unique text.

This isolates the IP bucket and the per-user action/duplicate limits without changing production behaviour: in production Cloudflare supplies `CF-Connecting-IP`, and a client cannot override it.

---

## 5. Telegram announcement engine

`functions/_lib/telegram-announce.js`:

- replaced the UPDATE-only pending transition with an atomic upsert:

```sql
INSERT INTO telegram_posts (post_id, status, chat_id, message_id, error, attempts)
VALUES (?, 'pending', ?, NULL, NULL, 1)
ON CONFLICT(post_id) DO UPDATE SET
  status = 'pending', chat_id = excluded.chat_id, message_id = NULL, error = NULL,
  published_at = NULL, attempts = telegram_posts.attempts + 1, updated_at = datetime('now')
WHERE telegram_posts.status NOT IN ('pending', 'published');
```

- first publish now inserts a row and proceeds; concurrent requests see `changes = 0`;
- `published` rows return `duplicate: true`; `pending` rows return the "already in progress" response;
- `attempts` is incremented exactly once per publish cycle;
- `setFailed()` no longer increments `attempts` and only updates rows still in `pending`;
- successful delivery records `published_at`.

`package.json`:

- `tests/telegram.test.mjs` added to the `test` script.

No Telegram token was added anywhere. `TELEGRAM_PUBLISH` remains `"0"` in `wrangler.toml` and `.env.example`.

---

## 6. Files changed

```
functions/_lib/telegram-announce.js
package.json
playwright.config.js
public/assets/base.css
public/sw.js
tests/e2e/account.spec.mjs
tests/e2e/admin.spec.mjs
tests/e2e/consent.spec.mjs
tests/e2e/forum.spec.mjs
tests/e2e/global-setup.mjs
tests/e2e/global-teardown.mjs
tests/e2e/helpers.mjs
tests/e2e/pwa.spec.mjs
tests/e2e/reviews.spec.mjs
```

Preserved pre-existing working-tree changes:

```
functions/_lib/studio.js
functions/api/games/reviews.js
```

New Stage 08.2 reports:

```
STAGE_08_2_AUDIT_REPORT.md
STAGE_08_2_IMPLEMENTATION_REPORT.md
STAGE_08_2_QA_REPORT.md
STAGE_08_2_DEPLOYMENT_READINESS.md
```
