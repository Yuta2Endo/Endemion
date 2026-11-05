# LEGAL CENTER — IMPLEMENTATION REPORT

Date: 2026-11-05. Branch `feature/legal-center` (worktree `G:/III/Project/Endemion-legal`), based on `origin/main` `4e35ed2`. **Not committed, not merged, not deployed.**

The audit that came before this work is in `LEGAL_CENTER_AUDIT.md`. The Google Play guide is in `GOOGLE_PLAY_LEGAL_SETUP.md`.

## 1. Summary

The site now has a Legal Center at `/legal` with a Privacy Policy and Terms of Service for TETRUS, Little Weather, Liforae and ENDEMION LIFE, in Russian and English. Android OS Developer Simulator is not included.

Every statement about data was checked against each game's source code (see the audit, §2). Facts the code cannot provide (legal name, contact email, age, law, retention periods and so on) are shown as highlighted placeholders. Any page that still has a placeholder shows a "Draft" banner.

The documents are generated on the server from text modules, the same way as the other portal pages, and use the existing design tokens. No existing page, style or behaviour changed apart from three things: one new footer link, an optional `lang` parameter in `renderPage`, and new entries in the sitemap.

## 2. Files created

| File | Purpose |
|---|---|
| `functions/legal.js` | Pages: Legal Center index, game redirect, document page; language switch; 404 |
| `functions/_lib/legal/index.js` | List of games, `LEGAL_UPDATED` date |
| `functions/_lib/legal/common.js` | Placeholders, shared sections, privacy and terms templates for offline Android games |
| `functions/_lib/legal/tetrus.js` | TETRUS facts (RU/EN) |
| `functions/_lib/legal/little-weather.js` | Little Weather facts (RU/EN) |
| `functions/_lib/legal/liforae.js` | Liforae facts (RU/EN) |
| `functions/_lib/legal/endemion-life.js` | ENDEMION LIFE privacy policy and terms (RU/EN), written separately because it is an online service |
| `public/assets/legal.css` | Styles: cards, table of contents, document, language switch, placeholders |
| `tests/legal.test.mjs` | 10 tests |
| `LEGAL_CENTER_AUDIT.md`, `LEGAL_CENTER_IMPLEMENTATION_REPORT.md`, `GOOGLE_PLAY_LEGAL_SETUP.md` | Reports |

The documents live in code rather than in separate Markdown files because the site renders pages from JS modules and has no Markdown pipeline. One module per game keeps the RU and EN texts side by side, so they are easy to keep in sync.

## 3. Files modified

| File | Change |
|---|---|
| `src/worker.js` | Import of `functions/legal.js` and 3 routes (5 lines added; CRLF line endings kept) |
| `functions/_lib/layout.js` | `renderPage` takes `lang` (default `"ru"`, so existing pages are unchanged) and sets `<html lang>` and `og:locale` from it; footer "Документы" column gets a "Правовой центр" link |
| `functions/sitemap.xml.js` | Adds the 18 Legal Center URLs |
| `package.json` | `tests/legal.test.mjs` added to `npm test` |

`robots.txt` needed no change: `/legal` was already allowed.

## 4. Routes

| Route | Response |
|---|---|
| `/legal` | Legal Center index: one card per game with links to both documents, plus links to the site-wide `/privacy` and `/terms` |
| `/legal/{game}` | 302 to `/legal/{game}/privacy-policy` (keeps `?lang=en`) |
| `/legal/{game}/privacy-policy` | Privacy Policy |
| `/legal/{game}/terms-of-service` | Terms of Service |
| Unknown game or document | 404 with `noindex` |

`{game}` is `tetrus`, `little-weather`, `liforae` or `endemion-life`. The language is Russian by default and English with `?lang=en`; any other value falls back to Russian. A trailing slash opens the same page, so the slash forms from the task also work.

Each document page has the game name, the document type, the last-updated date, tabs to switch between the two documents, breadcrumbs back to the Legal Center, a RU/EN switch, and a table of contents. The table of contents sits beside the text on desktop and above it on screens narrower than 860px.

SEO and accessibility: one `h1` per page and `h2` per section; `<html lang>` set to `ru` or `en`; a self-referencing canonical; `hreflang` `ru`/`en`/`x-default`; title and meta description per document; `nav` elements with `aria-label`; `aria-current` on the active tab and language; the site's existing skip link and focus ring; no inline scripts or styles, so the strict CSP still holds.

## 5. Build and test results

There is no build step. The check is `npm run check`.

| Check | Before | After |
|---|---|---|
| `npm run lint` (ESLint) | pass | pass |
| `npm run typecheck` (TypeScript checkJs) | pass | pass |
| `npm test` | 70/70 | **80/80** (10 new) |

The new tests (`tests/legal.test.mjs`) cover:

- exactly four games, with no OS Developer Simulator;
- all 16 document pages: status 200, `lang`, canonical, `hreflang`, no `noindex`, one `h1`, updated date;
- every required section is present in every document, and the table of contents matches the section anchors;
- tabs, language switch and breadcrumbs;
- the index links to all 8 documents and to the site documents;
- 404 for unknown game or document (including `__proto__` and `constructor`), the redirect, the trailing slash, and the `lang` fallback;
- placeholders are rendered and marked, the Draft banner shows, and no raw `[[`/`{{` markup is left;
- security headers, and no inline scripts or styles;
- the footer link exists and `/privacy` and `/terms` still work;
- the sitemap has all 18 URLs and robots.txt does not block `/legal`.

### Browser check

I ran Playwright Chromium against a local server (`node server/index.mjs` on a temporary data folder). The script is outside the repo: `G:/III/legal-center-check/check.mjs`. I looked at the screenshots in `G:/III/legal-center-check/shots/`.

- All 18 pages at widths 390, 768 and 1440: 54 loads, every one returned 200. There was no horizontal scroll, no console errors, no text under 14px, and `lang` was correct. The table of contents is sticky on desktop and static on mobile.
- All 20 internal links found on the legal pages resolve (no 4xx).
- Keyboard: the first Tab focuses the skip link. Breadcrumbs, the language switch, the tabs and the table of contents are all reachable with Tab, and the focused link shows the focus ring. Enter on a table-of-contents link jumps to the section, and the sticky header does not cover it.
- The RU/EN switch keeps the current document, and the footer link opens `/legal`.

The first browser run reported two problems, but both came from my test script: smooth scrolling had not finished, and the script set focus programmatically instead of with Tab. With reduced motion and a real Tab, both checks pass.

Not checked: Firefox, WebKit and real phones. The project's own e2e suite (`npm run test:e2e`) was not run because it needs `wrangler dev` and installed browsers. Production was not touched.

### Unsupported claims review

I re-read every text against the audit. Three statements went beyond what the code or audit supports, and I changed them:

- "we will notify you and the authorities of a breach" is now a placeholder for the owner's breach-notification procedure;
- "passwords and tokens are removed from logs" is narrowed to "the session token is removed from logs" (the logger does redact these fields, but the narrower wording is safer);
- the legal entity name "VK LLC" for VK Cloud is removed, because it came from the site policy and not from the code.

Every place that would need a business or legal decision is a placeholder. No document claims to guarantee legal compliance; the Draft banner says the document is not legal advice.

Still based on the repo only: the claim that error reporting (Sentry) is off in ENDEMION LIFE production rests on the empty `SENTRY_DSN` in the production env example and the deployment docs. I did not read the live server's `.env`.

## 6. Missing legal information

These are shown as placeholders on the pages:

1. Developer or operator legal name (all documents).
2. Contact email for privacy requests (all documents).
3. Postal address, if published.
4. Minimum age and Google Play target age group.
5. Governing law and courts or dispute procedure.
6. Developer refund terms (all games currently have no purchases).
7. Email retention period and email provider (offline games).
8. ENDEMION LIFE: server log retention, VK Cloud backup retention, inactive guest retention, breach-notification procedure, international transfer mechanism.

## 7. Privacy risks (from the audit)

1. **ENDEMION LIFE has no account deletion or data export.** The policy offers deletion by email. A self-service option is needed for GDPR and 152-FZ.
2. **ENDEMION LIFE logs and offsite backups have no time limit.** The policy cannot give a period until one is configured.
3. **ENDEMION LIFE sessions last 365 days**, and old guests and expired sessions are never cleaned up.
4. **ENDEMION LIFE has no link to its own policy.** The game footer links to nothing.
5. **Little Weather "Reset progress"** keeps settings, and the old progress stays in `.bak` until the next save. The policy says this.
6. **Liforae's autosave and TETRUS's progress can't be deleted in the game.** The policy points to uninstall or Clear storage.
7. **All three Android games were audited on debug builds.** Re-check the release builds before filling in the Data Safety form.
8. **No game links to its policy in-app.** Play does not require it, but it is good practice.
9. **The site-wide `/privacy` also has an empty operator field.** It is the same gap as the new documents.

## 8. Google Play checklist

The full guide is in `GOOGLE_PLAY_LEGAL_SETUP.md` §6. In short, for each Android game:

1. Fill in the placeholders.
2. Deploy.
3. Check that the URLs return 200.
4. Re-check the release manifest.
5. Enter the Privacy policy URL.
6. Fill in Data Safety ("no data collected").
7. Declare no ads.
8. Set the target audience to match the age in the documents.
9. Complete the IARC questionnaire.

## 9. Recommended next steps

1. The owner fills in the placeholders, at least the developer name, contact email and minimum age.
2. Review the commit and merge; then deploy only the `app` container as in `docs/ENDEMION_DEPLOYMENT.md` §8 (backup first). No database migration is needed.
3. After deploy, run the URL check in `GOOGLE_PLAY_LEGAL_SETUP.md` §3 on production.
4. ENDEMION LIFE: add an account deletion path, set retention for logs and offsite backups, and link the Legal Center from the game footer.
5. Optionally add a "Privacy" link in each Android game's settings.
6. Optionally translate the shared header and footer, which are still Russian on the English pages because the site has no translation system.
