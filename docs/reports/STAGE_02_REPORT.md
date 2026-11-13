# STAGE 02 — DESIGN SYSTEM

Branch `studio-redesign`. Not committed yet.

## What changed

- **Palette** (`public/assets/base.css`, `:root`). The colors from the spec are added as tokens `--surface` #11141D, `--surface-elevated` #181D29, `--primary` #8B5CF6, `--secondary` #6366F1, `--highlight` #22D3EE (the Accent from the spec; this name avoids a clash with the old `--cyan`). Background #080A10, Text #F8FAFC, Muted #94A3B8. The old variable names (`--accent`, `--blue`, `--panel`, `--cyan` and others) remain and now point at the new palette, so the encyclopedia, admin and reader pages are recolored without editing their styles.
- **Neon toned down.** The body background gradients are weaker, the pink glow is replaced with a faint cyan one, and the pink gradients in the logo and the active menu item's underline are replaced with violet→blue.
- **Hard-coded old colors** in `base.css`, `ui.css` and `ency.css` (`rgba(7,6,26,…)`, `rgba(5,4,20,…)`, `#241d5c`, `182,156,255` and others) are replaced with the new ones. `theme-color` in the page shell and `manifest.webmanifest` is #080A10.
- **Navigation** (`functions/_lib/layout.js`): Home, Games, Community, Development, About. The encyclopedia is removed from the menu, as the owner decided. Its routes still work.
- **Encyclopedia search** in the header and the Shikimori credit in the footer appear only on encyclopedia pages (`isEncyclopedia(active)`).
- **Footer**: logo, slogan "Create. Play. Connect.", columns Sections / Projects / Documents, a social links block (hidden until the admin sets links in Site Settings, STAGE 08), copyright, links to Privacy Policy and Terms of Use (`/terms` arrives in STAGE 03). Four columns on desktop, two on tablet, one on phone.
- **Encyclopedia home** moved to `/encyclopedia` (key `encyclopedia`, its own canonical and og:url). Until STAGE 03, `/` temporarily shows it too.
- **Portal components** in the new file `public/assets/studio.css`: typography `display-1/2`, `lead`; grids `grid-games`, `grid-posts`, `split-2`; `studio-hero`; status badges `status-in_development | prototype | released | planned | unknown`; `card` cards with a clickable title; `featured` block; lists of forum threads and posts `list-panel / list-row`; `placeholder-art` placeholders labeled as placeholders; `empty-card` empty states; `rise` appear animation (disabled under `prefers-reduced-motion`).
- `ASSET_VERSION` updated so browsers fetch the new styles.

## Verification

- `npm run lint`, `npm run typecheck`: no errors.
- `npm test`: 99/99.
- Playwright on a temporary database, 1440×900 and 390×844, pages `/community` and `/encyclopedia`: no horizontal scroll, no console errors, menu shows the five items, mobile menu opens and closes on Escape, encyclopedia search and the Shikimori credit appear only on encyclopedia pages. Screenshots in `G:\III\ux-shots\s02-*`.

## Open items

- The menu links `/games`, `/studio`, `/about` and the footer link `/terms` don't open yet; they arrive in STAGE 03–06.
- Social links in the footer appear after STAGE 08 (Site Settings).
