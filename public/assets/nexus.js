// ENDEMION NEXUS: интерактивная карта связей. Граф рисуется в SVG, узлы раскладывает простая силовая модель
// (притяжение по рёбрам, отталкивание узлов, центр закреплён). Библиотека не нужна: узлов не больше двух десятков.
// Узел можно перетащить, нажатие выбирает тайтл и показывает объяснение связей, двойное нажатие делает его центром

import {
  api, button, el, errorBox, getLibrary, initHeader, link, posterBackground, reasonList, stateBox, thumb, titleCard,
  titlePicker, toggleFavorite, TYPE_LABELS
} from "./app.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const stage = document.querySelector("#nexusStage");
const detail = document.querySelector("#nexusDetail");
const focusChips = document.querySelector("#focusChips");

// Цвет ребра — главная причина связи
const EDGE_COLORS = {
  relation: "#ff6fb5",
  author: "#ffd27a",
  hero: "#7fb4ff",
  plot: "#ff9ac9",
  mood: "#b69cff",
  theme: "#7be3b6",
  genre: "#8b8fd6",
  setting: "#5ec8d8",
  readers: "#f0a36b"
};
const EDGE_LABELS = {
  relation: "Связь из каталога", author: "Автор", hero: "Герой", plot: "Сюжет", mood: "Атмосфера",
  theme: "Темы", genre: "Жанры", setting: "Мир", readers: "Читают вместе"
};

let graph = null;
let centerId = null;
let selectedId = null;
let focus = "";
let library = new Map();
let simulation = null;

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// ==================== РАСКЛАДКА ====================

/** Начальные позиции: центр посередине, соседи по кругу, соседи соседей — на внешнем круге */
function initialLayout(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const levels = [[], [], []];
  for (const node of graph.nodes) levels[node.level].push(node);
  const radius = [0, Math.min(width, height) * 0.3, Math.min(width, height) * 0.44];
  levels.forEach((nodes, level) => nodes.forEach((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 + level * 0.4;
    node.x = cx + Math.cos(angle) * radius[level];
    node.y = cy + Math.sin(angle) * radius[level];
    node.vx = 0;
    node.vy = 0;
  }));
}

/** Шаг силовой модели. Возвращает суммарное движение: когда оно мало, раскладка остановилась */
function tick(width, height) {
  const nodes = graph.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Отталкивание всех пар
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const force = 8000 / (dist * dist);
      dx /= dist;
      dy /= dist;
      a.vx -= dx * force;
      a.vy -= dy * force;
      b.vx += dx * force;
      b.vy += dy * force;
    }
  }
  // Притяжение по рёбрам: чем сильнее связь, тем короче ребро
  for (const edge of graph.edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    const target = Math.max(110, 230 - edge.score * 9);
    const force = (dist - target) * 0.012;
    a.vx += (dx / dist) * force;
    a.vy += (dy / dist) * force;
    b.vx -= (dx / dist) * force;
    b.vy -= (dy / dist) * force;
  }
  let moved = 0;
  for (const node of nodes) {
    if (node.id === centerId || node.dragging) {
      if (node.id === centerId && !node.dragging) {
        node.x += (width / 2 - node.x) * 0.2;
        node.y += (height / 2 - node.y) * 0.2;
      }
      node.vx = node.vy = 0;
      continue;
    }
    node.vx *= 0.82;
    node.vy *= 0.82;
    node.x = Math.min(width - 40, Math.max(40, node.x + node.vx));
    node.y = Math.min(height - 40, Math.max(40, node.y + node.vy));
    moved += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return moved;
}

// ==================== ОТРИСОВКА ====================

function render() {
  stage.querySelector("svg")?.remove();
  stage.querySelector(".state")?.remove();
  stage.querySelector(".nexus-legend")?.remove();
  const { width, height } = stage.getBoundingClientRect();
  const view = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "Карта связей между тайтлами" });
  const defs = svg("defs");
  view.append(defs);
  const edgeLayer = svg("g");
  const nodeLayer = svg("g");
  view.append(edgeLayer, nodeLayer);
  initialLayout(width, height);

  const edgeNodes = graph.edges.map((edge) => {
    const line = svg("line", {
      class: "nexus-edge",
      stroke: EDGE_COLORS[edge.primary] || "#8b8fd6",
      "stroke-width": Math.min(1 + edge.score / 3, 5),
      "stroke-opacity": edge.source === centerId || edge.target === centerId ? 0.75 : 0.35
    });
    line.dataset.source = String(edge.source);
    line.dataset.target = String(edge.target);
    edgeLayer.append(line);
    return { edge, line };
  });

  const nodeEls = graph.nodes.map((node, index) => {
    const r = node.id === centerId ? 40 : node.level === 1 ? 28 : 21;
    const group = svg("g", { class: "nexus-node", tabindex: 0, role: "button", "aria-label": `${node.title}. ${TYPE_LABELS[node.type]}, ${node.year}` });
    group.dataset.id = String(node.id);
    const gradientId = `ng${index}`;
    const colors = (node.poster.match(/#[0-9a-f]{6}/gi) || ["#3b2a7a", "#8b5cff", "#ff6fb5"]).slice(0, 3);
    const gradient = svg("linearGradient", { id: gradientId, x1: 0, y1: 0, x2: 1, y2: 1 });
    colors.forEach((color, i) => gradient.append(svg("stop", { offset: `${(i / (colors.length - 1 || 1)) * 100}%`, "stop-color": color })));
    defs.append(gradient);
    const glow = svg("circle", { r: r + 8, fill: node.id === centerId ? "rgba(139,92,255,0.35)" : "rgba(139,92,255,0.12)" });
    const ring = svg("circle", { class: "node-ring", r, fill: `url(#${gradientId})`, stroke: "rgba(255,255,255,0.35)", "stroke-width": 1.5 });
    const symbol = svg("text", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": r * 0.85 });
    symbol.textContent = node.symbol;
    const label = svg("text", { class: "node-label", "text-anchor": "middle", y: r + 17 });
    const max = node.id === centerId ? 34 : 22;
    label.textContent = node.title.length > max ? `${node.title.slice(0, max - 1).trimEnd()}…` : node.title;
    const title = svg("title");
    title.textContent = node.title;
    group.append(title, glow, ring, symbol, label);
    nodeLayer.append(group);
    bindNode(group, node, view);
    // Чем важнее узел, тем раньше его подпись занимает место: центр, затем ближние соседи
    const priority = node.id === centerId ? 0 : node.level;
    return { node, group, label, r, priority, width: 0 };
  });
  const labelOrder = [...nodeEls].sort((a, b) => a.priority - b.priority);

  stage.append(view);
  stage.append(legend());
  stage.removeAttribute("aria-busy");

  const draw = () => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const { edge, line } of edgeNodes) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      line.setAttribute("x1", a.x.toFixed(1));
      line.setAttribute("y1", a.y.toFixed(1));
      line.setAttribute("x2", b.x.toFixed(1));
      line.setAttribute("y2", b.y.toFixed(1));
    }
    for (const { node, group } of nodeEls) group.setAttribute("transform", `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
    placeLabels();
  };

  // Подписи, которые наложились бы на уже показанные подписи или кружки, прячем —
  // они появляются при наведении, фокусе и выборе узла
  const placeLabels = () => {
    const taken = nodeEls.map(({ node, r }) => ({ x1: node.x - r, y1: node.y - r, x2: node.x + r, y2: node.y + r, node }));
    for (const item of labelOrder) {
      if (!item.width) item.width = item.label.getComputedTextLength() || item.label.textContent.length * 7;
      const box = {
        x1: item.node.x - item.width / 2 - 4,
        y1: item.node.y + item.r + 5,
        x2: item.node.x + item.width / 2 + 4,
        y2: item.node.y + item.r + 21
      };
      const clash = taken.some((other) => other.node !== item.node &&
        box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1);
      item.label.classList.toggle("is-collapsed", clash && item.priority > 0);
      if (!clash || item.priority === 0) taken.push({ ...box, node: null });
    }
  };

  cancelAnimationFrame(simulation);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let steps = 0;
  const loop = () => {
    const moved = tick(width, height);
    draw();
    steps++;
    if (moved > 0.4 && steps < 600) simulation = requestAnimationFrame(loop);
  };
  if (reduced) {
    for (let i = 0; i < 300; i++) tick(width, height);
    draw();
  } else {
    loop();
  }
  // Перетаскивание будит раскладку снова
  stage.wake = () => {
    if (reduced) return draw();
    cancelAnimationFrame(simulation);
    steps = 0;
    loop();
  };
  highlight(selectedId ?? centerId);
}

function legend() {
  const used = new Set(graph.edges.map((edge) => edge.primary));
  const box = el("div", "nexus-legend");
  box.setAttribute("aria-hidden", "true");
  for (const [kind, label] of Object.entries(EDGE_LABELS)) {
    if (!used.has(kind)) continue;
    const item = el("span");
    const swatch = el("i");
    swatch.style.setProperty("--c", EDGE_COLORS[kind]);
    item.append(swatch, document.createTextNode(label));
    box.append(item);
  }
  return box;
}

/** Перетаскивание, выбор и смена центра для узла */
function bindNode(group, node, view) {
  let start = null;
  let moved = false;
  const toLocal = (event) => {
    const point = view.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(view.getScreenCTM().inverse());
  };
  group.addEventListener("pointerdown", (event) => {
    group.setPointerCapture(event.pointerId);
    start = { x: event.clientX, y: event.clientY };
    moved = false;
    node.dragging = true;
  });
  group.addEventListener("pointermove", (event) => {
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) moved = true;
    if (!moved) return;
    const p = toLocal(event);
    node.x = p.x;
    node.y = p.y;
    stage.wake?.();
  });
  const end = () => {
    if (!start) return;
    start = null;
    node.dragging = false;
    if (!moved) select(node.id);
    stage.wake?.();
  };
  group.addEventListener("pointerup", end);
  group.addEventListener("pointercancel", end);
  group.addEventListener("dblclick", () => setCenter(node.id));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter") setCenter(node.id);
    if (event.key === " ") {
      event.preventDefault();
      select(node.id);
    }
  });
}

/** Подсветить узел и его рёбра, остальное приглушить */
function highlight(id) {
  const view = stage.querySelector("svg");
  if (!view) return;
  view.classList.toggle("nexus-dim", id !== null);
  const lit = new Set([id]);
  view.querySelectorAll(".nexus-edge").forEach((line) => {
    const on = Number(line.dataset.source) === id || Number(line.dataset.target) === id;
    line.classList.toggle("is-lit", on);
    if (on) {
      lit.add(Number(line.dataset.source));
      lit.add(Number(line.dataset.target));
    }
  });
  view.querySelectorAll(".nexus-node").forEach((group) => {
    const nodeId = Number(group.dataset.id);
    group.classList.toggle("is-lit", lit.has(nodeId));
    group.classList.toggle("is-selected", nodeId === id);
  });
}

// ==================== ПАНЕЛЬ СПРАВА ====================

function edgeBetween(a, b) {
  return graph.edges.find((edge) => (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a));
}

function select(id) {
  selectedId = id;
  highlight(id);
  const node = graph.nodes.find((item) => item.id === id);
  const center = graph.nodes.find((item) => item.id === centerId);
  detail.replaceChildren();

  const card = titleCard(node, { wide: true, library: library.get(node.id), onFavorite: toggleFavorite, description: false });
  detail.append(card);

  if (id !== centerId) {
    const edge = edgeBetween(centerId, id);
    const why = el("section", "panel");
    why.append(el("h2", null, `Почему связано с «${center.title}»`));
    why.append(edge ? reasonList(edge.reasons, 8) : el("p", "muted small", "Связь через другие тайтлы на карте."));
    const actions = el("div", "section-actions section");
    actions.append(button("◎ Сделать центром", "primary-btn small-btn", () => setCenter(id)), link(`/title/${id}`, "ghost-btn small-btn", "Страница тайтла"));
    why.append(actions);
    detail.append(why);
  }

  const neighbours = graph.edges
    .filter((edge) => edge.source === id || edge.target === id)
    .map((edge) => ({ edge, other: graph.nodes.find((item) => item.id === (edge.source === id ? edge.target : edge.source)) }))
    .sort((a, b) => b.edge.score - a.edge.score);
  const list = el("section", "panel");
  list.append(el("h2", null, id === centerId ? "Самые близкие истории" : "Связи на карте"));
  if (!neighbours.length) list.append(el("p", "muted small", "На карте нет связей с этим тайтлом."));
  const items = el("div", "related-list");
  for (const { edge, other } of neighbours.slice(0, 8)) {
    const row = button("", `related-item${other.id === selectedId ? " is-selected" : ""}`, () => select(other.id));
    const text = el("div");
    text.append(el("strong", null, other.title), reasonList(edge.reasons, 2));
    row.append(thumb(other, "picker-thumb"), text);
    items.append(row);
  }
  list.append(items);
  detail.append(list);
}

// ==================== ДАННЫЕ ====================

async function load() {
  stage.setAttribute("aria-busy", "true");
  stage.querySelector("svg")?.remove();
  stage.querySelector(".nexus-legend")?.remove();
  if (!stage.querySelector(".state")) stage.append(stateBox({ icon: "◎", text: "Строим карту…" }));
  const params = new URLSearchParams();
  if (focus) params.set("focus", focus);
  const result = await api(`/api/nexus/${centerId}?${params}`);
  stage.querySelector(".state")?.remove();
  if (!result.ok) {
    stage.append(errorBox(result.data?.error || "Карта не загрузилась.", load));
    return;
  }
  graph = result.data.graph;
  if (graph.nodes.length < 2) {
    stage.append(stateBox({ icon: "✦", title: "Связей не нашлось", text: focus ? "Попробуйте другую категорию связей." : "У этого тайтла пока нет похожих в каталоге." }));
    detail.replaceChildren();
    return;
  }
  if (!graph.nodes.some((node) => node.id === selectedId)) selectedId = centerId;
  render();
  select(selectedId);
}

function setCenter(id) {
  centerId = id;
  selectedId = id;
  const params = new URLSearchParams(location.search);
  params.set("title", String(id));
  history.replaceState(null, "", `${location.pathname}?${params}`);
  load();
}

focusChips.addEventListener("click", (event) => {
  const chip = event.target instanceof Element ? event.target.closest("[data-focus]") : null;
  if (!(chip instanceof HTMLElement)) return;
  focus = chip.dataset.focus;
  focusChips.querySelectorAll("[data-focus]").forEach((node) => node.setAttribute("aria-pressed", String(node === chip)));
  load();
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => graph && render(), 200);
});

async function init() {
  await initHeader();
  library = await getLibrary();
  const picker = titlePicker({ placeholder: "Выбрать тайтл для центра карты…", onPick: (title) => setCenter(title.id) });
  document.querySelector("#nexusPicker").append(picker.root);

  const wanted = Number(new URLSearchParams(location.search).get("title"));
  if (Number.isInteger(wanted) && wanted > 0) {
    centerId = wanted;
  } else {
    // Без выбора — самый популярный тайтл каталога
    const top = await api("/api/titles?limit=1&sort=popular");
    centerId = top.ok ? top.data.titles[0]?.id : null;
  }
  if (!centerId) {
    stage.replaceChildren(stateBox({ icon: "✦", title: "Каталог пуст", text: "Карта появится, когда в каталоге будут тайтлы." }));
    return;
  }
  selectedId = centerId;
  load();
}

init();

export { posterBackground };
