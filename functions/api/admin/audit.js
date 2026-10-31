// GET /api/admin/audit — журнал действий администраторов, новые сверху.
// Параметры: group (titles, chapters, complaints, users), limit (до 100), offset

import { requireAdmin } from "../../_lib/admin.js";
import { AUDIT_GROUPS, toAuditEntry } from "../../_lib/audit.js";
import { error, json } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;

  const params = new URL(request.url).searchParams;
  const group = params.get("group") || "";
  if (group && !AUDIT_GROUPS[group]) return error("Неизвестная группа.");
  const limit = Number(params.get("limit") || 50);
  const offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    return error("Некорректные limit или offset.");
  }

  // Префиксы групп заданы в коде, в них нет символов % и _
  const prefixes = group ? AUDIT_GROUPS[group] : [];
  const condition = prefixes.length ? ` WHERE ${prefixes.map(() => "action LIKE ?").join(" OR ")}` : "";
  const binds = prefixes.map((prefix) => `${prefix}%`);

  const [page, count] = await env.DB.batch([
    env.DB.prepare(`SELECT id, actor_name, action, target, created_at FROM audit_log${condition} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log${condition}`).bind(...binds)
  ]);
  return json({ entries: page.results.map(toAuditEntry), total: count.results[0].n });
}
