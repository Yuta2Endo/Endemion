# STAGE 10 AUDIT REPORT — Endemion Account Dashboard

## 1. Existing Architecture

**Repository**: Endemion portal site (endemion.online), shared Endemion ID account with Endemion Life (life.endemion.online).

**Runtime**: Cloudflare Workers (`src/worker.js`) or own Node.js server (`server/`). Same code, D1 or SQLite. ES modules, no build step; `public/` served as static assets.

**Routing**: `src/worker.js` matches URL patterns to Pages Functions handlers in `functions/`. Static files fall through to `env.ASSETS.fetch(request)`.

**Frontend**: `public/assets/` — `base.css` (design tokens, dark theme), `ui.css` (components), `app.js` (API helper `api()`, `getMe()`, `initHeader()`, `toast()`, `avatar()`, `stateBox()`, etc.), per-page scripts (`profile.js`, etc.).

**Authentication**: Endemion ID (OpenID Connect, `auth.endemion.online`) when `ENDEMION_ID=1`; otherwise traditional PBKDF2-SHA256 passwords. Session cookie `endemion_session` (HttpOnly, Secure, SameSite=Lax, 30 days). Token stored as SHA-256 in `sessions` table.

**Database** (`migrations/`): `users`, `sessions`, `user_profiles`, `achievements`, `user_achievements`, `games`, `threads`, `comments`, `follows`, `forum_categories`, `site_settings`, etc. No Endemion Life save/character/life tables in this DB — those live in the separate game at life.endemion.online.

**Localization**: `functions/_lib/i18n.js`, `ru`/`en`, cookie `lang` + Accept-Language fallback. Dictionary covers shell strings; section text translated per page.

**Reusable frontend components** (`app.js`): `api()`, `getMe()`, `initHeader()`, `toast()`, `el()`, `link()`, `button()`, `avatar()`, `userLink()`, `stateBox()`, `errorBox()`, `openDialog()`, `field()`, `input()`, `textarea()`, `checkbox()`, `formatDate()`, `timeAgo()`, `loginUrl()`.

**Existing API** relevant to account:
- `GET /api/me` — user + community stats + unread count
- `PATCH /api/me` — display name (not for Endemion ID accounts)
- `DELETE /api/me` — account deletion
- `GET/PATCH /api/me/profile` — profile settings, bio, avatar color, privacy, notifications
- `PUT/DELETE /api/me/avatar` — avatar upload
- `GET /api/me/achievements` — achievements with earned state
- `POST /api/me/password` — password change
- `GET /api/users/:username` — public profile, stats, achievements
- `GET /api/users/:username/library` — favorite games
- `GET /api/users/:username/forum` — forum activity

**Existing `/profile` page**: Already has overview, achievements, settings, privacy, password, delete account, Endemion ID info panel, link to Endemion Life.

## 2. Current Account Functionality

There is **no `/account` route**. The closest existing page is `/profile` (site.js `profile` handler), which covers:
- Profile overview (avatar, name, handle, email, bio, since date)
- Achievements tab
- Settings tab (name, username, bio, avatar color, avatar upload/remove, privacy, password, delete)
- Endemion ID panel (link to Endemion ID account + Endemion Life game link)

`/account` must be created from scratch.

## 3. Reusable Components

| Component | Location | Notes |
|---|---|---|
| `api()` request helper | `public/assets/app.js:4` | `{ok, status, data}`, no throw on network error |
| `getMe()` | `public/assets/app.js:200` | Cached `/api/me` call |
| `initHeader()` | `public/assets/app.js:252` | Header, auth state, menu, notifications |
| `toast()` | `public/assets/app.js:218` | Bottom toast notification |
| `avatar()` | `public/assets/app.js:368` | Image or letter fallback |
| `stateBox()` / `errorBox()` | `public/assets/app.js:402` | Empty/error states |
| `openDialog()` | `public/assets/app.js:442` | Modal dialog |
| `field()` / `input()` / `textarea()` / `checkbox()` | `public/assets/app.js:487` | Form controls |
| `skeleton` CSS | `base.css:588` | Shimmer loading skeletons |
| `state` CSS | `base.css:606` | Empty/state box |
| `toast` CSS | `base.css:757` | Toast notification |

## 4. Available Data

From `/api/me` (authenticated):
- `user.id`, `name`, `email`, `createdAt`, `role`, `username`, `avatar`, `avatarColor`, `viaEndemionId`, `authTime`
- `stats.topics`, `stats.posts`, `stats.followers`, `stats.following`, `stats.achievements`
- `unread` count

From `/api/me/profile`:
- `profile.bio`, `avatarColor`, `isPublic`, `showActivity`
- `settings.notify.replies/follows/achievements`

From `/api/me/achievements`:
- `achievements[]` with `code`, `name`, `description`, `icon`, `earnedAt`

**NOT available in this portal DB** (Endemion Life game data, lives at life.endemion.online):
- Total lives, characters, story events, playtime, last played date
- Character names, worlds, status, save status
- Family members, generational history, legacy records
- Cloud save synchronization status

## 5. Missing Functionality

- `/account` route and page do not exist
- No API endpoint to list active sessions or terminate individual sessions (`/api/me/sessions` missing)
- No Endemion Life save/character data in portal DB
- No family/legacy system in portal DB
- Account page has no dedicated premium dashboard layout

## 6. Security Considerations

- Session cookie `HttpOnly; Secure; SameSite=Lax` — never exposed to JS
- `currentUser()` verifies token hash against DB; Endemion ID sessions re-verified with provider
- `/api/*` CSRF: Origin header checked (`functions/api/_middleware.js`)
- `requireUser()` / `requireRole()` enforce auth server-side
- `viaEndemionId` users: name, username, avatar, email, password changed in Endemion ID only (409 on portal)
- Protected identity fields (`id`, `email`, `role`, `endemion_sub`) never exposed for modification via portal
- Must never trust client-supplied user IDs; ownership verified via session

## 7. Implementation Plan

1. Add `/account` route to `src/worker.js` + `functions/site.js` handler (server shell with skeletons)
2. Create `GET/DELETE /api/me/sessions` endpoint (list + terminate own sessions)
3. Add account strings to `functions/_lib/i18n.js` (ru/en)
4. Create `public/assets/account.js` (frontend: overview, stats, achievements, settings, security, nav)
5. Create `public/assets/account-dashboard.css` (premium dark styles, reuses base tokens)
6. Link to Endemion Life game for game-specific data (characters, saves, family)
7. Run lint, typecheck, tests

## 8. Potential Regression Risks

- Adding `/account` route must not conflict with existing routes (checked: no `/account` exists)
- New `/api/me/sessions` endpoint must verify session ownership server-side
- CSS additions must not break existing pages (scoped to `.account-dashboard`)
- i18n additions must not break existing keys (additive only)
- No database migrations needed (read-only use of existing tables + sessions table already exists)
- Existing `/profile`, login, logout, game worlds, saves unaffected
