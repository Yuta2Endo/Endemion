// Демо-страницы глав. Сканов нет, поэтому каждая страница рисуется на сервере как SVG.
// Рисунок зависит только от тайтла, главы и номера страницы: одна и та же страница всегда выглядит одинаково

import { escapeHtml as e } from "./html.js";
import { TYPES } from "./titles.js";

// Манга листается по страницам, манхва и маньхуа читаются длинной лентой, нарезанной на части
export const PAGE_SIZES = {
  page: { width: 800, height: 1200 },
  strip: { width: 800, height: 1600 }
};

const FONT = "'Trebuchet MS', 'Segoe UI', sans-serif";
const STRIP_BG = "#0f1222";
const DEFAULT_COLORS = ["#1f2a4d", "#5d4a8a", "#e3b5c9"];

const LINES = [
  "Ты опоздал.", "Я знал, что ты придёшь.", "Это ещё не конец!", "Кто здесь?", "Не оглядывайся.",
  "Мы ведь договорились...", "Сейчас или никогда.", "Почему ты молчишь?", "Держись за меня!",
  "Я больше не отступлю.", "Ты это видел?", "Это была ловушка.", "Спасибо... правда.", "Ещё один шаг.",
  "Не смей сдаваться!", "Подожди меня!", "Так вот в чём дело.", "Я помню этот голос.", "Тише. Слышишь?",
  "Всё только начинается.", "Что?!", "Не может быть...", "Обещаю, я вернусь.", "Тебе здесь не место."
];
const NARRATION = ["Тем временем...", "Три дня спустя", "В ту же ночь", "Где-то на окраине города", "Спустя час", "Утро следующего дня"];
const SFX = ["БАХ!", "ВЖУХ", "ТУК-ТУК", "Ш-Ш-Ш", "ДЗЫНЬ!", "БУМ!", "ХРЯСЬ"];

export function pageKind(title) {
  return title.type === "manga" ? "page" : "strip";
}

/** Сколько страниц в главе: у манги 14–20 страниц, у ленты 8–12 частей */
export function pageCount(title, chapter) {
  const rnd = random(title.id, chapter, 0);
  return pageKind(title) === "page" ? 14 + Math.floor(rnd() * 7) : 8 + Math.floor(rnd() * 5);
}

export function renderPage(title, chapter, page) {
  return pageKind(title) === "page" ? mangaPage(title, chapter, page) : stripPage(title, chapter, page);
}

/** Псевдослучайные числа с зерном (mulberry32): одинаковое зерно даёт одинаковую страницу */
function random(...parts) {
  let seed = 2166136261;
  for (const part of parts) seed = Math.imul(seed ^ part, 16777619) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const between = (rnd, min, max) => min + rnd() * (max - min);
const n1 = (value) => Math.round(value * 10) / 10;

function colors(title) {
  const found = title.poster.match(/#[0-9a-f]{6}/gi) || [];
  return [...found, ...DEFAULT_COLORS].slice(0, 3);
}

function svg(width, height, background, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">` +
    `<defs>${defs}</defs><rect width="${width}" height="${height}" fill="${background}"/>${body}</svg>`;
}

function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Несколько строк текста по центру точки (cx, cy) */
function textBlock(lines, cx, cy, size, attrs) {
  const lineHeight = size * 1.2;
  const top = cy - ((lines.length - 1) * lineHeight) / 2 + size * 0.35;
  const spans = lines.map((line, i) => `<tspan x="${n1(cx)}" y="${n1(top + i * lineHeight)}">${e(line)}</tspan>`).join("");
  return `<text text-anchor="middle" font-size="${size}" ${attrs}>${spans}</text>`;
}

/** Облачко с репликой внутри прямоугольника box. Если не помещается, ничего не рисует */
function bubble(rnd, box, text, size) {
  const lines = wrap(text, 13);
  const longest = Math.max(...lines.map((line) => line.length));
  const rx = longest * size * 0.39 + 18;
  const ry = lines.length * size * 0.84 + 16;
  if (rx * 2 + 16 > box.w || ry * 2 + 48 > box.h) return "";

  const cx = between(rnd, box.x + rx + 8, box.x + box.w - rx - 8);
  const cy = between(rnd, box.y + ry + 8, box.y + box.h - ry - 40);
  const side = cx < box.x + box.w / 2 ? 1 : -1;
  const tail = `M${n1(cx + side * rx * 0.1)},${n1(cy + ry * 0.7)} L${n1(cx + side * rx * 0.55)},${n1(cy + ry + 30)} ` +
    `L${n1(cx + side * rx * 0.4)},${n1(cy + ry * 0.55)} Z`;
  return `<path d="${tail}" fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="#fff" stroke="#111" stroke-width="3"/>` +
    textBlock(lines, cx, cy, size, `font-weight="700" fill="#111"`);
}

/** Звуковой эффект крупными буквами */
function sfx(rnd, box, fill, stroke) {
  const word = pick(rnd, SFX);
  const size = Math.min(72, box.w / (word.length * 0.75));
  if (size < 30 || box.h < size + 30) return "";
  const x = n1(between(rnd, box.x + box.w * 0.35, box.x + box.w * 0.65));
  const y = n1(between(rnd, box.y + size + 10, box.y + box.h - 16));
  const angle = n1(between(rnd, -14, 14));
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${n1(size)}" font-weight="900" fill="${fill}" stroke="${stroke}" ` +
    `stroke-width="5" stroke-linejoin="round" paint-order="stroke" transform="rotate(${angle} ${x} ${y})">${e(word)}</text>`;
}

/** Линии концентрации из точки (cx, cy) */
function speedLines(rnd, cx, cy, inner, outer, color, width) {
  let d = "";
  for (let i = 0; i < 56; i++) {
    const angle = (i / 56) * Math.PI * 2 + between(rnd, -0.04, 0.04);
    const start = inner * between(rnd, 0.9, 1.5);
    d += `M${n1(cx + Math.cos(angle) * start)},${n1(cy + Math.sin(angle) * start)}L${n1(cx + Math.cos(angle) * outer)},${n1(cy + Math.sin(angle) * outer)}`;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

/** Силуэт персонажа: голова и плечи, низ стоит на bottom */
function figure(cx, bottom, head, fill) {
  const headY = bottom - head * 3.1;
  return `<circle cx="${n1(cx)}" cy="${n1(headY)}" r="${n1(head)}" fill="${fill}"/>` +
    `<path d="M${n1(cx - head * 2.3)},${n1(bottom)} Q${n1(cx - head * 2)},${n1(headY + head * 1.5)} ${n1(cx)},${n1(headY + head * 1.35)} ` +
    `Q${n1(cx + head * 2)},${n1(headY + head * 1.5)} ${n1(cx + head * 2.3)},${n1(bottom)} Z" fill="${fill}"/>`;
}

// ==================== МАНГА: ЧЁРНО-БЕЛЫЕ СТРАНИЦЫ ====================

const MANGA_DEFS =
  `<pattern id="tone" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="2.2" fill="#000" fill-opacity="0.4"/></pattern>` +
  `<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="8" fill="#000" fill-opacity="0.22"/></pattern>`;

function mangaPage(title, chapter, page) {
  const { width, height } = PAGE_SIZES.page;
  const rnd = random(title.id, chapter, page);
  const body = page === 1 ? mangaCover(rnd, title, chapter, width, height) : mangaPanels(rnd, title, width, height);
  const number = `<text x="${width / 2}" y="${height - 20}" text-anchor="middle" font-size="18" fill="#666">${page}</text>`;
  return svg(width, height, "#fff", MANGA_DEFS, body + number);
}

function mangaCover(rnd, title, chapter, width, height) {
  const lines = wrap(title.title, 16);
  return `<defs><clipPath id="cover"><rect x="28" y="28" width="${width - 56}" height="${height - 84}"/></clipPath></defs>` +
    `<rect x="28" y="28" width="${width - 56}" height="${height - 84}" fill="url(#tone)"/>` +
    `<g clip-path="url(#cover)">${speedLines(rnd, width / 2, height * 0.4, 150, 900, "#111", 3)}</g>` +
    `<circle cx="${width / 2}" cy="${height * 0.4}" r="170" fill="#fff" stroke="#111" stroke-width="5"/>` +
    `<text x="${width / 2}" y="${n1(height * 0.4 + 70)}" text-anchor="middle" font-size="200" fill="#111">${e(title.symbol)}</text>` +
    `<rect x="48" y="48" width="230" height="64" fill="#111"/>` +
    `<text x="163" y="92" text-anchor="middle" font-size="34" font-weight="900" fill="#fff">ГЛАВА ${chapter}</text>` +
    `<rect x="28" y="${height - 360}" width="${width - 56}" height="${lines.length * 62 + 100}" fill="#fff" stroke="#111" stroke-width="5"/>` +
    textBlock(lines, width / 2, height - 360 + (lines.length * 62) / 2 + 30, 52, `font-weight="900" fill="#111"`) +
    `<text x="${width / 2}" y="${height - 360 + lines.length * 62 + 78}" text-anchor="middle" font-size="22" fill="#444">${e(`Перевод: ${title.translator}`)}</text>` +
    `<rect x="28" y="28" width="${width - 56}" height="${height - 84}" fill="none" stroke="#111" stroke-width="5"/>`;
}

/** Сетка кадров: 2–4 ряда, в ряду один или два кадра разной ширины */
function mangaLayout(rnd, x, y, width, height, gap) {
  const rows = 2 + Math.floor(rnd() * 3);
  const weights = Array.from({ length: rows }, () => between(rnd, 0.7, 1.3));
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = height - gap * (rows - 1);
  const panels = [];
  let top = y;
  for (const weight of weights) {
    const rowHeight = (free * weight) / sum;
    if (rnd() < 0.5) {
      const left = (width - gap) * between(rnd, 0.35, 0.65);
      panels.push({ x, y: top, w: left, h: rowHeight }, { x: x + left + gap, y: top, w: width - gap - left, h: rowHeight });
    } else {
      panels.push({ x, y: top, w: width, h: rowHeight });
    }
    top += rowHeight + gap;
  }
  return panels;
}

function mangaArt(rnd, panel, symbol) {
  const { x, y, w, h } = panel;
  const dark = rnd() < 0.15;
  const ink = dark ? "#f2f2f2" : "#111";
  const cx = x + w * between(rnd, 0.3, 0.7);
  const cy = y + h * between(rnd, 0.3, 0.7);
  let art = `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="${dark ? "#161616" : pick(rnd, ["#fff", "#f4f4f4", "#ebebeb"])}"/>`;

  const kind = pick(rnd, ["tone", "speed", "symbol", "scene", "figure"]);
  if (kind === "tone") {
    art += `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="url(#tone)"/>` +
      `<polygon points="${n1(x)},${n1(y + h)} ${n1(x + w * 0.6)},${n1(y)} ${n1(x + w)},${n1(y)} ${n1(x + w * 0.4)},${n1(y + h)}" fill="url(#hatch)"/>`;
  } else if (kind === "speed") {
    art += speedLines(rnd, cx, cy, Math.min(w, h) * 0.18, Math.hypot(w, h), ink, 2);
  } else if (kind === "symbol") {
    const size = Math.min(w, h) * 0.55;
    art += `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(size * 0.7)}" fill="url(#tone)"/>` +
      `<text x="${n1(cx)}" y="${n1(cy + size * 0.35)}" text-anchor="middle" font-size="${n1(size)}" fill="${ink}">${e(symbol)}</text>`;
  } else if (kind === "scene") {
    const horizon = y + h * between(rnd, 0.5, 0.75);
    let points = `${n1(x)},${n1(y + h)} `;
    for (let i = 0; i <= 6; i++) points += `${n1(x + (w * i) / 6)},${n1(horizon - between(rnd, 0, h * 0.3))} `;
    points += `${n1(x + w)},${n1(y + h)}`;
    art += `<circle cx="${n1(cx)}" cy="${n1(y + h * 0.28)}" r="${n1(Math.min(w, h) * 0.12)}" fill="none" stroke="${ink}" stroke-width="3"/>` +
      `<polygon points="${points}" fill="${dark ? "#555" : "#9a9a9a"}"/>` +
      `<rect x="${n1(x)}" y="${n1(horizon)}" width="${n1(w)}" height="${n1(y + h - horizon)}" fill="url(#hatch)"/>`;
  } else {
    const head = Math.min(w, h) * between(rnd, 0.1, 0.16);
    art += `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="url(#hatch)"/>` +
      figure(cx, y + h, head, ink);
  }
  return art;
}

function mangaPanels(rnd, title, width, height) {
  const panels = mangaLayout(rnd, 28, 28, width - 56, height - 84, 16);
  let clips = "";
  let body = "";
  panels.forEach((panel, i) => {
    const rect = `x="${n1(panel.x)}" y="${n1(panel.y)}" width="${n1(panel.w)}" height="${n1(panel.h)}"`;
    clips += `<clipPath id="p${i}"><rect ${rect}/></clipPath>`;
    let content = mangaArt(rnd, panel, title.symbol);
    if (rnd() < 0.7) content += bubble(rnd, panel, pick(rnd, LINES), 22);
    if (panel.h > 380 && rnd() < 0.3) content += bubble(rnd, panel, pick(rnd, LINES), 22);
    if (rnd() < 0.12) content += sfx(rnd, panel, "#fff", "#111");
    body += `<g clip-path="url(#p${i})">${content}</g><rect ${rect} fill="none" stroke="#111" stroke-width="4"/>`;
  });
  return `<defs>${clips}</defs>${body}`;
}

// ==================== МАНХВА И МАНЬХУА: ЦВЕТНАЯ ЛЕНТА ====================

function stripDefs([c0, c1, c2]) {
  return `<linearGradient id="g0" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="0.6" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` +
    `<linearGradient id="g1" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="0.5" stop-color="${c1}"/><stop offset="1" stop-color="${c0}"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.65" stop-color="${STRIP_BG}" stop-opacity="0"/><stop offset="1" stop-color="${STRIP_BG}"/></linearGradient>`;
}

function stripPage(title, chapter, page) {
  const { width, height } = PAGE_SIZES.strip;
  const rnd = random(title.id, chapter, page);
  const palette = colors(title);
  const body = page === 1 ? stripCover(rnd, title, chapter, width, height, palette) : stripPanels(rnd, title, width, height, palette);
  return svg(width, height, STRIP_BG, stripDefs(palette), body);
}

function stripCover(rnd, title, chapter, width, height, palette) {
  const lines = wrap(title.title, 16);
  const type = TYPES[title.type];
  return `<rect width="${width}" height="${height}" fill="url(#g0)"/>` +
    `<circle cx="${width / 2}" cy="560" r="360" fill="url(#glow)"/>` +
    speedLines(rnd, width / 2, 560, 400, 900, "#fff", 1.5).replace("<path", `<path stroke-opacity="0.25"`) +
    `<text x="${width / 2}" y="660" text-anchor="middle" font-size="280" fill="#fff" fill-opacity="0.92">${e(title.symbol)}</text>` +
    `<rect width="${width}" height="${height}" fill="url(#fade)"/>` +
    `<rect x="${width / 2 - 130}" y="930" width="260" height="60" rx="30" fill="${STRIP_BG}" fill-opacity="0.75" stroke="${palette[2]}" stroke-width="2"/>` +
    `<text x="${width / 2}" y="971" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">ГЛАВА ${chapter}</text>` +
    textBlock(lines, width / 2, 1100 + ((lines.length - 1) * 74) / 2, 62, `font-weight="900" fill="#fff"`) +
    `<text x="${width / 2}" y="${1180 + lines.length * 74}" text-anchor="middle" font-size="24" fill="#c9cfe6">${e(`${type.label} · Перевод: ${title.translator}`)}</text>`;
}

function stripArt(rnd, panel, symbol) {
  const { x, y, w, h } = panel;
  const cx = x + w * between(rnd, 0.3, 0.7);
  const cy = y + h * between(rnd, 0.35, 0.6);
  let art = `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="url(#${rnd() < 0.5 ? "g0" : "g1"})"/>`;

  const kind = pick(rnd, ["sky", "figure", "symbol", "rays", "city"]);
  if (kind === "sky") {
    for (let i = 0; i < 40; i++) {
      art += `<circle cx="${n1(between(rnd, x, x + w))}" cy="${n1(between(rnd, y, y + h * 0.7))}" r="${n1(between(rnd, 1, 3))}" fill="#fff" fill-opacity="${n1(between(rnd, 0.3, 0.9))}"/>`;
    }
    art += `<circle cx="${n1(cx)}" cy="${n1(y + h * 0.3)}" r="${n1(w * 0.3)}" fill="url(#glow)"/>` +
      `<circle cx="${n1(cx)}" cy="${n1(y + h * 0.3)}" r="${n1(w * 0.08)}" fill="#fff" fill-opacity="0.9"/>`;
  } else if (kind === "figure") {
    art += `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(w * 0.45)}" fill="url(#glow)"/>` +
      figure(cx, y + h, Math.min(w, h) * between(rnd, 0.11, 0.16), "#0b0d18");
  } else if (kind === "symbol") {
    const size = Math.min(w, h) * 0.5;
    art += `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(size)}" fill="url(#glow)"/>` +
      `<text x="${n1(cx)}" y="${n1(cy + size * 0.35)}" text-anchor="middle" font-size="${n1(size)}" fill="#fff" fill-opacity="0.92">${e(symbol)}</text>`;
  } else if (kind === "rays") {
    for (let i = 0; i < 7; i++) {
      const spread = between(rnd, 0.04, 0.1) * w;
      const end = x + between(rnd, -0.2, 1.2) * w;
      art += `<polygon points="${n1(cx)},${n1(y)} ${n1(end - spread)},${n1(y + h)} ${n1(end + spread)},${n1(y + h)}" fill="#fff" fill-opacity="0.12"/>`;
    }
    art += figure(cx, y + h, Math.min(w, h) * 0.09, "#0b0d18");
  } else {
    let left = x;
    while (left < x + w) {
      const bw = between(rnd, 50, 110);
      const bh = between(rnd, h * 0.2, h * 0.6);
      art += `<rect x="${n1(left)}" y="${n1(y + h - bh)}" width="${n1(bw)}" height="${n1(bh)}" fill="#0b0d18" fill-opacity="0.88"/>`;
      for (let i = 0; i < 4; i++) {
        art += `<rect x="${n1(left + between(rnd, 8, bw - 20))}" y="${n1(y + h - bh + between(rnd, 12, bh - 20))}" width="8" height="10" fill="#f6d17d" fill-opacity="0.8"/>`;
      }
      left += bw + 4;
    }
  }
  return art;
}

function narration(rnd, x, y, width) {
  const text = pick(rnd, NARRATION);
  const boxWidth = Math.min(width, text.length * 15 + 60);
  const left = between(rnd, x, x + width - boxWidth);
  return `<rect x="${n1(left)}" y="${n1(y)}" width="${n1(boxWidth)}" height="58" rx="6" fill="#0b0d18" stroke="#f6d17d" stroke-width="2"/>` +
    `<text x="${n1(left + boxWidth / 2)}" y="${n1(y + 37)}" text-anchor="middle" font-size="24" font-style="italic" fill="#f5f7ff">${e(text)}</text>`;
}

function stripPanels(rnd, title, width, height, palette) {
  const panels = [];
  const inset = () => (rnd() < 0.5 ? { x: 60, w: width - 120, r: 18 } : { x: 0, w: width, r: 0 });
  if (rnd() < 0.4) {
    const h = between(rnd, 800, 1100);
    panels.push({ ...inset(), y: between(rnd, 200, height - h - 140), h });
  } else {
    const y1 = between(rnd, 60, 140);
    const h1 = between(rnd, 560, 680);
    const y2 = y1 + h1 + between(rnd, 160, 240);
    panels.push({ ...inset(), y: y1, h: h1 }, { ...inset(), y: y2, h: height - 60 - y2 - between(rnd, 0, 60) });
  }

  let clips = "";
  let body = "";
  panels.forEach((panel, i) => {
    const rect = `x="${n1(panel.x)}" y="${n1(panel.y)}" width="${n1(panel.w)}" height="${n1(panel.h)}" rx="${panel.r}"`;
    clips += `<clipPath id="p${i}"><rect ${rect}/></clipPath>`;
    let content = stripArt(rnd, panel, title.symbol);
    if (rnd() < 0.25) content += sfx(rnd, { x: panel.x, y: panel.y + panel.h * 0.4, w: panel.w, h: panel.h * 0.5 }, palette[2], "#0b0d18");
    body += `<g clip-path="url(#p${i})">${content}</g>`;
    // Реплики в манхве часто висят у верхнего края кадра
    if (rnd() < 0.8) body += bubble(rnd, { x: panel.x + 20, y: panel.y + 20, w: panel.w - 40, h: panel.h * 0.5 }, pick(rnd, LINES), 26);
  });

  // Подпись рассказчика: над единственным кадром или в промежутке между двумя
  if (rnd() < 0.4) {
    const y = panels.length === 2 ? panels[0].y + panels[0].h + (panels[1].y - panels[0].y - panels[0].h) / 2 - 29 : panels[0].y - 100;
    if (y > 20) body += narration(rnd, 60, y, width - 120);
  }
  return `<defs>${clips}</defs>${body}`;
}
