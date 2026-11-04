// API карты вселенной (Universe Explorer). Каждый экспорт — маршрут, адреса перечислены в src/worker.js:
// GET /api/universe/:kind/:id?mode= — карта, GET .../timeline?mode=&order= — хронология,
// PUT .../settings { mode } — режим спойлеров вошедшего зрителя для этого произведения

import { getEntry } from "../_lib/catalog/index.js";
import { KINDS, parseSlugId } from "../_lib/catalog/model.js";
import { clientIp, error, json, readJson } from "../_lib/http.js";
import { takeIpAction } from "../_lib/limits.js";
import { requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { saveSpoilerMode, SPOILER_MODES, TIMELINE_ORDERS, universeGraph, universeTimeline } from "../_lib/universe.js";

const NOT_FOUND = "Произведение не найдено.";

function target(params) {
  const id = parseSlugId(params.id);
  return KINDS.includes(params.kind) && id ? { kind: params.kind, id } : null;
}

/** Параметр адреса из списка допустимых. Пусто — null */
function queryParam(request, name, allowed) {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null || value === "") return { value: null };
  return allowed.includes(value) ? { value } : { problem: `Неизвестное значение ${name}.` };
}

export const graph = {
  async onRequestGet({ request, env, params }) {
    const entry = target(params);
    if (!entry) return error(NOT_FOUND, 404);
    const mode = queryParam(request, "mode", SPOILER_MODES);
    if (mode.problem) return error(mode.problem);
    // Карта может обратиться к источнику каталога: тот же лимит, что у каталога
    const limited = await takeIpAction(env, clientIp(request), "catalog");
    if (limited) return limited;
    const result = await universeGraph(env, await currentUser(env, request), entry.kind, entry.id, mode.value);
    return result ? json(result) : error(NOT_FOUND, 404);
  }
};

export const timeline = {
  async onRequestGet({ request, env, params }) {
    const entry = target(params);
    if (!entry) return error(NOT_FOUND, 404);
    const mode = queryParam(request, "mode", SPOILER_MODES);
    if (mode.problem) return error(mode.problem);
    const order = queryParam(request, "order", TIMELINE_ORDERS);
    if (order.problem) return error(order.problem);
    const limited = await takeIpAction(env, clientIp(request), "catalog");
    if (limited) return limited;
    const result = await universeTimeline(env, await currentUser(env, request), entry.kind, entry.id, mode.value, order.value || "episode");
    return result ? json(result) : error(NOT_FOUND, 404);
  }
};

export const settings = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const entry = target(params);
    if (!entry) return error(NOT_FOUND, 404);
    const body = await readJson(request);
    if (!body || !SPOILER_MODES.includes(body.mode)) return error("Режим: safe — без спойлеров, full — полная энциклопедия.");
    if (!(await getEntry(env, entry.kind, entry.id))) return error(NOT_FOUND, 404);
    await saveSpoilerMode(env, user.id, entry.kind, entry.id, body.mode);
    return json({ mode: body.mode });
  }
};
