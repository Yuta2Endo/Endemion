# Universe Explorer — Implementation Plan

> **Заменён.** Актуальный план — `UNIVERSE_EXPLORER_REVISED_PLAN.md`: SVG-граф как в Nexus, основа карты из каталога, спойлеры по `user_list.progress`, ручные записи только с источником. Документ оставлен для истории.

**Version**: 1.0  
**Date**: 2026-11-04  
**Status**: Superseded

Based on: `UNIVERSE_EXPLORER_AUDIT.md`

---

## Project Overview

**Goal**: Add interactive universe exploration to Endemion encyclopedia entry pages.

**Scope**: 
- Interactive relationship graph
- Timeline of events
- Entity browser (characters, orgs, locations, events)
- Spoiler protection system
- Admin content management
- Launch with 5 curated universes

**Timeline**: 2-3 weeks (11-15 working days)

**Effort Estimate**: ~1500 lines of code + testing + content

---

## Phase 1: Database Foundation (Days 1-2)

### 1.1 Database Migration

**File**: `migrations/0019_universe_explorer.sql`

**Tables to create**:

```sql
-- Core entities (characters, orgs, locations, events beyond what's in Shikimori)
CREATE TABLE universe_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
  ext_id INTEGER NOT NULL CHECK (ext_id > 0),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'organization', 'location', 'event')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  image_url TEXT NOT NULL DEFAULT '',
  spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (spoiler_level BETWEEN 0 AND 3),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX universe_entities_lookup ON universe_entities(kind, ext_id, entity_type, title);
CREATE INDEX universe_entities_entry ON universe_entities(kind, ext_id);
CREATE INDEX universe_entities_type ON universe_entities(entity_type);

-- Relationships between any entities (including Shikimori characters)
CREATE TABLE universe_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('character', 'organization', 'location', 'event', 'shikimori_character')),
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('character', 'organization', 'location', 'event', 'shikimori_character')),
  target_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'friend', 'rival', 'enemy', 'family', 'mentor', 'love_interest',
    'member_of', 'leader_of', 'works_for',
    'located_in', 'travels_to',
    'participates_in', 'witnesses', 'causes'
  )),
  label TEXT NOT NULL DEFAULT '',
  strength REAL NOT NULL DEFAULT 1.0 CHECK (strength BETWEEN 0.0 AND 1.0),
  spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (spoiler_level BETWEEN 0 AND 3),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(NOT (source_type = target_type AND source_id = target_id)),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id) ON DELETE CASCADE
);

CREATE INDEX universe_relations_entry ON universe_relations(kind, ext_id);
CREATE INDEX universe_relations_source ON universe_relations(source_type, source_id);
CREATE INDEX universe_relations_target ON universe_relations(target_type, target_id);
CREATE INDEX universe_relations_type ON universe_relations(relation_type);

-- Timeline events
CREATE TABLE universe_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  event_order INTEGER NOT NULL,
  episode_reference TEXT NOT NULL DEFAULT '',
  spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (spoiler_level BETWEEN 0 AND 3),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kind, ext_id) REFERENCES entries(kind, ext_id) ON DELETE CASCADE
);

CREATE INDEX universe_timeline_entry ON universe_timeline(kind, ext_id, event_order);
CREATE INDEX universe_timeline_spoiler ON universe_timeline(kind, ext_id, spoiler_level);

-- User spoiler preferences per entry
CREATE TABLE user_spoiler_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ext_id INTEGER NOT NULL,
  max_spoiler_level INTEGER NOT NULL DEFAULT 0 CHECK (max_spoiler_level BETWEEN 0 AND 3),
  progress_episode INTEGER NOT NULL DEFAULT 0 CHECK (progress_episode >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, ext_id)
);

CREATE INDEX user_spoiler_settings_user ON user_spoiler_settings(user_id);
```

**Spoiler levels**:
- `0`: Safe (general info, early episodes)
- `1`: Minor spoilers (mid-series developments)
- `2`: Major spoilers (late plot twists, character deaths)
- `3`: Ending spoilers (finale, resolution)

**Metadata JSON examples**:
```json
// Entity metadata
{
  "alias": ["Rivai", "Humanity's Strongest"],
  "first_appearance": "S01E04",
  "status": "alive" // for spoiler purposes
}

// Relation metadata
{
  "since_episode": "S01E05",
  "until_episode": "S02E12",
  "notes": "Revealed in flashback"
}

// Timeline metadata
{
  "arc": "Trost District",
  "participants": [1, 2, 5]
}
```

**Testing**:
```bash
node server/migrate-cli.mjs  # Apply locally
# Check schema
sqlite3 data/endemion.sqlite ".schema universe_entities"
```

### 1.2 Seed Test Data

**File**: `scripts/seed-universe-test.mjs`

Create minimal test dataset for "Death Note":
- 10 entities (Light, L, Misa, Ryuk, Watari, Task Force, Kira Investigation, Tokyo, Death Note, Yotsuba Arc)
- 15 relations
- 8 timeline events

**Deliverable**: Database ready, test data loaded.

---

## Phase 2: API Layer (Days 2-4)

### 2.1 Core API Functions

**File**: `functions/_lib/universe.js`

```javascript
// Get all entities for an entry, filtered by spoiler level
export async function getUniverseEntities(env, kind, extId, maxSpoilerLevel = 3) {
  const db = env.DB || env.database;
  const entities = await db.prepare(`
    SELECT id, entity_type, title, description, image_url, spoiler_level, metadata
    FROM universe_entities
    WHERE kind = ? AND ext_id = ? AND spoiler_level <= ?
    ORDER BY entity_type, title
  `).bind(kind, extId, maxSpoilerLevel).all();
  
  return entities.results.map((row) => ({
    id: row.id,
    type: row.entity_type,
    title: row.title,
    description: row.description,
    image: row.image_url,
    spoilerLevel: row.spoiler_level,
    metadata: JSON.parse(row.metadata || '{}')
  }));
}

// Get graph data (nodes + edges)
export async function getUniverseGraph(env, kind, extId, maxSpoilerLevel = 3) {
  const db = env.DB || env.database;
  
  // Fetch entities
  const entities = await getUniverseEntities(env, kind, extId, maxSpoilerLevel);
  
  // Fetch Shikimori characters for this entry
  const entry = await getEntry(env, kind, extId);
  const shikimoriChars = entry?.characterRoles || [];
  
  // Fetch relations
  const relations = await db.prepare(`
    SELECT id, source_type, source_id, target_type, target_id, 
           relation_type, label, strength, spoiler_level
    FROM universe_relations
    WHERE kind = ? AND ext_id = ? AND spoiler_level <= ?
  `).bind(kind, extId, maxSpoilerLevel).all();
  
  // Build nodes array
  const nodes = [
    // Entry itself as center node
    { id: `entry-${extId}`, type: 'entry', title: entry.title, image: entry.poster },
    // Universe entities
    ...entities.map((e) => ({ id: `entity-${e.id}`, type: e.type, title: e.title, image: e.image })),
    // Shikimori characters
    ...shikimoriChars.map((c) => ({ id: `char-${c.character.id}`, type: 'character', title: c.character.name, image: c.character.poster }))
  ];
  
  // Build edges array
  const edges = relations.results.map((r) => ({
    id: r.id,
    source: `${r.source_type === 'shikimori_character' ? 'char' : 'entity'}-${r.source_id}`,
    target: `${r.target_type === 'shikimori_character' ? 'char' : 'entity'}-${r.target_id}`,
    type: r.relation_type,
    label: r.label,
    strength: r.strength
  }));
  
  return { nodes, edges, entry: { kind, extId, title: entry.title } };
}

// Get timeline
export async function getUniverseTimeline(env, kind, extId, maxSpoilerLevel = 3) {
  const db = env.DB || env.database;
  const events = await db.prepare(`
    SELECT id, title, description, event_order, episode_reference, spoiler_level, metadata
    FROM universe_timeline
    WHERE kind = ? AND ext_id = ? AND spoiler_level <= ?
    ORDER BY event_order
  `).bind(kind, extId, maxSpoilerLevel).all();
  
  return events.results.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    order: e.event_order,
    episode: e.episode_reference,
    spoilerLevel: e.spoiler_level,
    metadata: JSON.parse(e.metadata || '{}')
  }));
}

// Get user's spoiler settings
export async function getUserSpoilerSettings(env, userId, kind, extId) {
  if (!userId) return { maxLevel: 0, progress: 0 };
  const db = env.DB || env.database;
  const row = await db.prepare(`
    SELECT max_spoiler_level, progress_episode
    FROM user_spoiler_settings
    WHERE user_id = ? AND kind = ? AND ext_id = ?
  `).bind(userId, kind, extId).first();
  
  return row ? { maxLevel: row.max_spoiler_level, progress: row.progress_episode } : { maxLevel: 0, progress: 0 };
}

// Save user's spoiler settings
export async function saveUserSpoilerSettings(env, userId, kind, extId, maxLevel, progress) {
  const db = env.DB || env.database;
  await db.prepare(`
    INSERT INTO user_spoiler_settings (user_id, kind, ext_id, max_spoiler_level, progress_episode, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, kind, ext_id) DO UPDATE SET
      max_spoiler_level = excluded.max_spoiler_level,
      progress_episode = excluded.progress_episode,
      updated_at = excluded.updated_at
  `).bind(userId, kind, extId, maxLevel, progress).run();
}
```

### 2.2 Public API Endpoints

**File**: `functions/api/universe.js`

```javascript
import { getUniverseGraph, getUniverseTimeline, getUserSpoilerSettings, saveUserSpoilerSettings } from "../_lib/universe.js";
import { getMe } from "../_lib/users.js";
import { json } from "../_lib/html.js";

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const [, , , kind, extId, action] = url.pathname.split("/");
  const id = Number.parseInt(extId, 10);
  
  if (!kind || !id || !["anime", "manga"].includes(kind)) {
    return json({ error: "Invalid entry" }, 400);
  }
  
  const { user } = await getMe(request, env);
  const spoilerSettings = await getUserSpoilerSettings(env, user?.id, kind, id);
  const maxLevel = Number.parseInt(url.searchParams.get("spoiler") || String(spoilerSettings.maxLevel), 10);
  
  if (action === "graph") {
    const graph = await getUniverseGraph(env, kind, id, maxLevel);
    return json(graph);
  }
  
  if (action === "timeline") {
    const timeline = await getUniverseTimeline(env, kind, id, maxLevel);
    return json({ events: timeline });
  }
  
  if (action === "settings") {
    return json(spoilerSettings);
  }
  
  return json({ error: "Unknown action" }, 404);
}

export async function onRequestPost({ request, env }) {
  const { user } = await getMe(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  
  const { kind, extId, maxLevel, progress } = await request.json();
  
  if (!kind || !extId || maxLevel == null) {
    return json({ error: "Invalid request" }, 400);
  }
  
  await saveUserSpoilerSettings(env, user.id, kind, extId, maxLevel, progress || 0);
  return json({ ok: true });
}
```

**Routes** (add to `src/worker.js`):
```javascript
app.get("/api/universe/:kind/:id/graph", universe.onRequestGet);
app.get("/api/universe/:kind/:id/timeline", universe.onRequestGet);
app.get("/api/universe/:kind/:id/settings", universe.onRequestGet);
app.post("/api/universe/settings", universe.onRequestPost);
```

### 2.3 Admin API Endpoints

**File**: `functions/api/adminUniverse.js`

CRUD for entities, relations, timeline events.

Follow existing admin patterns from `adminPlatform.js`.

**Deliverable**: Working API, returns JSON, tested with curl.

---

## Phase 3: Graph Renderer (Days 4-7)

### 3.1 Canvas-Based Graph Engine

**File**: `public/assets/universe-graph.js`

```javascript
// Simple force-directed graph on <canvas>
export class UniverseGraph {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.width = canvas.offsetWidth * devicePixelRatio;
    this.height = canvas.height = canvas.offsetHeight * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
    
    this.nodes = [];
    this.edges = [];
    this.selectedNode = null;
    this.hoveredNode = null;
    
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dragging = null;
    
    this.nodeColors = {
      entry: "#8b5cff",
      character: "#8b5cff",
      organization: "#4f7cff",
      location: "#7be3b6",
      event: "#ffd27a"
    };
    
    this.setupEvents();
    this.animate();
  }
  
  setData({ nodes, edges }) {
    this.nodes = nodes.map((n, i) => ({
      ...n,
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: 0,
      vy: 0,
      radius: n.type === "entry" ? 40 : 30
    }));
    this.edges = edges;
    this.center();
  }
  
  update() {
    // Force-directed layout (simple spring + repulsion)
    const k = 0.1; // Spring constant
    const repulsion = 5000;
    const damping = 0.8;
    
    // Reset forces
    this.nodes.forEach((n) => { n.fx = 0; n.fy = 0; });
    
    // Edge springs
    this.edges.forEach((e) => {
      const source = this.nodes.find((n) => n.id === e.source);
      const target = this.nodes.find((n) => n.id === e.target);
      if (!source || !target) return;
      
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = k * (dist - 150); // 150 = desired edge length
      
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      
      source.fx += fx;
      source.fy += fy;
      target.fx -= fx;
      target.fy -= fy;
    });
    
    // Node repulsion
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy || 1;
        const force = repulsion / distSq;
        
        const fx = (dx / Math.sqrt(distSq)) * force;
        const fy = (dy / Math.sqrt(distSq)) * force;
        
        a.fx -= fx;
        a.fy -= fy;
        b.fx += fx;
        b.fy += fy;
      }
    }
    
    // Apply forces
    this.nodes.forEach((n) => {
      if (n === this.dragging) return;
      n.vx = (n.vx + n.fx) * damping;
      n.vy = (n.vy + n.fy) * damping;
      n.x += n.vx;
      n.y += n.vy;
      
      // Keep in bounds
      n.x = Math.max(50, Math.min(this.width - 50, n.x));
      n.y = Math.max(50, Math.min(this.height - 50, n.y));
    });
  }
  
  render() {
    const ctx = this.ctx;
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    
    // Apply zoom and pan
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.zoom, this.zoom);
    
    // Draw edges
    ctx.strokeStyle = "rgba(182, 156, 255, 0.3)";
    ctx.lineWidth = 2;
    this.edges.forEach((e) => {
      const source = this.nodes.find((n) => n.id === e.source);
      const target = this.nodes.find((n) => n.id === e.target);
      if (!source || !target) return;
      
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    });
    
    // Draw nodes
    this.nodes.forEach((n) => {
      ctx.fillStyle = this.nodeColors[n.type] || this.nodeColors.character;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
      
      if (n === this.selectedNode) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      
      // Label
      ctx.fillStyle = "#fff";
      ctx.font = "14px Manrope";
      ctx.textAlign = "center";
      ctx.fillText(n.title, n.x, n.y + n.radius + 16);
    });
    
    ctx.restore();
  }
  
  animate() {
    this.update();
    this.render();
    requestAnimationFrame(() => this.animate());
  }
  
  setupEvents() {
    // Mouse/touch handlers for drag, zoom, select
    // (implementation omitted for brevity, ~100 lines)
  }
  
  center() {
    // Center graph in viewport
    const bounds = this.getBounds();
    this.zoom = Math.min(1, Math.min(
      this.canvas.offsetWidth / bounds.width,
      this.canvas.offsetHeight / bounds.height
    ) * 0.8);
    this.offsetX = (this.canvas.offsetWidth - bounds.width * this.zoom) / 2 - bounds.minX * this.zoom;
    this.offsetY = (this.canvas.offsetHeight - bounds.height * this.zoom) / 2 - bounds.minY * this.zoom;
  }
  
  getBounds() {
    const xs = this.nodes.map((n) => n.x);
    const ys = this.nodes.map((n) => n.y);
    return {
      minX: Math.min(...xs) - 50,
      maxX: Math.max(...xs) + 50,
      minY: Math.min(...ys) - 50,
      maxY: Math.max(...ys) + 50,
      width: Math.max(...xs) - Math.min(...xs) + 100,
      height: Math.max(...ys) - Math.min(...ys) + 100
    };
  }
  
  selectNode(node) {
    this.selectedNode = node;
    this.onNodeSelect?.(node);
  }
}
```

### 3.2 UI Controller

**File**: `public/assets/universe-explorer.js`

```javascript
import { api, el, errorBox, stateBox } from "./app.js";
import { UniverseGraph } from "./universe-graph.js";

let graph = null;
let currentEntry = null;
let spoilerLevel = 0;

export async function initUniverseExplorer(kind, extId) {
  currentEntry = { kind, extId };
  
  const panel = document.querySelector(".universe-panel");
  if (!panel) return;
  
  // Load spoiler settings
  const settingsResp = await api(`/api/universe/${kind}/${extId}/settings`);
  if (settingsResp.ok) {
    spoilerLevel = settingsResp.data.maxLevel;
    updateSpoilerSlider(spoilerLevel);
  }
  
  // Load graph
  await loadGraph();
  
  // Setup tabs
  document.querySelectorAll(".universe-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  
  // Setup spoiler control
  const slider = document.querySelector(".spoiler-slider");
  slider.addEventListener("input", (e) => {
    spoilerLevel = Number.parseInt(e.target.value, 10);
    updateSpoilerLabel(spoilerLevel);
    loadGraph();
    loadTimeline();
  });
}

async function loadGraph() {
  const { kind, extId } = currentEntry;
  const canvas = document.querySelector(".universe-graph canvas");
  const box = canvas.closest(".universe-tab-content");
  
  box.replaceChildren(stateBox("Загружаем граф..."), canvas);
  
  const resp = await api(`/api/universe/${kind}/${extId}/graph?spoiler=${spoilerLevel}`);
  
  if (!resp.ok) {
    box.prepend(errorBox(resp.data?.error || "Граф не загрузился"));
    return;
  }
  
  if (!resp.data.nodes.length) {
    box.replaceChildren(el("p", "muted", "Граф связей пока не создан для этого произведения."));
    return;
  }
  
  if (!graph) {
    graph = new UniverseGraph(canvas);
    graph.onNodeSelect = (node) => showNodeInfo(node);
  }
  
  graph.setData(resp.data);
  box.querySelector(".state-box")?.remove();
}

async function loadTimeline() {
  const { kind, extId } = currentEntry;
  const container = document.querySelector(".universe-timeline");
  
  container.replaceChildren(stateBox("Загружаем хронологию..."));
  
  const resp = await api(`/api/universe/${kind}/${extId}/timeline?spoiler=${spoilerLevel}`);
  
  if (!resp.ok) {
    container.replaceChildren(errorBox(resp.data?.error || "Хронология не загрузилась"));
    return;
  }
  
  if (!resp.data.events.length) {
    container.replaceChildren(el("p", "muted", "События хронологии пока не добавлены."));
    return;
  }
  
  const timeline = el("div", "timeline-list");
  resp.data.events.forEach((event) => {
    const card = el("div", "timeline-event");
    card.append(
      el("div", "timeline-dot"),
      el("div", "timeline-content",
        el("h4", null, event.title),
        el("p", "timeline-episode", event.episode),
        el("p", null, event.description)
      )
    );
    timeline.append(card);
  });
  
  container.replaceChildren(timeline);
}

function switchTab(tabName) {
  document.querySelectorAll(".universe-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".universe-tab-content").forEach((content) => {
    content.hidden = content.dataset.tab !== tabName;
  });
  
  if (tabName === "timeline" && document.querySelector(".universe-timeline").childElementCount === 0) {
    loadTimeline();
  }
}

function showNodeInfo(node) {
  const panel = document.querySelector(".node-info");
  panel.innerHTML = `
    <h3>${node.title}</h3>
    <p class="node-type">${node.type}</p>
    <p>Выбран в графе</p>
  `;
  panel.hidden = false;
}

function updateSpoilerSlider(level) {
  document.querySelector(".spoiler-slider").value = level;
  updateSpoilerLabel(level);
}

function updateSpoilerLabel(level) {
  const labels = ["Без спойлеров", "Незначительные", "Важные", "Все спойлеры"];
  document.querySelector(".spoiler-label").textContent = labels[level];
}
```

**Deliverable**: Working graph, renders on entry page, interactive.

---

## Phase 4: Styles & Integration (Days 7-9)

### 4.1 Styles

**File**: `public/assets/universe.css`

```css
/* Universe Explorer Panel */
.universe-panel {
  margin: 40px 0;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(11, 8, 36, 0.92);
  backdrop-filter: blur(20px);
}

.universe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.universe-title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}

/* Tabs */
.universe-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
}

.universe-tabs button {
  padding: 12px 20px;
  border: none;
  background: none;
  color: var(--muted);
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s;
  position: relative;
}

.universe-tabs button.active {
  color: var(--accent-light);
}

.universe-tabs button.active::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
}

/* Graph */
.universe-graph {
  position: relative;
  width: 100%;
  height: 600px;
  border-radius: var(--radius-sm);
  background: var(--bg-deep);
  overflow: hidden;
}

.universe-graph canvas {
  width: 100%;
  height: 100%;
}

.universe-controls {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
}

.universe-controls button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(22, 18, 54, 0.95);
  color: var(--text);
  font-size: 20px;
  cursor: pointer;
  transition: background 0.2s;
}

.universe-controls button:hover {
  background: var(--panel);
}

/* Timeline */
.timeline-list {
  position: relative;
  padding-left: 40px;
}

.timeline-list::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, transparent, var(--accent), transparent);
}

.timeline-event {
  position: relative;
  margin-bottom: 32px;
}

.timeline-dot {
  position: absolute;
  left: -34px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}

.timeline-content h4 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.timeline-episode {
  font-size: 14px;
  color: var(--accent-light);
  margin: 0 0 8px;
}

.timeline-content p {
  margin: 0;
  color: var(--muted);
}

/* Spoiler Control */
.spoiler-control {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  background: var(--panel-light);
}

.spoiler-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  appearance: none;
  outline: none;
}

.spoiler-slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 12px var(--accent);
}

.spoiler-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: none;
  box-shadow: 0 0 12px var(--accent);
}

.spoiler-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-light);
  white-space: nowrap;
}

/* Node Info Panel */
.node-info {
  position: absolute;
  bottom: 16px;
  left: 16px;
  width: 280px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(22, 18, 54, 0.98);
  backdrop-filter: blur(20px);
}

.node-info h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.node-type {
  font-size: 14px;
  color: var(--accent-light);
  text-transform: capitalize;
  margin: 0 0 12px;
}

/* Mobile */
@media (max-width: 768px) {
  .universe-panel {
    padding: 20px;
  }
  
  .universe-graph {
    height: 400px;
  }
  
  .node-info {
    position: static;
    width: auto;
    margin-top: 16px;
  }
}
```

### 4.2 Entry Page Integration

**Modify**: `functions/encyclopedia.js` (entryPage function)

Add Universe Explorer panel after hero, before description:

```javascript
const universePanel = await hasUniverseData(env, kind, id) ? `
  <section class="universe-panel" id="universeExplorer">
    <div class="universe-header">
      <h2 class="universe-title">🧭 Исследование вселенной</h2>
      <div class="spoiler-control">
        <span class="spoiler-label">Без спойлеров</span>
        <input type="range" class="spoiler-slider" min="0" max="3" value="0" step="1">
      </div>
    </div>
    
    <div class="universe-tabs">
      <button data-tab="graph" class="active">Граф связей</button>
      <button data-tab="timeline">Хронология</button>
    </div>
    
    <div class="universe-tab-content" data-tab="graph">
      <div class="universe-graph">
        <canvas></canvas>
        <div class="universe-controls">
          <button aria-label="Увеличить">+</button>
          <button aria-label="Уменьшить">−</button>
          <button aria-label="По центру">⊙</button>
        </div>
        <div class="node-info" hidden></div>
      </div>
    </div>
    
    <div class="universe-tab-content" data-tab="timeline" hidden>
      <div class="universe-timeline"></div>
    </div>
  </section>
` : "";
```

Add scripts to entry page:
```javascript
scripts: ["entry.js", "universe-graph.js", "universe-explorer.js"]
styles: ["ency.css", "universe.css"]
```

**Helper function**:
```javascript
async function hasUniverseData(env, kind, extId) {
  const db = env.DB || env.database;
  const count = await db.prepare(`
    SELECT COUNT(*) as c FROM universe_entities WHERE kind = ? AND ext_id = ?
  `).bind(kind, extId).first();
  return count.c > 0;
}
```

**Deliverable**: Universe Explorer visible on entry pages with data.

---

## Phase 5: Admin UI (Days 9-11)

### 5.1 Admin Panel Section

**Extend**: `public/admin.html`

Add "Universe Explorer" tab.

**Create**: `public/assets/admin-universe.js`

Forms for:
- Select entry (anime/manga search)
- Add entity (type, title, description, image, spoiler level)
- Add relation (source, target, type, label)
- Add timeline event (title, description, order, episode, spoiler)
- List entities (with edit/delete)
- List relations (with delete)
- List timeline (with reorder)
- Preview graph (embed universe-graph.js)

Follow patterns from `admin-catalog.js` and `admin-community.js`.

### 5.2 Admin API

**File**: `functions/api/adminUniverse.js`

```javascript
export async function onRequestPost({ request, env }) {
  const { user } = await getMe(request, env);
  if (!user || user.role !== "admin") return json({ error: "Forbidden" }, 403);
  
  const data = await request.json();
  const { action, ...params } = data;
  
  if (action === "createEntity") {
    // INSERT INTO universe_entities ...
  }
  
  if (action === "createRelation") {
    // INSERT INTO universe_relations ...
  }
  
  if (action === "createTimelineEvent") {
    // INSERT INTO universe_timeline ...
  }
  
  // ... etc
  
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  // List entities, relations, timeline for admin panel
}

export async function onRequestDelete({ request, env, params }) {
  // Delete entity/relation/event
}
```

**Deliverable**: Admin can create/edit/delete universe data through UI.

---

## Phase 6: Content Creation (Days 11-13)

### 6.1 Curate 5 Series

**Priority list** (popular, diverse, good for demo):

1. **Death Note** (anime/manga)
   - 10 characters, 5 orgs/locations, 8 events
   - Clear timeline, good for spoiler demo

2. **Attack on Titan** (anime/manga)
   - 15 characters, 3 walls (locations), military branches (orgs), 12 events
   - Complex relationships, high spoiler risk → good test case

3. **Fullmetal Alchemist: Brotherhood** (anime)
   - 12 characters, Amestris (location), military (org), 10 events
   - Multiple arcs, family relations

4. **Steins;Gate** (anime)
   - 8 characters, lab (location), SERN (org), 10 events (timeline crucial!)
   - Time travel → order matters

5. **My Hero Academia** (anime/manga)
   - 15 characters, UA (org/location), League of Villains (org), 8 events
   - Hero-villain dynamics, mentor-student relations

**Per series**:
- 2-3 hours data entry
- Test graph render
- Verify spoiler levels
- Add images (from Shikimori or MyAnimeList)

### 6.2 Seed Production Data

**File**: `scripts/seed-universe-prod.mjs`

Structured JSON → SQL inserts.

**Deliverable**: 5 series fully mapped, production-ready.

---

## Phase 7: Testing & Polish (Days 13-15)

### 7.1 Testing Checklist

**Functionality**:
- [ ] Graph loads and renders
- [ ] Nodes draggable
- [ ] Zoom/pan works
- [ ] Click node → info panel
- [ ] Spoiler slider filters content
- [ ] Timeline loads
- [ ] Tab switching
- [ ] Admin CRUD all works
- [ ] API returns correct data
- [ ] Spoiler settings saved per user

**Devices**:
- [ ] Desktop (Chrome, Firefox, Safari)
- [ ] Tablet (iPad, Android)
- [ ] Mobile (iPhone 12+, Galaxy S21+)
- [ ] Touch gestures (pinch zoom, drag)

**Performance**:
- [ ] Graph <1s load for 50 nodes
- [ ] 60fps interactions
- [ ] No memory leaks (test with 100+ nodes)
- [ ] Mobile doesn't lag

**Edge cases**:
- [ ] Entry with no universe data (hidden panel)
- [ ] Empty graph (message)
- [ ] Empty timeline (message)
- [ ] API error (error state)
- [ ] Network offline (cached or error)
- [ ] Very large graph (100+ nodes)

**Accessibility**:
- [ ] Keyboard nav (tab through UI)
- [ ] Focus visible
- [ ] ARIA labels on controls
- [ ] Screen reader (test with NVDA/VoiceOver)

**Regression**:
- [ ] Existing encyclopedia pages work
- [ ] Lists, favorites, reviews unaffected
- [ ] Admin panel sections unaffected
- [ ] Performance no worse

### 7.2 Polish Tasks

- [ ] Loading skeletons
- [ ] Empty states with illustrations
- [ ] Error recovery (retry button)
- [ ] Smooth animations
- [ ] Touch feedback
- [ ] Tooltips on graph controls
- [ ] Legend (node types, edge types)
- [ ] Search in graph (future: Phase 8)
- [ ] Export graph as image (future: Phase 8)

### 7.3 Documentation

**Create**:
- `docs/UNIVERSE_EXPLORER.md` — user guide
- `docs/UNIVERSE_EXPLORER_ADMIN.md` — admin guide (how to add data)
- Update `README.md` with Universe Explorer mention

**Deliverable**: Tested, polished, documented.

---

## Phase 8: Launch & Future (Day 15+)

### 8.1 Launch Checklist

- [ ] Migration applied to production
- [ ] Seed data loaded
- [ ] Assets deployed (versioned URLs)
- [ ] Tested on production
- [ ] Announcement (community post, social media)

### 8.2 Future Enhancements (Post-MVP)

**Features**:
- Dedicated `/universe/:series` full-screen view
- Entity detail modals (full character pages)
- Filter graph by relation type
- Search within graph
- Character comparison tool
- Export graph as image
- Share universe view (permalink)
- User contributions (submit entities → admin review)

**Content**:
- Add 2-3 new series per month
- User voting on next series
- Seasonal anime coverage

**Technical**:
- WebGL renderer for 500+ node graphs
- Server-side graph layout (precompute positions)
- CDN for universe images
- Progressive loading (load nearby nodes on demand)

---

## File Checklist

**New files**:
- [ ] `migrations/0019_universe_explorer.sql`
- [ ] `functions/_lib/universe.js`
- [ ] `functions/api/universe.js`
- [ ] `functions/api/adminUniverse.js`
- [ ] `public/assets/universe-graph.js`
- [ ] `public/assets/universe-explorer.js`
- [ ] `public/assets/universe.css`
- [ ] `public/assets/admin-universe.js`
- [ ] `scripts/seed-universe-test.mjs`
- [ ] `scripts/seed-universe-prod.mjs`
- [ ] `tests/universe.test.mjs`
- [ ] `docs/UNIVERSE_EXPLORER.md`
- [ ] `docs/UNIVERSE_EXPLORER_ADMIN.md`

**Modified files**:
- [ ] `functions/encyclopedia.js` (add panel to entry page)
- [ ] `src/worker.js` (add API routes)
- [ ] `public/admin.html` (add Universe tab)
- [ ] `README.md` (mention Universe Explorer)

**Total estimate**: ~2000 lines new code, ~100 lines modifications.

---

## Success Criteria

**Technical**:
- ✅ Zero regressions in existing features
- ✅ Graph loads <1s, 60fps interactions
- ✅ Works on mobile (touch optimized)
- ✅ All tests pass
- ✅ Admin can add data without code

**Content**:
- ✅ 5 series fully mapped at launch
- ✅ 50+ entities, 80+ relations, 40+ timeline events

**User**:
- ✅ Feature visible on entry pages
- ✅ Intuitive without tutorial
- ✅ Spoiler system prevents accidental spoilers
- ✅ Users engage (click, explore, adjust spoilers)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Graph too slow on mobile | Test early (Phase 3), optimize or simplify |
| Not enough content at launch | Focus on quality over quantity, 5 series is enough |
| Admin data entry burden | Good UX, clear guide, start small |
| Spoiler system inaccurate | Conservative defaults, user override |
| Breaking existing pages | Feature flag, extensive testing, rollback plan |

---

## Next Step

Start **Phase 1**: Database migration.

```bash
# Create migration file
touch migrations/0019_universe_explorer.sql
# Start coding
```

Ready to implement?
