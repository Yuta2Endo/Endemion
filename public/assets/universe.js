// Universe Explorer на странице произведения: карта связей, хронология, персонажи, организации, локации,
// связанные произведения и переключатель спойлеров. Модуль загружается только когда зритель открывает
// Universe Explorer (public/assets/entry.js), данные приходят из /api/universe (functions/api/universe.js).
// Граф рисуется в SVG той же силовой моделью, что Nexus (public/assets/nexus.js): раскладка останавливается,
// когда узлы успокоились, и снова запускается при перетаскивании

import { api, button, el, errorBox, link, plural, remoteImage, stateBox, toast } from "./app.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const ENTITY_LABELS = { organization: "Организация", location: "Локация", event: "Событие" };
export const RELATION_LABELS = {
  friend: "Дружба", family: "Родство", enemy: "Вражда", rival: "Соперничество", mentor: "Наставник",
  member_of: "Состоит в", participates_in: "Участвует в", located_in: "Находится в"
};
// Связи из каталога
const AUTO_LABELS = { appears_in: "Персонаж", created: "Создатель", produced: "Студия", related: "Связанное произведение", in_universe: "Часть вселенной" };

// Тип узла: подпись, цвет и размер кружка
const TYPES = {
  work: { label: "Произведение", color: "#8b5cff", r: 24 },
  character: { label: "Персонаж", color: "#ff6fb5", r: 20 },
  organization: { label: "Организация", color: "#7be3b6", r: 18 },
  location: { label: "Локация", color: "#4f7cff", r: 18 },
  event: { label: "Событие", color: "#f0a36b", r: 18 },
  studio: { label: "Студия", color: "#5ec8d8", r: 15 },
  person: { label: "Создатель", color: "#ffd27a", r: 15 }
};
const CENTER_R = 36;
const RELATION_COLORS = {
  friend: "#7be3b6", family: "#ffd27a", enemy: "#ff6b81", rival: "#ff6fb5", mentor: "#7fb4ff",
  member_of: "#5ec8d8", participates_in: "#f0a36b", located_in: "#4f7cff"
};
const AUTO_COLOR = "#8b8fd6";
const TABS = [
  ["map", "Карта связей"], ["timeline", "Хронология"], ["characters", "Персонажи"],
  ["organization", "Организации"], ["location", "Локации"], ["related", "Связанные произведения"]
];
const LIMITS = [[25, "25 узлов"], [50, "50 узлов"], [0, "Все узлы"]];
const ZOOM = { min: 0.35, max: 3 };

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const radius = (node) => (node.center ? CENTER_R : TYPES[node.type]?.r || 16);
const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Порядок узлов при ограничении: центр, главные герои, сущности вселенной, связанные произведения, остальные */
function priority(node) {
  if (node.center) return 0;
  if (node.type === "character") return node.role === "main" ? 1 : 4;
  if (ENTITY_LABELS[node.type]) return 2;
  if (node.type === "work") return 3;
  return node.type === "studio" ? 5 : 6;
}

/**
 * Universe Explorer в контейнере root. kind и id — произведение, signedIn — вошёл ли зритель
 * (вошедшему выбранный режим спойлеров сохраняется)
 */
export function mountUniverse(root, { kind, id, signedIn }) {
  const state = {
    tab: "map", mode: null, graph: null, timeline: null, order: "episode", character: "",
    selected: null, types: null, limit: 50, query: "", view: { k: 1, tx: 0, ty: 0 }, positions: new Map()
  };
  let simulation = 0;

  // ==================== КАРКАС ====================

  const tabs = el("div", "ux-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Разделы Universe Explorer");
  const tabButtons = TABS.map(([key, label]) => {
    const node = button(label, "chip", () => openTab(key));
    node.setAttribute("role", "tab");
    node.id = `ux-tab-${key}`;
    node.setAttribute("aria-controls", "ux-panel");
    node.dataset.tab = key;
    return node;
  });
  tabs.append(...tabButtons);

  const spoiler = el("div", "ux-spoiler");
  spoiler.setAttribute("role", "group");
  spoiler.setAttribute("aria-label", "Спойлеры");
  const safeButton = button("Без спойлеров", "chip", () => setMode("safe"), { pressed: false });
  const fullButton = button("Полная энциклопедия", "chip", () => setMode("full"), { pressed: false });
  spoiler.append(safeButton, fullButton);

  const top = el("div", "ux-top");
  top.append(tabs, spoiler);
  const note = el("p", "ux-note");
  note.setAttribute("aria-live", "polite");
  const panel = el("div", "ux-panel");
  panel.id = "ux-panel";
  panel.setAttribute("role", "tabpanel");
  panel.tabIndex = -1;
  root.replaceChildren(top, note, panel);

  function drawChrome() {
    for (const node of tabButtons) node.setAttribute("aria-selected", String(node.dataset.tab === state.tab));
    panel.setAttribute("aria-labelledby", `ux-tab-${state.tab}`);
    const g = state.graph;
    safeButton.disabled = fullButton.disabled = !g;
    safeButton.setAttribute("aria-pressed", String(g?.mode === "safe"));
    fullButton.setAttribute("aria-pressed", String(g?.mode === "full"));
    if (!g) {
      note.textContent = "";
      return;
    }
    const hidden = g.hidden ? ` Скрыто как спойлеры: ${g.hidden}.` : "";
    if (g.mode === "full") note.textContent = "Полная энциклопедия: показано всё, включая спойлеры.";
    else if (g.completed) note.textContent = "Без спойлеров: вы досмотрели произведение, поэтому видно всё.";
    else if (!g.signedIn) note.textContent = `Без спойлеров. Войдите и отмечайте ${kind === "anime" ? "эпизоды" : "главы"} в своём списке — карта откроет то, что вы уже знаете.${hidden}`;
    else if (!g.progress) note.textContent = `Без спойлеров. Отметьте в списке, сколько ${kind === "anime" ? "эпизодов вы посмотрели" : "глав вы прочитали"}, — карта откроет известное к этому моменту.${hidden}`;
    else note.textContent = `Без спойлеров: показано известное к ${kind === "anime" ? "эпизоду" : "главе"} ${g.progress}${g.entry.units ? ` из ${g.entry.units}` : ""}.${hidden}`;
  }

  async function setMode(mode) {
    if (state.graph?.mode === mode) return;
    state.mode = mode;
    if (signedIn) {
      const saved = await api(`/api/universe/${kind}/${id}/settings`, { method: "PUT", body: { mode } });
      if (!saved.ok) toast(saved.data?.error || "Режим не сохранился, он действует до перезагрузки страницы.");
    }
    await loadGraph();
  }

  function openTab(key) {
    state.tab = key;
    cancelAnimationFrame(simulation);
    drawChrome();
    renderTab();
  }

  function renderTab() {
    if (!state.graph) return;
    if (state.tab === "map") renderMap();
    else if (state.tab === "timeline") renderTimeline();
    else if (state.tab === "characters") renderCharacters();
    else if (state.tab === "related") renderRelated();
    else renderEntities(state.tab);
  }

  // ==================== ДАННЫЕ ====================

  async function loadGraph() {
    cancelAnimationFrame(simulation);
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(skeleton());
    const query = state.mode ? `?mode=${state.mode}` : "";
    const result = await api(`/api/universe/${kind}/${id}${query}`);
    panel.removeAttribute("aria-busy");
    if (!result.ok) {
      panel.replaceChildren(errorBox(result.data?.error || "Universe Explorer не загрузился.", loadGraph));
      return;
    }
    state.graph = result.data;
    state.mode = result.data.mode;
    state.timeline = null;
    const ids = new Set(state.graph.nodes.map((node) => node.id));
    if (!ids.has(state.selected)) state.selected = centerNode().id;
    // Новые типы узлов (например, открылись спойлеры) включаются в фильтр
    const present = new Set(state.graph.nodes.map((node) => node.type));
    state.types = state.types ? new Set([...present].filter((type) => state.types.has(type) || !state.seenTypes?.has(type))) : present;
    state.seenTypes = present;
    drawChrome();
    renderTab();
  }

  const centerNode = () => state.graph.nodes.find((node) => node.center);
  const nodeById = (nodeId) => state.graph.nodes.find((node) => node.id === nodeId);

  function skeleton() {
    const box = el("div", "ux-skeleton");
    box.setAttribute("aria-hidden", "true");
    box.append(el("div", "skeleton ux-skeleton-stage"), el("div", "skeleton ux-skeleton-side"));
    const wrap = el("div");
    wrap.append(box, el("p", "visually-hidden", "Загружаем карту вселенной…"));
    return wrap;
  }

  /** Связи узла: другой конец и подпись */
  function connections(nodeId) {
    return state.graph.edges
      .filter((edge) => edge.source === nodeId || edge.target === nodeId)
      .map((edge) => ({ edge, other: nodeById(edge.source === nodeId ? edge.target : edge.source), outgoing: edge.source === nodeId }))
      .filter((item) => item.other);
  }

  function edgeLabel(edge) {
    if (edge.auto) return edge.label || AUTO_LABELS[edge.type] || "";
    return RELATION_LABELS[edge.type] || edge.type;
  }

  /** Строка списка связей: имя, тип, вид связи, эпизод и источник для ручных связей */
  function connectionRow({ edge, other, outgoing }, onPick) {
    const row = onPick ? button("", "ux-link", () => onPick(other.id)) : el("div", "ux-link");
    const text = el("span");
    text.append(el("strong", null, other.title));
    const direction = edge.auto ? "" : outgoing ? " → " : " ← ";
    const parts = [TYPES[other.type]?.label, `${direction}${edgeLabel(edge)}`.trim()];
    if (!edge.auto && edge.label) parts.push(edge.label);
    if (edge.episode) parts.push(`с ${kind === "anime" ? "эпизода" : "главы"} ${edge.episode}`);
    text.append(el("small", null, parts.filter(Boolean).join(" · ")));
    if (edge.source_reference) text.append(el("small", "ux-source", `Источник: ${edge.source_reference}`));
    const dot = el("i", "ux-dot");
    dot.style.setProperty("--c", TYPES[other.type]?.color || AUTO_COLOR);
    row.append(dot, text);
    return row;
  }

  function hiddenNote(text) {
    const g = state.graph;
    if (g.mode !== "safe" || !g.hidden) return null;
    return el("p", "ux-hint", `${text} Часть сведений скрыта как спойлеры — переключите на «Полная энциклопедия», чтобы увидеть всё.`.trim());
  }

  // ==================== КАРТА ====================

  function visibleNodes() {
    const ordered = state.graph.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.center || state.types.has(node.type))
      .sort((a, b) => priority(a.node) - priority(b.node) || a.index - b.index)
      .map(({ node }) => node);
    return state.limit ? ordered.slice(0, state.limit) : ordered;
  }

  function renderMap() {
    const g = state.graph;
    if (g.nodes.length < 2) {
      panel.replaceChildren(stateBox({
        icon: "✦", title: "Связей пока нет",
        text: "В каталоге нет персонажей, создателей и связанных произведений для этой карты, а редакция ещё не добавила сведения о вселенной."
      }));
      return;
    }

    // Панель управления: поиск, типы узлов, ограничение, сброс
    const search = el("input", "input ux-search");
    search.type = "search";
    search.placeholder = "Найти на карте…";
    search.setAttribute("aria-label", "Найти узел на карте");
    search.value = state.query;
    const found = el("span", "muted small");
    found.setAttribute("aria-live", "polite");

    const filters = el("div", "ux-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Показывать на карте");
    const present = [...new Set(g.nodes.filter((node) => !node.center).map((node) => node.type))];
    for (const type of Object.keys(TYPES).filter((key) => present.includes(key))) {
      const count = g.nodes.filter((node) => !node.center && node.type === type).length;
      const chip = button("", "chip ux-type", () => {
        if (state.types.has(type)) state.types.delete(type);
        else state.types.add(type);
        chip.setAttribute("aria-pressed", String(state.types.has(type)));
        drawGraph();
      }, { pressed: state.types.has(type) });
      const swatch = el("i", "ux-dot");
      swatch.style.setProperty("--c", TYPES[type].color);
      chip.append(swatch, document.createTextNode(TYPES[type].label), el("small", null, String(count)));
      filters.append(chip);
    }

    const limit = el("select", "select ux-limit");
    limit.setAttribute("aria-label", "Сколько узлов показывать");
    for (const [value, label] of LIMITS) limit.append(new Option(label, String(value)));
    limit.value = String(state.limit);
    limit.addEventListener("change", () => {
      state.limit = Number(limit.value);
      drawGraph();
    });
    const reset = button("Сбросить", "ghost-btn small-btn", () => {
      state.types = new Set(g.nodes.map((node) => node.type));
      state.limit = 50;
      state.query = "";
      state.selected = centerNode().id;
      state.view = { k: 1, tx: 0, ty: 0 };
      state.positions.clear();
      renderMap();
    });

    const toolbar = el("div", "ux-toolbar");
    const searchBox = el("div", "ux-search-box");
    searchBox.append(search, found);
    const right = el("div", "ux-toolbar-end");
    right.append(limit, reset);
    toolbar.append(searchBox, right, filters);

    const stage = el("div", "ux-stage");
    stage.setAttribute("aria-busy", "true");
    const zoom = el("div", "ux-zoom");
    const shown = el("p", "ux-shown");
    const info = el("aside", "ux-info panel");
    info.setAttribute("aria-live", "polite");
    const layout = el("div", "ux-map");
    layout.append(stage, info);
    panel.replaceChildren(toolbar, layout, el("p", "ux-hint", "Перетаскивайте узлы и фон, колёсико или кнопки ＋ и − меняют масштаб. Нажатие на узел показывает его связи."));

    const view = svg("svg", { role: "group", "aria-label": `Карта вселенной «${g.entry.title}»` });
    const defs = svg("defs");
    const viewport = svg("g", { class: "ux-viewport" });
    const edgeLayer = svg("g");
    const nodeLayer = svg("g");
    viewport.append(edgeLayer, nodeLayer);
    view.append(defs, viewport);
    zoom.append(
      button("＋", "ux-zoom-btn", () => zoomBy(1.25), { label: "Приблизить" }),
      button("−", "ux-zoom-btn", () => zoomBy(0.8), { label: "Отдалить" }),
      button("⌂", "ux-zoom-btn", () => {
        state.view = { k: 1, tx: 0, ty: 0 };
        applyView();
      }, { label: "Вернуть вид" })
    );
    stage.append(view, zoom, shown);

    let items = [];
    let lines = [];
    let size = { width: 0, height: 0 };

    const applyView = () => {
      const { k, tx, ty } = state.view;
      viewport.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${k.toFixed(3)})`);
    };

    function zoomAt(clientX, clientY, next) {
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
      const rect = view.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      state.view.tx = px - (px - state.view.tx) * (k / state.view.k);
      state.view.ty = py - (py - state.view.ty) * (k / state.view.k);
      state.view.k = k;
      applyView();
    }

    function zoomBy(factor) {
      const rect = view.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.view.k * factor);
    }

    /** Точка экрана в координатах карты */
    function toWorld(clientX, clientY) {
      const rect = view.getBoundingClientRect();
      return { x: (clientX - rect.left - state.view.tx) / state.view.k, y: (clientY - rect.top - state.view.ty) / state.view.k };
    }

    function focusNode(node) {
      state.view.tx = size.width / 2 - node.x * state.view.k;
      state.view.ty = size.height / 2 - node.y * state.view.k;
      applyView();
    }

    // Колёсико мыши и жест двумя пальцами меняют масштаб, перетаскивание фона сдвигает карту
    view.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, state.view.k * Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });
    const pointers = new Map();
    let pan = null;
    let pinch = null;
    view.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".ux-node")) return;
      view.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) pan = { x: event.clientX, y: event.clientY, tx: state.view.tx, ty: state.view.ty };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: state.view.k };
        pan = null;
      }
    });
    view.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      } else if (pan) {
        state.view.tx = pan.tx + event.clientX - pan.x;
        state.view.ty = pan.ty + event.clientY - pan.y;
        applyView();
      }
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) pan = null;
    };
    view.addEventListener("pointerup", release);
    view.addEventListener("pointercancel", release);

    function bindNode(group, node) {
      let start = null;
      let moved = false;
      group.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        group.setPointerCapture(event.pointerId);
        start = { x: event.clientX, y: event.clientY };
        moved = false;
      });
      group.addEventListener("pointermove", (event) => {
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) moved = true;
        if (!moved) return;
        node.dragging = true;
        const point = toWorld(event.clientX, event.clientY);
        node.x = point.x;
        node.y = point.y;
        wake();
      });
      const end = () => {
        if (!start) return;
        start = null;
        node.dragging = false;
        if (!moved) select(node.id);
        wake();
      };
      group.addEventListener("pointerup", end);
      group.addEventListener("pointercancel", end);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(node.id);
        }
      });
    }

    // ---------- раскладка ----------

    function place(nodes) {
      const cx = size.width / 2;
      const cy = size.height / 2;
      const fresh = nodes.filter((node) => !state.positions.has(node.id));
      fresh.forEach((node, i) => {
        if (node.center) {
          state.positions.set(node.id, { x: cx, y: cy, vx: 0, vy: 0 });
          return;
        }
        const ring = node.type === "character" ? 0.3 : 0.44;
        const angle = (i / Math.max(fresh.length, 1)) * Math.PI * 2;
        const r = Math.min(size.width, size.height) * ring + (i % 3) * 18;
        state.positions.set(node.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 });
      });
      return nodes.map((node) => Object.assign(state.positions.get(node.id), { id: node.id, node }));
    }

    function tick(bodies, edges) {
      const cx = size.width / 2;
      const cy = size.height / 2;
      const byId = new Map(bodies.map((body) => [body.id, body]));
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.max(Math.hypot(dx, dy), 1);
          const force = 5200 / (dist * dist);
          dx /= dist;
          dy /= dist;
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
      for (const edge of edges) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const length = edge.auto ? (edge.type === "appears_in" ? 150 : 190) : 110;
        const force = (dist - length) * (edge.auto ? 0.008 : 0.02);
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
      let moved = 0;
      for (const body of bodies) {
        if (body.node.center && !body.dragging) {
          body.x += (cx - body.x) * 0.2;
          body.y += (cy - body.y) * 0.2;
        }
        if (body.node.center || body.node.dragging) {
          body.vx = body.vy = 0;
          continue;
        }
        // Слабое притяжение к центру: несвязанные узлы не улетают за край
        body.vx += (cx - body.x) * 0.0015;
        body.vy += (cy - body.y) * 0.0015;
        body.vx *= 0.8;
        body.vy *= 0.8;
        body.x += body.vx;
        body.y += body.vy;
        moved += Math.abs(body.vx) + Math.abs(body.vy);
      }
      return moved / Math.max(bodies.length, 1);
    }

    // ---------- отрисовка ----------

    let bodies = [];
    let edges = [];
    const clipIds = new Map();
    const clipFor = (r) => {
      if (!clipIds.has(r)) {
        const clip = svg("clipPath", { id: `ux-clip-${r}` });
        clip.append(svg("circle", { r }));
        defs.append(clip);
        clipIds.set(r, `ux-clip-${r}`);
      }
      return clipIds.get(r);
    };

    function drawGraph() {
      cancelAnimationFrame(simulation);
      const rect = stage.getBoundingClientRect();
      size = { width: rect.width || 800, height: rect.height || 560 };
      view.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
      const nodes = visibleNodes();
      const ids = new Set(nodes.map((node) => node.id));
      if (!ids.has(state.selected)) state.selected = centerNode().id;
      edges = g.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
      bodies = place(nodes);
      shown.textContent = `Показано ${nodes.length} из ${g.nodes.length}`;

      lines = edges.map((edge) => {
        const line = svg("line", {
          class: `ux-edge${edge.auto ? " is-auto" : ""}`,
          stroke: edge.auto ? AUTO_COLOR : RELATION_COLORS[edge.type] || AUTO_COLOR,
          "stroke-width": edge.auto ? 1.2 : 2.4
        });
        const title = svg("title");
        title.textContent = `${nodeById(edge.source).title} — ${nodeById(edge.target).title}: ${edgeLabel(edge)}`;
        line.append(title);
        return { edge, line };
      });
      edgeLayer.replaceChildren(...lines.map(({ line }) => line));

      items = bodies.map((body) => {
        const { node } = body;
        const r = radius(node);
        const color = TYPES[node.type]?.color || AUTO_COLOR;
        const group = svg("g", { class: `ux-node${node.center ? " is-center" : ""}`, tabindex: 0, role: "button",
          "aria-label": `${node.title}. ${TYPES[node.type]?.label || ""}` });
        group.dataset.id = node.id;
        const title = svg("title");
        title.textContent = node.title;
        const halo = svg("circle", { class: "ux-halo", r: r + 6, fill: color, "fill-opacity": node.center ? 0.3 : 0.14 });
        const disc = svg("circle", { r, fill: "#15123a" });
        const letter = svg("text", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": Math.round(r * 0.8) });
        letter.textContent = (node.title.trim()[0] || "✦").toUpperCase();
        group.append(title, halo, disc, letter);
        if (node.image) {
          const image = svg("image", { href: node.image, x: -r, y: -r, width: r * 2, height: r * 2,
            preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${clipFor(r)})` });
          image.addEventListener("error", () => image.remove(), { once: true });
          group.append(image);
        }
        group.append(svg("circle", { class: "ux-ring", r, fill: "none", stroke: color, "stroke-width": node.center ? 3 : 2 }));
        const label = svg("text", { class: "ux-label", "text-anchor": "middle", y: r + 15 });
        label.textContent = short(node.title, node.center ? 32 : 20);
        group.append(label);
        bindNode(group, node);
        return { body, group, label, r, width: 0 };
      });
      nodeLayer.replaceChildren(...items.map(({ group }) => group));
      labelOrder = [...items].sort((a, b) => priority(a.body.node) - priority(b.body.node));
      applyView();
      highlight();
      markSearch();
      select(state.selected);
      stage.removeAttribute("aria-busy");
      wake();
    }

    let labelOrder = [];
    function draw() {
      const byId = new Map(bodies.map((body) => [body.id, body]));
      for (const { edge, line } of lines) {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        line.setAttribute("x1", a.x.toFixed(1));
        line.setAttribute("y1", a.y.toFixed(1));
        line.setAttribute("x2", b.x.toFixed(1));
        line.setAttribute("y2", b.y.toFixed(1));
      }
      for (const { body, group } of items) group.setAttribute("transform", `translate(${body.x.toFixed(1)} ${body.y.toFixed(1)})`);
      // Подписи, которые наложились бы на другие, прячутся: они видны при наведении, фокусе и выборе
      const taken = items.map(({ body, r }) => ({ x1: body.x - r, y1: body.y - r, x2: body.x + r, y2: body.y + r, owner: body }));
      for (const item of labelOrder) {
        if (!item.width) item.width = item.label.getComputedTextLength?.() || item.label.textContent.length * 7;
        const { x, y } = item.body;
        const box = { x1: x - item.width / 2 - 3, y1: y + item.r + 3, x2: x + item.width / 2 + 3, y2: y + item.r + 19 };
        const clash = taken.some((other) => other.owner !== item.body && box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1);
        const keep = item.body.node.center;
        item.label.classList.toggle("is-collapsed", clash && !keep);
        if (!clash || keep) taken.push({ ...box, owner: null });
      }
    }

    function wake() {
      cancelAnimationFrame(simulation);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        for (let i = 0; i < 300 && tick(bodies, edges) > 0.05; i++);
        draw();
        return;
      }
      let steps = 0;
      const loop = () => {
        const moved = tick(bodies, edges);
        draw();
        steps++;
        if (moved > 0.05 && steps < 500) simulation = requestAnimationFrame(loop);
      };
      loop();
    }

    // ---------- выбор и поиск ----------

    function highlight() {
      const lit = new Set([state.selected]);
      for (const { edge, line } of lines) {
        const on = edge.source === state.selected || edge.target === state.selected;
        line.classList.toggle("is-lit", on);
        if (on) {
          lit.add(edge.source);
          lit.add(edge.target);
        }
      }
      view.classList.toggle("ux-dim", !centerNode() || state.selected !== centerNode().id);
      for (const { body, group } of items) {
        group.classList.toggle("is-lit", lit.has(body.id));
        group.classList.toggle("is-selected", body.id === state.selected);
      }
    }

    function select(nodeId) {
      state.selected = nodeId;
      highlight();
      const node = nodeById(nodeId);
      info.replaceChildren();
      const head = el("div", "ux-info-head");
      const picture = remoteImage(node.image, "", "ux-info-image");
      const titles = el("div");
      titles.append(el("span", "eyebrow", node.role === "main" ? "Главная роль" : node.role === "supporting" ? "Второстепенная роль" : TYPES[node.type]?.label || ""),
        el("h3", null, node.title));
      head.append(picture, titles);
      info.append(head);
      if (node.description) info.append(el("p", "ux-info-text", node.description));
      const facts = [];
      if (node.episode) facts.push(`Известно с ${kind === "anime" ? "эпизода" : "главы"} ${node.episode}`);
      if (node.source) facts.push(`Источник: ${node.source}`);
      if (facts.length) info.append(el("p", "ux-source", facts.join(" · ")));
      const actions = el("div", "section-actions");
      if (node.url && !node.center) actions.append(link(node.url, "primary-btn small-btn", "Открыть страницу"));
      if (!node.center) actions.append(button("К центру", "ghost-btn small-btn", () => select(centerNode().id)));
      if (actions.childElementCount) info.append(actions);

      const list = connections(nodeId);
      info.append(el("h4", "ux-info-sub", list.length ? `Связи · ${list.length}` : "Связей на карте нет"));
      const box = el("div", "ux-links");
      box.append(...list.slice(0, 40).map((item) => connectionRow(item, (otherId) => {
        if (!visibleNodes().some((other) => other.id === otherId)) {
          // Узел скрыт фильтром или ограничением: показываем его тип и все узлы
          state.types.add(nodeById(otherId).type);
          state.limit = 0;
          limit.value = "0";
          state.selected = otherId;
          renderMap();
          return;
        }
        select(otherId);
        const body = bodies.find((item) => item.id === otherId);
        if (body) focusNode(body);
      })));
      if (list.length > 40) box.append(el("p", "muted small", `И ещё ${list.length - 40}.`));
      info.append(box);
    }

    function markSearch() {
      const query = state.query.trim().toLowerCase();
      view.classList.toggle("ux-searching", Boolean(query));
      let count = 0;
      for (const { body, group } of items) {
        const match = Boolean(query) && body.node.title.toLowerCase().includes(query);
        group.classList.toggle("is-match", match);
        if (match) count++;
      }
      found.textContent = query ? (count ? `Найдено: ${count}` : "Ничего не найдено") : "";
      return items.filter(({ group }) => group.classList.contains("is-match"));
    }

    search.addEventListener("input", () => {
      state.query = search.value;
      markSearch();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const [first] = markSearch();
      if (!first) return;
      select(first.body.id);
      focusNode(first.body);
    });

    // Перерисовка при изменении размера: позиции узлов сохраняются
    let resizeTimer = 0;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!stage.isConnected) return observer.disconnect();
        const rect = stage.getBoundingClientRect();
        if (Math.abs(rect.width - size.width) > 2 || Math.abs(rect.height - size.height) > 2) drawGraph();
      }, 200);
    });
    observer.observe(stage);
    drawGraph();
  }

  // ==================== ХРОНОЛОГИЯ ====================

  async function renderTimeline() {
    if (!state.timeline || state.timeline.mode !== state.graph.mode || state.timeline.order !== state.order) {
      panel.setAttribute("aria-busy", "true");
      panel.replaceChildren(el("div", "skeleton ux-skeleton-list"));
      const query = new URLSearchParams({ mode: state.graph.mode, order: state.order });
      const result = await api(`/api/universe/${kind}/${id}/timeline?${query}`);
      panel.removeAttribute("aria-busy");
      if (state.tab !== "timeline") return;
      if (!result.ok) {
        panel.replaceChildren(errorBox(result.data?.error || "Хронология не загрузилась.", renderTimeline));
        return;
      }
      state.timeline = result.data;
    }
    const t = state.timeline;
    const controls = el("div", "ux-toolbar");
    const order = el("div", "ux-filters");
    order.setAttribute("role", "group");
    order.setAttribute("aria-label", "Порядок событий");
    const byEpisode = button("Порядок показа", "chip", () => setOrder("episode"), { pressed: state.order === "episode" });
    const byWorld = button("Хронология мира", "chip", () => setOrder("chronology"), { pressed: state.order === "chronology" });
    byWorld.disabled = !t.hasChronology && state.order !== "chronology";
    if (byWorld.disabled) byWorld.title = "Порядок событий в мире не указан";
    order.append(byEpisode, byWorld);

    const people = new Map();
    for (const event of t.events) for (const person of event.participants) people.set(person.id, person.name);
    const who = el("select", "select ux-limit");
    who.setAttribute("aria-label", "Участник события");
    who.append(new Option("Все участники", ""), ...[...people].map(([personId, name]) => new Option(name, String(personId))));
    who.value = people.has(Number(state.character)) ? state.character : "";
    who.disabled = !people.size;
    who.addEventListener("change", () => {
      state.character = who.value;
      renderTimeline();
    });
    controls.append(order, who);

    const events = state.character ? t.events.filter((event) => event.participants.some((person) => String(person.id) === state.character)) : t.events;
    const parts = [controls];
    const hint = t.mode === "safe" && t.hidden
      ? el("p", "ux-hint", `Скрыто ${t.hidden} ${plural(t.hidden, "событие", "события", "событий")} после вашего прогресса. «Полная энциклопедия» покажет все.`)
      : null;
    if (hint) parts.push(hint);
    if (!t.events.length) {
      parts.push(stateBox({
        icon: "⌛", title: t.hidden ? "Все события — впереди" : "Событий пока нет",
        text: t.hidden
          ? `Они откроются, когда вы отметите в списке просмотренные ${kind === "anime" ? "эпизоды" : "главы"}.`
          : "Хронология появится, когда редакция добавит события с источниками. Даты и события не придумываются."
      }));
    } else if (!events.length) {
      parts.push(stateBox({ icon: "⌛", title: "Нет событий с этим участником" }));
    } else {
      const list = el("ol", "ux-timeline");
      for (const event of events) {
        const item = el("li", "ux-event");
        const mark = el("span", "ux-event-mark", event.episode ? `${kind === "anime" ? "Эп." : "Гл."} ${event.episode}` : "—");
        if (!event.episode) mark.title = `${kind === "anime" ? "Эпизод" : "Глава"} не указан${kind === "anime" ? "" : "а"}`;
        const body = el("div", "ux-event-body");
        body.append(el("h3", null, event.title));
        if (event.description) body.append(el("p", null, event.description));
        if (event.participants.length) {
          const who = el("div", "ux-people");
          who.append(...event.participants.map((person) => link(person.url, "chip", person.name)));
          body.append(who);
        }
        body.append(el("small", "ux-source", `Источник: ${event.source}`));
        item.append(mark, body);
        list.append(item);
      }
      parts.push(list);
    }
    panel.replaceChildren(...parts);
  }

  function setOrder(order) {
    if (state.order === order) return;
    state.order = order;
    renderTimeline();
  }

  // ==================== СПИСКИ ====================

  function card(node, extra = []) {
    const item = el("article", "ux-card");
    const head = el("div", "ux-card-head");
    head.append(remoteImage(node.image, "", "ux-card-image"));
    const titles = el("div");
    titles.append(node.url ? link(node.url, "ux-card-title", node.title) : el("strong", "ux-card-title", node.title), ...extra);
    head.append(titles);
    item.append(head);
    if (node.description) item.append(el("p", "ux-info-text", node.description));
    const facts = [];
    if (node.episode) facts.push(`Известно с ${kind === "anime" ? "эпизода" : "главы"} ${node.episode}`);
    if (node.source) facts.push(`Источник: ${node.source}`);
    if (facts.length) item.append(el("small", "ux-source", facts.join(" · ")));
    // Связи, которые добавила редакция, и принадлежность к вселенной
    const list = connections(node.id).filter(({ edge }) => !edge.auto);
    if (list.length) {
      const box = el("div", "ux-links");
      box.append(...list.map((entry) => connectionRow(entry, (otherId) => showOnMap(otherId))));
      item.append(box);
    }
    return item;
  }

  function showOnMap(nodeId) {
    state.selected = nodeId;
    const node = nodeById(nodeId);
    if (node) state.types.add(node.type);
    state.limit = 0;
    openTab("map");
    panel.focus({ preventScroll: true });
  }

  function cards(nodes, empty, extraFor = () => []) {
    if (!nodes.length) return stateBox(empty);
    const grid = el("div", "ux-cards");
    grid.append(...nodes.map((node) => card(node, extraFor(node))));
    return grid;
  }

  function renderCharacters() {
    const g = state.graph;
    const list = g.nodes.filter((node) => node.type === "character").sort((a, b) => (a.role === "main" ? 0 : 1) - (b.role === "main" ? 0 : 1));
    const parts = [cards(list, { icon: "☺", title: "Персонажей нет", text: "В каталоге нет персонажей этого произведения." },
      (node) => [el("small", "muted", node.role === "main" ? "Главная роль" : "Второстепенная роль")])];
    if (g.totals.characters > list.length) {
      parts.unshift(el("p", "ux-hint", `На карте ${list.length} из ${g.totals.characters} персонажей: главные и те, о ком есть сведения. Полный список — в разделе «Персонажи» выше.`));
    }
    panel.replaceChildren(...parts);
  }

  function renderEntities(type) {
    const list = state.graph.nodes.filter((node) => node.type === type);
    const label = type === "organization" ? "Организаций" : "Локаций";
    const parts = [];
    const hint = hiddenNote("");
    if (hint) parts.push(hint);
    parts.push(cards(list, {
      icon: type === "organization" ? "⚑" : "⌖", title: `${label} пока нет`,
      text: "Редакция добавляет их вручную, только с указанием источника — эпизода, главы или официального справочника."
    }));
    panel.replaceChildren(...parts);
  }

  function renderRelated() {
    const g = state.graph;
    const center = centerNode();
    const list = g.nodes.filter((node) => node.type === "work" && !node.center);
    const relation = (node) => g.edges.find((edge) => edge.type === "related" && edge.source === center.id && edge.target === node.id)?.label || "";
    const parts = [cards(list, { icon: "⧉", title: "Связанных произведений нет", text: "В каталоге нет продолжений, предысторий и адаптаций этого произведения." },
      (node) => [el("small", "muted", relation(node))])];
    if (g.totals.related > list.length) parts.unshift(el("p", "ux-hint", `Показано ${list.length} из ${g.totals.related}. Все связанные произведения — в разделе выше.`));
    panel.replaceChildren(...parts);
  }

  drawChrome();
  loadGraph();
}
