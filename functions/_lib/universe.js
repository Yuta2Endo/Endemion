// Карта вселенной произведения и хронология событий (Universe Explorer).
// Основа карты — данные каталога (functions/_lib/catalog): персонажи, создатели, студии и связанные произведения.
// В базе хранится только то, чего в каталоге нет: организации, локации, события и связи между ними и персонажами.
// Их добавляет администратор, у каждой записи указан источник.
// Спойлеры: в режиме «без спойлеров» видно то, что зритель уже прошёл по своему списку (user_list.progress),
// и сведения без привязки к эпизоду, если они не помечены как спойлер. В режиме «полная энциклопедия» видно всё

import { getEntry, getSettings, isHidden } from "./catalog/index.js";
import { characterPath, entryPath, personPath, studioPath } from "./catalog/model.js";

export const ENTITY_TYPES = ["organization", "location", "event"];
export const RELATION_TYPES = ["friend", "family", "enemy", "rival", "mentor", "member_of", "participates_in", "located_in"];
export const SPOILER_MODES = ["safe", "full"];
export const TIMELINE_ORDERS = ["episode", "chronology"];

// Какие концы допустимы у связи: character — персонаж каталога, остальные — тип сущности
const PEOPLE = ["character"];
const SIDES = ["character", "organization"];
export const RELATION_RULES = {
  friend: { source: PEOPLE, target: PEOPLE },
  family: { source: PEOPLE, target: PEOPLE },
  mentor: { source: PEOPLE, target: PEOPLE },
  enemy: { source: SIDES, target: SIDES },
  rival: { source: SIDES, target: SIDES },
  member_of: { source: SIDES, target: ["organization"] },
  participates_in: { source: SIDES, target: ["event"] },
  located_in: { source: ["character", "organization", "event", "location"], target: ["location"] }
};
// Связи-вложенность: цепочка не может замкнуться (организация в организации, локация в локации)
export const HIERARCHY_RELATIONS = ["member_of", "located_in"];
// Связи без направления: A — друг B то же, что B — друг A
export const SYMMETRIC_RELATIONS = ["friend", "family", "enemy", "rival"];

// Сколько узлов брать из каталога: карта должна оставаться читаемой и быстрой на телефоне
export const LIMITS = { characters: 24, staff: 8, related: 12 };

const ROLE_LABELS = { main: "Главная роль", supporting: "Второстепенная роль" };

/** Прогресс зрителя по его списку и выбранный режим спойлеров */
async function viewerState(env, userId, kind, extId) {
  if (!userId) return { progress: 0, completed: false, mode: null };
  const [list, settings] = await env.DB.batch([
    env.DB.prepare("SELECT status, progress FROM user_list WHERE user_id = ? AND kind = ? AND ext_id = ?").bind(userId, kind, extId),
    env.DB.prepare("SELECT mode FROM user_spoiler_settings WHERE user_id = ? AND kind = ? AND ext_id = ?").bind(userId, kind, extId)
  ]);
  const item = list.results[0];
  return { progress: item?.progress || 0, completed: item?.status === "completed", mode: settings.results[0]?.mode || null };
}

/** Можно ли показать запись без спойлеров: её эпизод уже просмотрен, или эпизода нет и это не спойлер */
export function safeToShow(row, { progress, completed }) {
  if (completed) return true;
  if (row.episode !== null && row.episode !== undefined) return row.episode <= progress;
  return row.spoiler_level === 0;
}

async function manualRows(env, kind, extId) {
  const [entities, relations] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, entity_type, title, description, episode, chronology_order, spoiler_level, source_reference
       FROM universe_entities WHERE kind = ? AND ext_id = ? ORDER BY id`
    ).bind(kind, extId),
    env.DB.prepare(
      `SELECT id, source_type, source_id, target_type, target_id, relation_type, description, episode, spoiler_level, source_reference
       FROM universe_relations WHERE kind = ? AND ext_id = ? ORDER BY id`
    ).bind(kind, extId)
  ]);
  return { entities: entities.results, relations: relations.results };
}

const entityNodeId = (id) => `entity:${id}`;
const endpointId = (type, id) => (type === "character" ? `character:${id}` : entityNodeId(id));

/** Произведение и правило видимости для запроса. null — произведения нет или оно скрыто настройками каталога */
async function viewContext(env, viewer, kind, extId, requestedMode) {
  const entry = await getEntry(env, kind, extId);
  if (!entry || isHidden(entry, await getSettings(env))) return null;
  const state = await viewerState(env, viewer?.id, kind, extId);
  const mode = requestedMode || state.mode || "safe";
  const visible = (row) => mode === "full" || safeToShow(row, state);
  return { entry, state, mode, visible };
}

/** Карта вселенной: узлы и связи. hidden — сколько записей скрыто как спойлеры */
export async function universeGraph(env, viewer, kind, extId, requestedMode = null) {
  const view = await viewContext(env, viewer, kind, extId, requestedMode);
  if (!view) return null;
  const { entry, state, mode, visible } = view;
  const nodes = new Map();
  const edges = [];
  const add = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const workId = `work:${kind}:${extId}`;
  add({ id: workId, type: "work", title: entry.title, image: entry.poster?.small || null, url: entryPath(entry), center: true });

  const { entities, relations } = await manualRows(env, kind, extId);
  // Персонаж за пределами лимита попадает на карту, если администратор указал его в связи
  const linked = new Set(relations.flatMap((row) => [
    row.source_type === "character" ? row.source_id : null, row.target_type === "character" ? row.target_id : null
  ]));
  const characters = (entry.characters || []).filter((character, index) => index < LIMITS.characters || linked.has(character.id));
  for (const character of characters) {
    const id = `character:${character.id}`;
    add({ id, type: "character", title: character.name, image: character.image?.small || null, url: characterPath(character), role: character.role });
    edges.push({ source: id, target: workId, type: "appears_in", label: ROLE_LABELS[character.role] || "", auto: true });
  }
  for (const person of (entry.staff || []).slice(0, LIMITS.staff)) {
    const id = `person:${person.id}`;
    add({ id, type: "person", title: person.name, image: person.image?.small || null, url: personPath(person) });
    edges.push({ source: id, target: workId, type: "created", label: person.roles.join(", "), auto: true });
  }
  for (const studio of entry.studios || []) {
    const id = `studio:${studio.id}`;
    add({ id, type: "studio", title: studio.name, image: studio.image || null, url: studioPath(studio) });
    edges.push({ source: id, target: workId, type: "produced", label: "Студия", auto: true });
  }
  for (const item of (entry.related || []).slice(0, LIMITS.related)) {
    const id = `work:${item.entry.kind}:${item.entry.id}`;
    add({ id, type: "work", title: item.entry.title, image: item.entry.poster?.small || null, url: entryPath(item.entry) });
    edges.push({ source: workId, target: id, type: "related", label: item.relation, auto: true });
  }

  let hidden = 0;
  for (const row of entities) {
    if (!visible(row)) {
      hidden++;
      continue;
    }
    const id = entityNodeId(row.id);
    add({ id, type: row.entity_type, title: row.title, description: row.description, episode: row.episode, source: row.source_reference, image: null, url: null });
    edges.push({ source: id, target: workId, type: "in_universe", label: "", auto: true });
  }
  for (const row of relations) {
    const source = endpointId(row.source_type, row.source_id);
    const target = endpointId(row.target_type, row.target_id);
    // Конец связи скрыт как спойлер или не попал на карту — связь тоже не показывается
    if (!nodes.has(source) || !nodes.has(target)) continue;
    if (!visible(row)) {
      hidden++;
      continue;
    }
    edges.push({ source, target, type: row.relation_type, label: row.description, episode: row.episode, source_reference: row.source_reference, auto: false });
  }

  return {
    entry: { kind, id: extId, title: entry.title, url: entryPath(entry), units: entry.units || 0 },
    mode,
    progress: state.progress,
    completed: state.completed,
    signedIn: Boolean(viewer),
    nodes: [...nodes.values()],
    edges,
    hidden,
    totals: { characters: (entry.characters || []).length, staff: (entry.staff || []).length, related: (entry.related || []).length }
  };
}

// Неизвестное значение — в конце, при равенстве — по порядку добавления
const byNumber = (key) => (a, b) => ((a[key] ?? Infinity) - (b[key] ?? Infinity)) || a.id - b.id;

/** Хронология: события в порядке показа (episode) или мира (chronology), с участниками-персонажами */
export async function universeTimeline(env, viewer, kind, extId, requestedMode = null, order = "episode") {
  const view = await viewContext(env, viewer, kind, extId, requestedMode);
  if (!view) return null;
  const { entry, state, mode, visible } = view;
  const { entities, relations } = await manualRows(env, kind, extId);
  const characters = new Map((entry.characters || []).map((character) => [character.id, character]));
  const events = [];
  let hidden = 0;
  for (const row of entities) {
    if (row.entity_type !== "event") continue;
    if (!visible(row)) {
      hidden++;
      continue;
    }
    const participants = relations
      .filter((rel) => rel.relation_type === "participates_in" && rel.target_type === "entity" && rel.target_id === row.id &&
        rel.source_type === "character" && visible(rel))
      .map((rel) => characters.get(rel.source_id))
      .filter(Boolean)
      .map((character) => ({ id: character.id, name: character.name, url: characterPath(character), image: character.image?.small || null }));
    events.push({
      id: row.id, title: row.title, description: row.description, episode: row.episode, chronologyOrder: row.chronology_order,
      source: row.source_reference, participants
    });
  }
  events.sort(byNumber(order === "chronology" ? "chronologyOrder" : "episode"));
  return {
    mode, order, progress: state.progress, completed: state.completed, signedIn: Boolean(viewer),
    events, hidden, hasChronology: events.some((event) => event.chronologyOrder !== null)
  };
}

export async function saveSpoilerMode(env, userId, kind, extId, mode) {
  await env.DB.prepare(
    `INSERT INTO user_spoiler_settings (user_id, kind, ext_id, mode) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, kind, ext_id) DO UPDATE SET mode = excluded.mode, updated_at = datetime('now')`
  ).bind(userId, kind, extId, mode).run();
}
