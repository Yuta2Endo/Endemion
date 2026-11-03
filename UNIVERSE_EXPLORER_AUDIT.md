# Universe Explorer — Project Audit

**Date**: 2026-11-04  
**Project**: Endemion — Anime & Manga Encyclopedia  
**URL**: https://endemion.online

## Executive Summary

Endemion is a production anime and manga encyclopedia with:
- **Encyclopedia**: catalog, entries, characters, people, studios, seasons, rankings
- **User features**: lists, ratings, favorites, reviews, comments
- **Community**: reviews, comments, reactions
- **Platform**: Pulse, Arena (legacy reading platform removed)
- **Auth**: Endemion ID (OpenID Connect SSO at auth.endemion.online)

Universe Explorer will be integrated as a **premium interactive exploration layer** on top of existing entry pages.

---

## 1. Technology Stack

### Backend
- **Runtime**: Cloudflare Workers (production) + Node.js (local/server)
- **Language**: JavaScript (ES modules)
- **Database**: D1 (SQLite) via Cloudflare Workers binding or `better-sqlite3` locally
- **Server**: Custom Node.js server in `server/` for self-hosting
- **Functions**: Cloudflare Pages Functions format (`functions/`)
- **Auth**: OpenID Connect via `openid-client` (separate auth service)

### Frontend
- **No framework**: Vanilla JavaScript ES modules
- **Module system**: Native ES6 imports in browser
- **Bundling**: None (direct file serving)
- **CSS**: Single-file system (`public/assets/base.css`, `ency.css`, `ui.css`)
- **Fonts**: Self-hosted Manrope (body) + Unbounded (display)

### Data Sources
- **Catalog**: Shikimori API (shikimori.io)
  - GraphQL for lists
  - REST for characters, people, studios
  - Cached in `catalog_cache` table
  - Layer: `functions/_lib/catalog/`
- **User data**: Own database (lists, reviews, favorites)

### Infrastructure
- **Production**: Own server with Docker Compose
- **Services**: `app` (Endemion), `auth` (Endemion ID), `caddy` (reverse proxy)
- **CDN**: None (direct serving)
- **Storage**: Local filesystem + S3-compatible backup

---

## 2. Current Architecture

### Routing (`src/worker.js`)
```
/                       → encyclopedia.js: home()
/anime, /manga          → encyclopedia.js: animeCatalog, mangaCatalog
/anime/:id, /manga/:id  → encyclopedia.js: animePage, mangaPage
/characters, /people    → encyclopedia.js: characters, people
/characters/:id         → encyclopedia.js: characterPage
/people/:id             → encyclopedia.js: personPage
/studios, /seasons      → encyclopedia.js: studios, seasons
/rankings               → encyclopedia.js: rankings
/mylist                 → encyclopedia.js: mylist
/search                 → encyclopedia.js: search
/community              → site.js: community

/api/catalog/*          → api/encyclopedia.js
/api/me, /api/users/*   → profile handlers
/pulse, /arena          → platform handlers
```

### Database Schema (relevant tables)

**Encyclopedia** (migration 0018):
```sql
entries (
  id, kind, ext_id, slug, title, title_en, 
  poster, type, status, year, units, units_aired, duration,
  score, genres, refreshed_at
)
-- Snapshots of anime/manga added to user lists

user_list (
  id, user_id, kind, ext_id, 
  status, score, progress, note,
  created_at, updated_at
)

favorites (
  id, user_id, target_type, ext_id, 
  name, image, created_at
)
-- target_type: anime, manga, character, person

entry_reviews (
  id, user_id, kind, ext_id,
  score, body, spoiler,
  created_at, updated_at, hidden_at, hidden_by
)

catalog_cache (key, value, fetched_at, expires_at)
catalog_errors (provider, operation, status, message, created_at)
catalog_settings (key, value, updated_at)
```

**Comments** (extended in 0018):
```sql
comments (
  target_type: comment, review, thread, collection, user, tournament, 
               anime, manga, character, person, entry_review
  target_id, user_id, body, created_at, ...
)
```

**Users, roles, moderation** (existing).

### Page Structure

**Entry Page** (`functions/encyclopedia.js:440`):
```javascript
export const entryPage = (kind) => async (request, env) => {
  const entry = await getEntry(env, kind, id); // from Shikimori
  return renderPage(request, {
    title: entry.title,
    path: `/${kind}/${id}-${slug}`,
    active: kind,
    body: entryPageHTML(entry, kind, user),
    scripts: ["entry.js"],
    styles: ["ency.css"]
  });
};
```

HTML sections:
- `.entry-hero`: poster, title, metadata, rating
- `.entry-main`: description, cast, staff, relations
- `.section`: reviews, comments
- List widget, favorite button (client-side)

Client script (`public/assets/entry.js`):
- List management
- Favorite toggle
- Review form
- Comments

### Design System

**Colors** (from `base.css:40`):
```css
--bg: #07061a
--bg-soft: #100d2b
--bg-deep: #050414
--panel: rgba(22, 18, 54, 0.78)
--text: #f4f2ff
--muted: #a39fc8
--accent: #8b5cff       /* primary purple */
--accent-strong: #7a3cff
--accent-light: #b69cff
--blue: #4f7cff
--pink: #ff6fb5
--green: #7be3b6
--red: #ff6b81
--border: rgba(182, 156, 255, 0.14)
```

**Typography**:
- Body: Manrope (variable 200-800)
- Display: Unbounded (variable 200-900)
- Size: 16px base, responsive

**Components** (existing):
- `.hero`: large header with background
- `.section`: content block with heading
- `.panel`: card-like container
- `.e-card`: encyclopedia entry card
- `.p-card`: person/character card
- `.ghost-btn`, `.primary-btn`, `.chip`: buttons
- `.filter-bar`, `.tabs-bar`: navigation

**Layout**:
- `.container`: max-width 1400px, centered
- Responsive: 1280px → burger menu
- Grid: `.e-rail` (cards), `.stat-grid`, `.fav-grid`

---

## 3. Data Availability

### What We Have

✅ **Entries** (anime/manga):
- Title, alternative names, year, type, status, episodes, score
- Genres, studios, description (BBCode)
- Poster images (Shikimori CDN)
- Relations (sequels, prequels, side stories)
- External links

✅ **Characters**:
- Name, image, description
- Anime/manga appearances with roles
- Voice actors (seyu)

✅ **People**:
- Name, image, job title, birth date
- Works (as director, producer, etc.)
- Characters voiced

✅ **User Data**:
- Watch/read lists with progress
- Ratings, reviews
- Favorites

### What We DON'T Have

❌ **Universe-specific data**:
- Events, timeline
- Organizations
- Locations
- Character relationships beyond "appears in"
- Plot points, story arcs

❌ **Spoiler metadata**:
- Episode ranges for events
- Spoiler levels
- Character development stages

❌ **Custom connections**:
- No explicit relationship graph
- No event → character links
- No location → event links

### Implications

**Universe Explorer cannot rely on pre-existing structured universe data.**

We have two options:

**Option A**: Admin-curated (recommended for MVP)
- Admin manually adds universe entities
- Admin defines relationships
- Start with 1-3 popular series as showcase
- Scalable but requires editorial effort

**Option B**: Derive from existing data
- Generate graph from:
  - Entry relations (sequel/prequel)
  - Character appearances
  - Shared staff/studio
  - Genre similarities
- Limited depth, no true "universe exploration"
- Good for demo, shallow for real use

**Decision**: Start with **Option A** + minimal auto-generation from existing data.

---

## 4. Integration Points

### Where Universe Explorer Fits

**Primary**: Entry page (`/anime/:id`, `/manga/:id`)
- Add "Explore Universe" section after hero
- Tabbed interface: Overview | Characters | Timeline | Relations
- Collapsible by default on mobile

**Secondary**: Dedicated universe page (future)
- `/universe/:series_id`
- Full-screen graph
- Deep exploration mode

### Existing Components to Reuse

✅ **Character cards** (`.p-card`): reuse for universe entities  
✅ **Hero section** (`.entry-hero`): keep existing, add CTA  
✅ **Tabs** (`.tabs-bar`): use for navigation  
✅ **API patterns** (`functions/api/encyclopedia.js`): follow for new endpoints  
✅ **Auth check** (`getMe()` in `app.js`): gate premium features  

### What NOT to Touch

🚫 Existing encyclopedia pages (keep them working)  
🚫 Catalog sync (`functions/_lib/catalog/`)  
🚫 User lists, reviews (don't migrate schema)  
🚫 Auth flow (Endemion ID)  
🚫 Header, footer, navigation  

---

## 5. Technical Constraints

### Environment
- **No Node.js build step**: pure ES modules
- **No npm packages in browser**: must use CDN or write own
- **No TypeScript in client**: JavaScript only
- **No React/Vue/Svelte**: vanilla JS + DOM manipulation

### Graph Library Options

❌ **D3.js**: too heavy (>500KB), overkill  
❌ **Cytoscape.js**: 300KB, complex API  
✅ **vis-network**: 200KB minified, good for interactive graphs  
✅ **Force-Graph**: lightweight, WebGL-powered  
✅ **Custom Canvas**: ~50KB, full control, best performance  

**Recommendation**: **Custom Canvas-based graph** for performance and control.
- Use `<canvas>` for rendering
- Implement basic force-directed layout
- Touch/mouse drag, zoom, pan
- Click handlers → open detail panel
- ~100-150 lines of code

### Performance Budget
- Initial load: <500ms (keep existing)
- Graph render: <1s for 50 nodes
- Interaction: 60fps
- Mobile: smooth on iPhone 12 / Galaxy S21

### Browser Support
- Modern browsers only (ES2020+)
- Chrome 90+, Firefox 88+, Safari 14+
- No IE11, no polyfills

---

## 6. Data Model Design

### New Tables

```sql
-- Core universe entity (character, org, location, event)
CREATE TABLE universe_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,           -- anime, manga (existing entries)
  ext_id INTEGER NOT NULL,      -- ID from entries or catalog
  universe_type TEXT NOT NULL,  -- 'character', 'organization', 'location', 'event'
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  spoiler_level INTEGER DEFAULT 0,  -- 0=safe, 1=minor, 2=major, 3=ending
  metadata TEXT,                -- JSON: {episode_range, arc, etc}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, ext_id, universe_type, title)
);

CREATE INDEX idx_universe_entities_lookup ON universe_entities(kind, ext_id);
CREATE INDEX idx_universe_entities_type ON universe_entities(universe_type);

-- Relationships between entities
CREATE TABLE universe_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES universe_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,  -- 'appears_in', 'friend', 'enemy', 'family', 
                                 -- 'member_of', 'located_in', 'participates_in'
  label TEXT,                    -- Display text: "Father of", "Rival of"
  strength REAL DEFAULT 1.0,     -- 0-1, for graph visualization weight
  spoiler_level INTEGER DEFAULT 0,
  metadata TEXT,                 -- JSON: {since_episode, until_episode, etc}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(source_id != target_id),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX idx_universe_relations_source ON universe_relations(source_id);
CREATE INDEX idx_universe_relations_target ON universe_relations(target_id);
CREATE INDEX idx_universe_relations_type ON universe_relations(relation_type);

-- Timeline events
CREATE TABLE universe_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,           -- references entries.kind
  ext_id INTEGER NOT NULL,      -- references entries.ext_id
  title TEXT NOT NULL,
  description TEXT,
  event_order INTEGER,          -- chronological order in-universe
  episode_reference TEXT,       -- "S01E05", "Chapter 20"
  spoiler_level INTEGER DEFAULT 0,
  metadata TEXT,                -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id) ON DELETE CASCADE
);

CREATE INDEX idx_universe_timeline_entry ON universe_timeline(kind, ext_id, event_order);

-- User spoiler preferences
CREATE TABLE user_spoiler_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  max_spoiler_level INTEGER DEFAULT 0,  -- 0-3
  progress_episode INTEGER,             -- User's watch progress
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, ext_id)
);
```

### API Endpoints

```
GET  /api/universe/:kind/:id/entities
     → list of entities for this entry
     → filter by universe_type, spoiler_level
     → returns: [{id, title, type, image, relations_count}]

GET  /api/universe/:kind/:id/graph
     → nodes + edges for graph visualization
     → filter by spoiler_level (from user settings or query param)
     → returns: {nodes: [], edges: [], entry: {}}

GET  /api/universe/:kind/:id/timeline
     → chronological events
     → filter by spoiler_level
     → returns: [{id, title, order, episode, spoiler}]

GET  /api/universe/entity/:entity_id
     → full details for an entity
     → returns: {entity, relations: [{target, type, label}], timeline_events}

POST /api/universe/spoiler-settings
     → save user's spoiler preference for an entry
     → body: {kind, ext_id, max_level, progress_episode}

--- Admin endpoints ---
POST   /api/admin/universe/entity
PUT    /api/admin/universe/entity/:id
DELETE /api/admin/universe/entity/:id

POST   /api/admin/universe/relation
DELETE /api/admin/universe/relation/:id

POST   /api/admin/universe/timeline
PUT    /api/admin/universe/timeline/:id
DELETE /api/admin/universe/timeline/:id
```

---

## 7. UI Components Plan

### Entry Page Integration

**Before** (current):
```
[Hero: poster + title + metadata]
[Description]
[Characters]
[Staff]
[Relations]
[Reviews]
[Comments]
```

**After** (with Universe Explorer):
```
[Hero: poster + title + metadata]
  ↳ "🧭 Explore Universe" button (if data exists)

[Universe Explorer Panel] ← NEW, collapsible
  [Tabs: Overview | Graph | Timeline | Characters]
  [Content area]

[Description] ← keep existing
[Staff] ← keep existing
[Relations] ← keep existing
[Reviews] ← keep existing
[Comments] ← keep existing
```

### Component Breakdown

**1. Universe Toggle Button**
- Location: Entry hero, top-right
- States: "Explore Universe" | "Hide Explorer"
- Shows badge if universe data exists
- Smooth scroll to panel

**2. Universe Panel** (`.universe-panel`)
- Glassmorphism card
- Tabs for navigation
- Sticky on scroll (desktop)
- Collapsible on mobile
- Spoiler control toggle in header

**3. Graph View** (`.universe-graph`)
- Canvas-based force-directed graph
- Zoom controls (+/-)
- Center button
- Legend (node types, relation types)
- Selected node info panel (sidebar)
- Touch gestures: pinch zoom, two-finger pan

**4. Timeline View** (`.universe-timeline`)
- Vertical timeline with dots
- Event cards (title, description, episode)
- Spoiler blur on unsafe events
- Filter: all events | by character
- Chronological vs. broadcast order toggle

**5. Entity List** (`.universe-entities`)
- Grid of entity cards
- Filter by type (character, org, location, event)
- Search within universe
- Click → show in graph or detail modal

**6. Spoiler Control** (`.spoiler-control`)
- Slider: Safe | Minor | Major | All
- Shows affected items count
- Remembers per-entry preference
- Visual indicator on spoiler items

**7. Entity Detail Modal** (`.entity-modal`)
- Opens when clicking graph node or entity card
- Image, title, description
- Connections list
- "View in graph" button
- Related timeline events
- Link to full character/person page (if exists)

---

## 8. Development Phases

### Phase 1: Foundation (2-3 days)
- [ ] Database migration (tables above)
- [ ] API endpoints (stub with empty data)
- [ ] Basic admin UI (add/edit entities, relations)
- [ ] Seed 1 test universe (e.g., "Death Note", 10 entities, 15 relations)

**Deliverable**: Admin can create universe data, API returns JSON.

### Phase 2: Graph UI (3-4 days)
- [ ] Canvas-based graph renderer
- [ ] Force-directed layout algorithm
- [ ] Zoom, pan, drag interactions
- [ ] Node click → info panel
- [ ] Responsive (desktop + mobile)
- [ ] Empty state ("No universe data")

**Deliverable**: Working interactive graph on entry page.

### Phase 3: Timeline & Entities (2-3 days)
- [ ] Timeline view (vertical)
- [ ] Entity list with filters
- [ ] Entity detail modal
- [ ] Spoiler blur/filter
- [ ] Tab navigation

**Deliverable**: Full Universe Explorer panel with 3 views.

### Phase 4: Spoiler System (1-2 days)
- [ ] User spoiler settings (API + DB)
- [ ] Spoiler control UI (slider)
- [ ] Filter graph/timeline by spoiler level
- [ ] Progress tracking integration (if exists)

**Deliverable**: Users can control spoiler visibility.

### Phase 5: Integration & Polish (2-3 days)
- [ ] Entry page integration (button, panel)
- [ ] Admin panel integration (universe management)
- [ ] Mobile optimization
- [ ] Performance tuning (graph with 100+ nodes)
- [ ] Loading states, error states
- [ ] SEO (meta tags, structured data)

**Deliverable**: Production-ready Universe Explorer on entry pages.

### Phase 6: Content & Testing (3-5 days)
- [ ] Seed 3-5 popular series with universe data
- [ ] User testing (desktop, mobile, tablet)
- [ ] Accessibility audit (keyboard nav, screen reader)
- [ ] Performance testing (large graphs)
- [ ] Documentation (admin guide, user guide)

**Deliverable**: Launch-ready with real content.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **No universe data at launch** | High | Start with 3-5 curated series as showcase. Add "Request Universe" button for users. |
| **Graph performance on mobile** | Medium | Limit nodes to 50 by default. Add "Expand" button for more. Use WebGL if Canvas too slow. |
| **Spoiler detection accuracy** | Medium | Default to conservative (hide more). Let users override. Label as "beta" feature. |
| **Admin data entry burden** | High | Build good admin UX. Consider crowdsourcing (future). Start small. |
| **Breaking existing encyclopedia** | Critical | Extensive testing. Feature flag. Rollback plan. |
| **Asset versioning** | Low | Already solved (commit c9e5e93). Use `?v=` for new files. |

---

## 10. Success Metrics

### Technical
- Graph loads <1s for 50 nodes
- Mobile performance: 60fps interactions
- Zero regressions in existing encyclopedia
- <5% error rate on universe API calls

### User
- 30%+ of entry page visitors click "Explore Universe"
- Avg. 2+ minutes time on universe panel
- 10%+ users adjust spoiler settings
- Low bounce rate on universe-enabled entries

### Content
- Launch with 5 fully-mapped universes
- Add 2-3 new universes per month
- User requests prioritize next additions

---

## 11. Technical Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| **Graph library** | Custom Canvas | Performance, size, full control |
| **Data source** | Admin-curated | No structured universe data exists |
| **Integration point** | Entry page panel | Non-disruptive, contextual |
| **Spoiler system** | Slider with levels | Flexible, visual, intuitive |
| **Timeline** | Chronological + broadcast | Serve both audiences |
| **Mobile strategy** | Touch-optimized graph | Core feature, not compromise |
| **Admin UI** | Extend existing panel | Consistency, no new auth |
| **Launch scope** | 5 curated series | Quality over quantity |

---

## 12. Design System Extension

### New Colors (Universe Explorer theme)
```css
--universe-bg: rgba(11, 8, 36, 0.92);    /* Panel background */
--universe-node-default: var(--accent);   /* Default node color */
--universe-node-character: #8b5cff;       /* Character nodes */
--universe-node-org: #4f7cff;             /* Organization nodes */
--universe-node-location: #7be3b6;        /* Location nodes */
--universe-node-event: #ffd27a;           /* Event nodes */
--universe-edge: rgba(182, 156, 255, 0.3); /* Graph edges */
--universe-edge-active: var(--accent-light); /* Selected edge */
--spoiler-blur: blur(12px);               /* Spoiler content */
--spoiler-overlay: rgba(139, 92, 255, 0.1); /* Spoiler indicator */
```

### New Components
- `.universe-panel`: main container
- `.universe-graph`: canvas wrapper
- `.universe-controls`: zoom/center buttons
- `.universe-timeline`: vertical timeline
- `.timeline-event`: event card
- `.entity-card`: small entity card for list
- `.entity-modal`: detail overlay
- `.spoiler-control`: slider component
- `.node-info`: sidebar panel

---

## 13. File Structure (New Files)

```
migrations/
  0019_universe_explorer.sql           ← New tables

functions/
  api/
    universe.js                         ← GET /api/universe/*
  admin/
    universe.js                         ← Admin CRUD (or extend adminPlatform.js)

public/
  assets/
    universe-graph.js                   ← Graph renderer
    universe-explorer.js                ← Main UI controller
    universe.css                        ← Styles

tests/
  universe.test.mjs                     ← API tests
```

**Estimated total**: ~1500 lines of code
- Migration: 150 lines
- API: 400 lines
- Graph renderer: 300 lines
- UI controller: 400 lines
- CSS: 250 lines

---

## 14. Next Steps

1. ✅ **Audit complete** → this document
2. ⏭️ **Create plan** → `UNIVERSE_EXPLORER_PLAN.md`
3. **Phase 1**: Database migration + API stubs
4. **Phase 2**: Graph UI prototype
5. **Phase 3**: Timeline + entity views
6. **Phase 4**: Spoiler system
7. **Phase 5**: Integration + polish
8. **Phase 6**: Content + testing

---

## Conclusion

Universe Explorer is **feasible and well-scoped**:
- ✅ Integrates cleanly with existing architecture
- ✅ No framework conflicts (vanilla JS)
- ✅ Reuses design system and patterns
- ✅ Minimal backend changes (3 new tables)
- ✅ Clear data model and API design
- ✅ Realistic timeline (2-3 weeks for MVP)
- ✅ Progressive enhancement (works without, better with)

**Biggest challenge**: Content creation (admin data entry).  
**Biggest opportunity**: First interactive universe explorer in anime encyclopedia space.

Ready to proceed to detailed implementation plan.
