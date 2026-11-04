// Админка Universe Explorer: организации, локации, события и связи для карты вселенной произведения.
// Только администратор. У каждой записи обязателен источник. Каждый экспорт — маршрут, адреса в src/worker.js:
// GET /api/admin/universe/:kind/:id — произведение, его персонажи, сущности и связи
// POST .../entities, PUT и DELETE /api/admin/universe/entities/:entityId
// POST .../relations, PUT и DELETE /api/admin/universe/relations/:relationId

import { audit } from "../_lib/audit.js";
import { getEntry } from "../_lib/catalog/index.js";
import { entryPath, KINDS, parseSlugId } from "../_lib/catalog/model.js";
import { error, json, readJson } from "../_lib/http.js";
import { requireRole } from "../_lib/roles.js";
import { ENTITY_TYPES, HIERARCHY_RELATIONS, RELATION_RULES, RELATION_TYPES, SYMMETRIC_RELATIONS } from "../_lib/universe.js";
import { cleanLine, cleanText, lengthProblem } from "../_lib/validate.js";

// Карта должна оставаться читаемой: больше записей на одно произведение не принимается
const MAX_ENTITIES = 300;
const MAX_RELATIONS = 1000;
const NOT_FOUND = "Произведение не найдено.";

const ENTITY_COLUMNS = "id, kind, ext_id, entity_type, title, description, episode, chronology_order, spoiler_level, source_reference, created_at, updated_at";
const RELATION_COLUMNS = "id, kind, ext_id, source_type, source_id, target_type, target_id, relation_type, description, episode, spoiler_level, source_reference, created_at";

function toEntity(row) {
  return {
    id: row.id, kind: row.kind, entryId: row.ext_id, type: row.entity_type, title: row.title, description: row.description,
    episode: row.episode, chronologyOrder: row.chronology_order, spoilerLevel: row.spoiler_level, reference: row.source_reference,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toRelation(row) {
  return {
    id: row.id, kind: row.kind, entryId: row.ext_id, type: row.relation_type,
    from: { type: row.source_type, id: row.source_id }, to: { type: row.target_type, id: row.target_id },
    description: row.description, episode: row.episode, spoilerLevel: row.spoiler_level, reference: row.source_reference,
    createdAt: row.created_at
  };
}

const isUnique = (err) => /UNIQUE constraint failed/.test(err?.message || "");

/** Целое из тела запроса. Пусто — null, ошибка — undefined */
function optionalInt(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Произведение из адреса. Возвращает { kind, id, entry } или ответ с ошибкой */
async function loadEntry(env, params) {
  const id = parseSlugId(params.id);
  if (!KINDS.includes(params.kind) || !id) return { response: error(NOT_FOUND, 404) };
  const entry = await getEntry(env, params.kind, id);
  return entry ? { kind: params.kind, id, entry } : { response: error(NOT_FOUND, 404) };
}

/** Общие поля сущности и связи: эпизод, уровень спойлера, источник, описание */
function commonFields(body, entry, descriptionMax) {
  // Номер эпизода не больше числа эпизодов (глав), если оно известно
  const episode = optionalInt(body.episode, 1, entry.units > 0 ? entry.units : 100_000);
  if (episode === undefined) {
    return { problem: entry.units > 0 ? `Эпизод: число от 1 до ${entry.units}.` : "Эпизод: целое положительное число." };
  }
  const spoilerLevel = body.spoilerLevel ?? 0;
  if (![0, 1, 2].includes(spoilerLevel)) return { problem: "Уровень спойлера: 0, 1 или 2." };
  const reference = cleanLine(body.reference);
  const description = cleanText(body.description ?? "");
  const problem = lengthProblem(reference, "Источник", 3, 300) || lengthProblem(description, "Описание", 0, descriptionMax);
  return problem ? { problem } : { episode, spoilerLevel, reference, description };
}

function entityFields(body, entry, type) {
  const common = commonFields(body, entry, 2000);
  if (common.problem) return common;
  const title = cleanLine(body.title);
  const titleProblem = lengthProblem(title, "Название", 1, 200);
  if (titleProblem) return { problem: titleProblem };
  const chronologyOrder = optionalInt(body.chronologyOrder, -1_000_000, 1_000_000);
  if (chronologyOrder === undefined) return { problem: "Порядок в хронологии: целое число." };
  if (chronologyOrder !== null && type !== "event") return { problem: "Порядок в хронологии бывает только у события." };
  return { ...common, title, chronologyOrder };
}

const entityLabel = (row) => `«${row.title}» (${row.kind} #${row.ext_id})`;

// ==================== ПРОИЗВЕДЕНИЕ ====================

export const adminUniverse = {
  async onRequestGet({ request, env, params }) {
    const { response } = await requireRole(env, request, "admin");
    if (response) return response;
    const target = await loadEntry(env, params);
    if (target.response) return target.response;
    const [entities, relations] = await env.DB.batch([
      env.DB.prepare(`SELECT ${ENTITY_COLUMNS} FROM universe_entities WHERE kind = ? AND ext_id = ? ORDER BY entity_type, title`).bind(target.kind, target.id),
      env.DB.prepare(`SELECT ${RELATION_COLUMNS} FROM universe_relations WHERE kind = ? AND ext_id = ? ORDER BY id`).bind(target.kind, target.id)
    ]);
    const { entry } = target;
    return json({
      entry: { kind: target.kind, id: target.id, url: entryPath(entry), title: entry.title, units: entry.units || 0 },
      characters: (entry.characters || []).map((character) => ({ id: character.id, name: character.name, role: character.role })),
      entities: entities.results.map(toEntity),
      relations: relations.results.map(toRelation),
      limits: { entities: MAX_ENTITIES, relations: MAX_RELATIONS }
    });
  }
};

// ==================== СУЩНОСТИ ====================

export const adminUniverseEntities = {
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const target = await loadEntry(env, params);
    if (target.response) return target.response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (!ENTITY_TYPES.includes(body.type)) return error("Тип: организация, локация или событие.");
    const fields = entityFields(body, target.entry, body.type);
    if (fields.problem) return error(fields.problem);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM universe_entities WHERE kind = ? AND ext_id = ?").bind(target.kind, target.id).first("n");
    if (count >= MAX_ENTITIES) return error(`У произведения уже ${MAX_ENTITIES} записей.`);
    let row;
    try {
      row = await env.DB.prepare(
        `INSERT INTO universe_entities (kind, ext_id, entity_type, title, description, episode, chronology_order, spoiler_level, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${ENTITY_COLUMNS}`
      ).bind(target.kind, target.id, body.type, fields.title, fields.description, fields.episode, fields.chronologyOrder,
        fields.spoilerLevel, fields.reference, user.id).first();
    } catch (err) {
      if (isUnique(err)) return error("Запись с таким типом и названием уже есть.", 409);
      throw err;
    }
    await audit(env, user, "universe.entity.create", entityLabel(row));
    return json({ entity: toEntity(row) }, 201);
  }
};

async function findEntity(env, params) {
  const id = parseSlugId(params.entityId);
  return id ? env.DB.prepare(`SELECT ${ENTITY_COLUMNS} FROM universe_entities WHERE id = ?`).bind(id).first() : null;
}

export const adminUniverseEntity = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const current = await findEntity(env, params);
    if (!current) return error("Запись не найдена.", 404);
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    // Тип не меняется: от него зависит, какие связи допустимы
    if (body.type !== undefined && body.type !== current.entity_type) return error("Тип записи изменить нельзя. Удалите её и создайте новую.");
    const entry = await getEntry(env, current.kind, current.ext_id);
    if (!entry) return error(NOT_FOUND, 404);
    const fields = entityFields(body, entry, current.entity_type);
    if (fields.problem) return error(fields.problem);
    let row;
    try {
      row = await env.DB.prepare(
        `UPDATE universe_entities SET title = ?, description = ?, episode = ?, chronology_order = ?, spoiler_level = ?, source_reference = ?,
         updated_at = datetime('now') WHERE id = ? RETURNING ${ENTITY_COLUMNS}`
      ).bind(fields.title, fields.description, fields.episode, fields.chronologyOrder, fields.spoilerLevel, fields.reference, current.id).first();
    } catch (err) {
      if (isUnique(err)) return error("Запись с таким типом и названием уже есть.", 409);
      throw err;
    }
    await audit(env, user, "universe.entity.update", entityLabel(row));
    return json({ entity: toEntity(row) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const current = await findEntity(env, params);
    if (!current) return error("Запись не найдена.", 404);
    // Связи удаляет триггер universe_entities_delete_relations
    await env.DB.prepare("DELETE FROM universe_entities WHERE id = ?").bind(current.id).run();
    await audit(env, user, "universe.entity.delete", entityLabel(current));
    return json({ ok: true });
  }
};

// ==================== СВЯЗИ ====================

/** Конец связи: { type: "character" | "entity", id }. Возвращает { side, kindOf } или текст ошибки */
async function resolveEnd(env, target, end, label) {
  if (!end || !["character", "entity"].includes(end.type) || !Number.isInteger(end.id) || end.id <= 0) return { problem: `${label}: укажите персонажа или запись.` };
  if (end.type === "character") {
    const character = (target.entry.characters || []).find((item) => item.id === end.id);
    return character ? { side: end, kindOf: "character", name: character.name } : { problem: `${label}: такого персонажа нет в этом произведении.` };
  }
  const row = await env.DB.prepare("SELECT id, entity_type, title FROM universe_entities WHERE id = ? AND kind = ? AND ext_id = ?")
    .bind(end.id, target.kind, target.id).first();
  return row ? { side: end, kindOf: row.entity_type, name: row.title } : { problem: `${label}: такой записи нет у этого произведения.` };
}

/** Замкнёт ли новая связь from → to цепочку вложенности: есть ли уже путь to → … → from по связям того же типа */
async function makesCycle(env, kind, extId, type, from, to) {
  const { results } = await env.DB.prepare(
    "SELECT source_type, source_id, target_type, target_id FROM universe_relations WHERE kind = ? AND ext_id = ? AND relation_type = ?"
  ).bind(kind, extId, type).all();
  const key = (sideType, id) => `${sideType}:${id}`;
  const next = new Map();
  for (const row of results) {
    const source = key(row.source_type, row.source_id);
    if (!next.has(source)) next.set(source, []);
    next.get(source).push(key(row.target_type, row.target_id));
  }
  const goal = key(from.type, from.id);
  const seen = new Set();
  const stack = [key(to.type, to.id)];
  while (stack.length) {
    const node = stack.pop();
    if (node === goal) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(next.get(node) || []));
  }
  return false;
}

const relationLabel = (type, from, to, kind, extId) => `${type}: ${from.name} → ${to.name} (${kind} #${extId})`;

export const adminUniverseRelations = {
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const target = await loadEntry(env, params);
    if (target.response) return target.response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (!RELATION_TYPES.includes(body.type)) return error("Неизвестный тип связи.");
    const fields = commonFields(body, target.entry, 300);
    if (fields.problem) return error(fields.problem);
    const from = await resolveEnd(env, target, body.from, "Откуда");
    if (from.problem) return error(from.problem);
    const to = await resolveEnd(env, target, body.to, "Куда");
    if (to.problem) return error(to.problem);
    if (from.side.type === to.side.type && from.side.id === to.side.id) return error("Связь записи с самой собой невозможна.");
    const rule = RELATION_RULES[body.type];
    if (!rule.source.includes(from.kindOf) || !rule.target.includes(to.kindOf)) return error("Такая связь между этими записями невозможна.");

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM universe_relations WHERE kind = ? AND ext_id = ?").bind(target.kind, target.id).first("n");
    if (count >= MAX_RELATIONS) return error(`У произведения уже ${MAX_RELATIONS} связей.`);
    if (HIERARCHY_RELATIONS.includes(body.type) && (await makesCycle(env, target.kind, target.id, body.type, from.side, to.side))) {
      return error("Связь замкнёт цепочку: запись окажется внутри самой себя.");
    }
    if (SYMMETRIC_RELATIONS.includes(body.type)) {
      const reverse = await env.DB.prepare(
        `SELECT 1 FROM universe_relations WHERE kind = ? AND ext_id = ? AND relation_type = ?
         AND source_type = ? AND source_id = ? AND target_type = ? AND target_id = ?`
      ).bind(target.kind, target.id, body.type, to.side.type, to.side.id, from.side.type, from.side.id).first();
      if (reverse) return error("Такая связь уже есть.", 409);
    }
    let row;
    try {
      row = await env.DB.prepare(
        `INSERT INTO universe_relations (kind, ext_id, source_type, source_id, target_type, target_id, relation_type, description, episode,
         spoiler_level, source_reference, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${RELATION_COLUMNS}`
      ).bind(target.kind, target.id, from.side.type, from.side.id, to.side.type, to.side.id, body.type, fields.description, fields.episode,
        fields.spoilerLevel, fields.reference, user.id).first();
    } catch (err) {
      if (isUnique(err)) return error("Такая связь уже есть.", 409);
      throw err;
    }
    await audit(env, user, "universe.relation.create", relationLabel(body.type, from, to, target.kind, target.id));
    return json({ relation: toRelation(row) }, 201);
  }
};

async function findRelation(env, params) {
  const id = parseSlugId(params.relationId);
  return id ? env.DB.prepare(`SELECT ${RELATION_COLUMNS} FROM universe_relations WHERE id = ?`).bind(id).first() : null;
}

export const adminUniverseRelation = {
  // Концы и тип связи не меняются: для этого связь удаляют и создают заново
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const current = await findRelation(env, params);
    if (!current) return error("Связь не найдена.", 404);
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    const entry = await getEntry(env, current.kind, current.ext_id);
    if (!entry) return error(NOT_FOUND, 404);
    const fields = commonFields(body, entry, 300);
    if (fields.problem) return error(fields.problem);
    const row = await env.DB.prepare(
      `UPDATE universe_relations SET description = ?, episode = ?, spoiler_level = ?, source_reference = ? WHERE id = ? RETURNING ${RELATION_COLUMNS}`
    ).bind(fields.description, fields.episode, fields.spoilerLevel, fields.reference, current.id).first();
    await audit(env, user, "universe.relation.update", `связь #${current.id} (${current.kind} #${current.ext_id})`);
    return json({ relation: toRelation(row) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "admin");
    if (response) return response;
    const current = await findRelation(env, params);
    if (!current) return error("Связь не найдена.", 404);
    await env.DB.prepare("DELETE FROM universe_relations WHERE id = ?").bind(current.id).run();
    await audit(env, user, "universe.relation.delete", `связь #${current.id} ${current.relation_type} (${current.kind} #${current.ext_id})`);
    return json({ ok: true });
  }
};
