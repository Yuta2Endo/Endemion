# Endemion ID (auth.endemion.online) — Favicon Update Report

**Branch:** `feature/favicon` (worktree `G:/III/Project/Endemion-favicon`)
**Date:** 2026-11-05
**Deployment:** not performed.

---

## 1. Audit

Endemion ID is a separate Node service (`auth/`, OIDC provider) built from the same repository as the main site (`auth/Dockerfile`, `docker-compose.yml` service `auth`, Caddy routes `auth.<domain>` to `auth:3001`).

| Item | Location | Finding |
|---|---|---|
| Page `<head>` | `auth/src/views.mjs`, function `layout()` | One icon link: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` (old simplified SVG logo). No manifest, no apple-touch-icon. |
| Static serving | `auth/src/app.mjs`, `serveStatic()` | Serves only its own CSS/JS, site fonts, and `/favicon.svg`. `STATIC_TYPES` had no `.ico` / `.png`. |
| Where the SVG comes from | `auth/Dockerfile` | `COPY public/favicon.svg ./shared/favicon.svg` — copied from the main site's `public/`; locally read via `SHARED_PUBLIC_DIR` (default: repo `public/`). |
| Open Graph / Twitter meta | `auth/src/views.mjs` | None. Pages are `noindex`. |
| Logo in the interface | `auth/src/views.mjs` | Header logo is CSS text (`<span class="logo-mark">E</span>ENDEMION ID`), not an image. Not touched. |
| CSP | `auth/src/app.mjs`, `securityHeaders()` | `img-src 'self' …` already allows icons from the same origin. Not changed. |
| `theme-color` | `#07061a` | Not changed. |

### Where `favicon.svg` is still used (checked before deciding not to delete it)

- `auth/src/app.mjs` and `auth/Dockerfile` — the service can still serve it (kept for old bookmarks / cached pages).
- `public/sw.js` — main-site service worker caches `/favicon.svg` if requested.
- `public/_headers` — cache rule.
- `scripts/generate-brand-assets.mjs` — generator script.

No page `<head>` on either service links it any more. The file was **not deleted**.

---

## 2. Changes

| File | Change |
|---|---|
| `auth/src/views.mjs` | Replaced the SVG link with `favicon.ico?v=2` (32×32), PNG 32×32 and PNG 16×16 — the same set as the main site. |
| `auth/src/app.mjs` | Added `.ico` / `.png` to `STATIC_TYPES`. Replaced the single `/favicon.svg` check with an explicit allow-list `SHARED_ICONS` (`/favicon.svg`, `/favicon.ico`, `/icons/favicon-16x16.png`, `/icons/favicon-32x32.png`). Only these exact paths are served; no pattern matching on user input. |
| `auth/Dockerfile` | Copies `favicon.ico` and the two PNG favicons from `public/` into `shared/` next to the existing `favicon.svg`. |
| `auth/tests/oidc.test.mjs` | New test: every icon returns 200 with the right `Content-Type` and non-empty body; files outside the allow-list (`/icons/icon-512.png`, `/icons/../manifest.webmanifest`) return 404; a rendered page links ICO + PNG and does not mention `favicon.svg`. |

No icon files were added to `auth/` — they are taken from the main site's `public/`, as the service already did for the SVG and fonts.

### Not touched

Authentication, OIDC provider configuration, social login, sessions, API routes, CSP and other security headers, cookies, CSS and page layout.

### Apple Touch Icon — deliberately not added

An `apple-touch-icon` link was added at first and then removed. The existing tests `кнопки входа…` and `привязка и отвязка провайдера…` (`auth/tests/social.test.mjs`) assert that pages do not match `/apple|twitter/i`, to guarantee there is no "Sign in with Apple" button. The word `apple-touch-icon` broke both tests. Instead of loosening a test that guards the list of login providers, the link was left out. Endemion ID pages are `noindex` login pages that are rarely added to a home screen, so the loss is small. If it is wanted, the test regex can be narrowed (for example to `/Войти через Apple|twitter/i`) and the link added back.

---

## 3. Verification

| Check | Result |
|---|---|
| `npm test` in `auth/` | 36/36 pass (35 existing + 1 new). |
| `npm run check` (main repo, includes typecheck of `auth/src`) | lint and typecheck clean, 67/67 tests. |
| Headless Chromium against a test instance (`startAuth()`), shared folder laid out exactly as the Dockerfile `COPY` lines | `/forgot-password`, `/login`: HTTP 200, 0 console errors, 0 failed requests; head contains ICO + PNG 32 + PNG 16. |
| Links to old icons in `<head>` | None. |
| Docker image build | **Not run** — the Docker daemon was not running on this machine. The new `COPY` lines are untested in a real build. |

---

## 4. Remaining tasks

| Task | Notes |
|---|---|
| `docker compose build auth` | Verify the image builds and contains `/app/shared/favicon.ico` and `/app/shared/icons/favicon-{16x16,32x32}.png`. |
| Deploy | Both `app` and `auth` must be rebuilt. Only with owner approval; take the backup first (`docs/ENDEMION_DEPLOYMENT.md` §8). |
| Apple Touch Icon (optional) | See section 2. |
| Real-browser check | Tab icon on auth.endemion.online after deploy (with cache cleared, or the `?v=2` URLs will force it). |
