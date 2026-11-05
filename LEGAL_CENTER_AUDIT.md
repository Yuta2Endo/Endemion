# LEGAL CENTER — STAGE 01 AUDIT

Date: 2026-11-05. Branch `feature/legal-center` (worktree `G:/III/Project/Endemion-legal`), based on `origin/main` `4e35ed2`.
This audit is read-only: nothing on the site, in the games or in production was changed while preparing it.

## 1. Website

### 1.1 Framework and architecture

- The code is written as a Cloudflare Worker (`src/worker.js`) with page and API handlers in `functions/`. Production runs the same code on Node.js in Docker (`server/index.mjs`), behind Caddy, on the shared server at `/opt/endemion`.
- There is no build step. HTML is rendered on the server by functions that return strings, and static files are served from `public/`.
- Database: SQLite (D1-compatible), migrations in `migrations/`.

### 1.2 Routing

- Routes are listed explicitly in `ROUTE_LIST` in `src/worker.js` (`["/path/:param", module]`). A request that matches no route falls through to static files, then to `public/404.html`.
- Matching splits the path into segments, so a trailing slash makes no difference: `/legal/tetrus/` and `/legal/tetrus` match the same route.
- `/legal` and everything under it returns 404 today, both locally and in production (checked with `curl`). The new routes conflict with nothing.
- Retired sections (`RETIRED` set) redirect to `/`. `legal` is not among them.

### 1.3 Design system

- `public/assets/base.css`: colour tokens (`--bg #080a10`, `--surface`, `--primary #8b5cf6`, `--highlight #22d3ee`, `--muted`), the Manrope and Unbounded fonts, header, footer, buttons (`.ghost-btn`, `.small-btn`), `.eyebrow`.
- `public/assets/ui.css`: `.page`, `.page-head`, `.panel`, `.chip`, `.tabs-bar`.
- `public/assets/studio.css`: `.display-2`, `.lead`, `.card`, `.btn-row`, used by the portal pages.
- `public/assets/account.css`: `.doc` and `.doc-updated` for long documents (used by `public/privacy.html`).
- The CSP forbids inline scripts and styles (`functions/_lib/html.js`), so all new styles go into a separate CSS file.

### 1.4 Existing legal pages

| Address | Source | State |
|---|---|---|
| `/privacy` | `public/privacy.html` (static) | Draft with placeholders: operator name and address, security-log retention period. Covers the site and Endemion ID, mentions Endemion Life as a user of Endemion ID |
| `/terms` | `termsPage` in `functions/studio.js` | Short terms for the site, forum and Endemion ID |
| `/copyright` | `public/copyright.html` | Form for rights holders |

These pages are site-wide. The Legal Center does not replace them: it adds per-game documents and links to the site-wide ones.

### 1.5 Navigation and footer

- `siteFooter()` in `functions/_lib/layout.js` renders the footer for every server-rendered page. It has a "Документы" column with `/privacy`, `/terms`, `/copyright` and "Настройки cookie".
- Static pages (`privacy.html`, `copyright.html`, `auth.html`, `404.html`) have their own markup and no shared footer.

### 1.6 Localization

- **There is no localization system.** Every page is Russian: `<html lang="ru">` and `og:locale ru_RU` are hard-coded in `renderPage()`, and all interface text is Russian.
- The Legal Center therefore needs its own language switch. It will be done through the URL (`?lang=en`), not cookies or scripts, so that each language version is a separate indexable page with correct `lang` and `hreflang`.

### 1.7 SEO and robots

- `functions/robots.txt.js` allows everything except the account and API pages.
- `functions/sitemap.xml.js` lists the portal pages, including `terms`, `privacy` and `copyright`.
- `renderPage()` supports `title`, `description`, `canonical` (`path`) and `noindex`.

### 1.8 Deployment and checks

- No CI. The local check is `npm run check` (ESLint, TypeScript checkJs, `node --test`).
- Baseline in this worktree before any change: lint and typecheck pass, **`npm test` 70/70**.
- Production deploy (docs/ENDEMION_DEPLOYMENT.md §8): backup → `git pull --ff-only` → `docker compose build app` → `docker compose up -d --no-deps app` → `/healthz`. Only the `app` container is affected by this work. Merge and deploy need the owner's approval.

### 1.9 Working copy note

The main checkout `G:/III/Project/Endemion` is on the owner's branch `audit-retention` with uncommitted files, so this work is done in a separate worktree and does not touch it.

## 2. Games

All four games have source code on disk. Each one was audited for permissions, SDKs, network code, accounts, stored data, purchases, user content and deletion. File references are in sections 2.1–2.4.

### 2.1 TETRUS

- Source: `G:/III/TETRUS`. Godot 4.7.2, Android only.
- Package `endemion.tetrus`, version 1.0.0 (code 1). Built debug APK: minSdk 24, targetSdk 35.
- Permissions: **VIBRATE only** (`export_presets.cfg:64`; the APK manifest has no other `uses-permission`). `permissions/internet=false`.
- Third-party SDKs (ads, analytics, crash reporting, Firebase, Play Games, billing): **none** (no `addons/`, Gradle build off, nothing in the APK).
- Network code: **none**. Accounts: **none**.
- Local data (`user://tetrus_save.json` + `.tmp`, `.bak`, `.corrupt`): settings, per-mode statistics, top-10 records with dates, XP, level, achievements with dates, daily quests, daily play streak. No names or device identifiers.
- The in-game "Login streak" is a local count of days played, not a login.
- Purchases, currency, ads: **none**. Rewards are cosmetic unlocks.
- User text input: **none**.
- Android Auto Backup off (`user_data_backup/allow=false`, `allowBackup=false`); data is removed on uninstall.
- In-app data deletion: **none** (only "RESET CONTROLS"). Uninstall or "Clear data" removes everything.
- Legal text in the game: none.

### 2.2 Little Weather

- Source: `G:/III/LITTLE WEATHER/little-weather`. Godot 4.7, Android only. Google Play is the intended store; release APK/AAB not built yet.
- Package `endemion.littleweather`, version 0.1.0 (code 1). Built debug APK: minSdk 24, targetSdk 36.
- **It is a weather-simulation puzzle, not a forecast app.** It does not use location or any weather service; weather is a game mechanic.
- Permissions: **VIBRATE only**. No INTERNET, no location, no notifications.
- Third-party SDKs: **none**. Bundled: Godot engine, AndroidX/Kotlin runtime from the Godot template, Nunito font (SIL OFL).
- `androidx.core.location` classes exist in the APK as part of androidx.core; no game code uses them and no location permission is requested.
- Network code, accounts, user text input: **none**.
- Local data (`user://little_weather_save.json` + `.tmp`, `.bak`, `.corrupt`): progress, settings, Unix timestamps of the last save, achievements and rewards. No personal data.
- Virtual currency "Energy": earned only by playing, spent in the in-game shop, **cannot be bought with money**. Ads: none.
- Auto Backup off; data removed on uninstall.
- Settings → "Reset progress" restores default progress **but keeps settings, and the previous progress stays in the `.bak` file until the next save**. The policy must not say that reset erases all data.
- Legal text in the game: none.

### 2.3 Liforae

- Source: `G:/II/Liforae`. Godot 4.7.2, Android only.
- Package `com.liforae.game`, version 0.3.0 (code 3). Built APK: minSdk 24, targetSdk 36. The current APK is a debug build; no release keystore is set up.
- Permissions: **none** (internet and vibrate off, custom list empty; the APK manifest has no `uses-permission`).
- Third-party SDKs, network code, accounts, purchases, ads: **none**.
- Local data:
  - `user://settings.cfg`: language, autosave, text size, animations. The default language is taken from the device locale; only the chosen code is stored.
  - `user://saves/slot_0..3.json` + `.bak`, `.tmp`: the simulated life. Includes **the first and last name the player types** (up to 20 characters each), the character's gender and romance preference, the in-game birth date, family, career, fictional money, and the device's local time of saving.
- The in-game euros are fictional and cannot be bought with real money.
- Auto Backup off; data removed on uninstall.
- Deletion: slots 1–3 can be deleted in the game with confirmation (not the slot currently in play). The internal autosave slot 0 has no in-app delete. Full removal: uninstall or "Clear data".
- Content that matters for the age rating: tobacco (including a teen choice), a simulated lottery with fictional money, death and grief, illness, romance (including a teen crush), divorce, mild fights and bullying, scams, debt, cheating. Not found: alcohol, drugs, sexual content, weapons, suicide.
- Legal text in the game: none.

### 2.4 ENDEMION LIFE

- Source: `G:/III/endemion-life` (Next.js + NestJS + Prisma/PostgreSQL). Web game at https://life.endemion.online, not an Android app.
- Sign-in:
  - Guest: the first visit creates an anonymous player and session automatically.
  - Endemion ID (OIDC, `auth.endemion.online`): **enabled in production** (public `GET /api/auth/config` returns `"enabled": true`). When it is on, the old email/password endpoints return 410.
  - The old email/password code still exists; the old `Account` table may hold earlier accounts.
- Data in the database: Endemion ID subject, username, display name, avatar URL and email copied from Endemion ID; per-device sessions (token hash, User-Agent up to 256 characters, timestamps, encrypted Endemion ID refresh token); character lives (character name up to 40 characters, optional seed text, game state, history and actions). **IP addresses are not stored in the database.**
- Cookies: `el_session` (session, HttpOnly, **365 days**), `el_oidc` (sign-in, 10 minutes), `el_locale` (language, 1 year). localStorage `endemion-life:v1:*` holds game saves when the server is unreachable.
- Logs: the API and Nginx log one line per request with **IP address**, path (no query string), status and timings; Nginx also logs the **full User-Agent**. Docker keeps at most 5 × 10 MB per service: the limit is size, not time. Redis keeps the IP and a hash of the email for rate limiting for about a minute.
- Backups: daily database dump, daily copies older than 14 days are deleted (the newest 7 always kept); manual copies are kept until deleted by hand. Offsite copies go to VK Cloud Object Storage (bucket `endemio`); **no lifecycle rule exists, so no retention limit applies to them**.
- Third parties: no analytics, ads or tracking scripts. Sentry is wired up with personal data removed, but its DSN is empty in production. Fonts are served from the site's own domain. Email (SMTP) is not configured in production, so no email is sent.
- Multiplayer, chat, profiles visible to others, leaderboards: **none**. The "market" is single-player and server-priced.
- In-game gold and goods: no real-money purchases, payments or donations.
- User-generated content: only the character name and seed, not shown to others. No moderation.
- **Account deletion and data export: none.** Users can revoke sessions and log out; the Endemion ID profile is edited at `auth.endemion.online/account`. No automatic cleanup of old guests, expired sessions or used tokens.
- Age gate: none.
- Legal pages in the game: none. The footer shows only "Endemion Life · Stage 01 · {year}".
- Hosting: the same server as the main site. The site-wide `/privacy` states the server is in Russia (Novosibirsk) and backups are in VK Cloud in Russia; the Life repo does not name a provider or country.

## 3. Information that must come from the owner

None of this can be derived from code. The documents will show clearly marked placeholders for each item.

1. Legal identity of the developer or operator: full name or company name, status (individual, self-employed, company), registration details if any.
2. Contact email for privacy and legal requests. The repository has only `noreply@endemion.online`.
3. Postal address for requests, if one is to be published.
4. Governing law and jurisdiction, and the dispute resolution procedure.
5. Minimum age or target audience for each game (needed for Google Play's target audience and Families policy).
6. Refund wording: no game has purchases today, so the documents say so and point to Google Play's own refund rules; anything beyond that needs the owner.
7. Retention periods the code does not limit: ENDEMION LIFE server logs (size-limited only), offsite backups, manual backups, inactive guest players.
8. How ENDEMION LIFE account deletion works until there is a button in the game (deletion on request by email, as the site-wide policy already says for Endemion ID).
9. Whether the old ENDEMION LIFE email/password accounts still exist and what happens to them.
10. Effective date of each document.

## 4. Privacy risks found

1. **ENDEMION LIFE has no self-service account deletion or data export.** GDPR and 152-FZ give users these rights; the policy can only offer requests by email until the feature exists.
2. **ENDEMION LIFE logs and offsite backups have no time-based retention.** The policy cannot state a period until one is configured.
3. **ENDEMION LIFE session cookie lives 365 days**, and old guest players and expired sessions are never cleaned up.
4. **Little Weather "Reset progress" does not erase all data**: settings stay and the old progress remains in `.bak` until the next save.
5. **Liforae autosave slot 0 cannot be deleted in the game**; only uninstall or "Clear data" removes it.
6. **TETRUS has no in-app reset**; deletion is only through uninstall or "Clear data".
7. **All three Android games were checked on debug builds only.** A release build (especially Little Weather's planned Gradle/AAB build) must be re-checked before publication so that the Google Play Data Safety form and the policy still match.
8. **Liforae content** (tobacco including a teen choice, simulated lottery) affects the IARC rating and whether the game can target children.
9. **The operator is not identified anywhere**: the site-wide `/privacy` also has an empty operator placeholder. Google Play requires a privacy policy that names the developer and gives a contact.

## 5. Implementation plan

1. Content as data: one module per game in `functions/_lib/legal/` with Russian and English text for both documents, built only from the facts in section 2. Placeholders are rendered as visible marked blocks.
2. Pages in `functions/legal.js`, registered in `src/worker.js`:
   - `/legal` — Legal Center index;
   - `/legal/:game` — redirects to the game's privacy policy;
   - `/legal/:game/privacy-policy`, `/legal/:game/terms-of-service`.
   Unknown game or document returns the site's 404. Language: Russian by default, English with `?lang=en`; `hreflang` alternates and canonical for each.
3. Styles in a new `public/assets/legal.css` using the existing tokens; no change to existing CSS.
4. Footer: add "Legal Center" to the existing "Документы" column; nothing else in the footer changes.
5. Sitemap: add the new pages. robots.txt: no change needed (everything is already allowed).
6. Tests in `tests/legal.test.mjs`, added to `npm test`.
7. Reports: `LEGAL_CENTER_IMPLEMENTATION_REPORT.md`, `GOOGLE_PLAY_LEGAL_SETUP.md`.
8. Android OS Developer Simulator (`os-developer-simulator`) is excluded, as requested.
