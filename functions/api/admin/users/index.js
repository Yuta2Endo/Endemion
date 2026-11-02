// GET /api/admin/users — пользователи для админки: поиск по имени и почте, фильтр, постраничная выдача.
// Параметры: q, filter (all, admins, blocked), limit (до 100), offset

import { requireAdmin } from "../../../_lib/admin.js";
import { error, json } from "../../../_lib/http.js";
import { toAdminUser, USER_SELECT } from "../../../_lib/users.js";

const FILTERS = {
  all: null,
  admins: "u.role = 'admin'",
  moderators: "u.role = 'moderator'",
  blocked: "u.blocked_at IS NOT NULL"
};

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;

  const params = new URL(request.url).searchParams;
  const filter = params.get("filter") || "all";
  if (!(filter in FILTERS)) return error("Неизвестный фильтр.");
  const limit = Number(params.get("limit") || 50);
  const offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    return error("Некорректные limit или offset.");
  }

  const where = [];
  const binds = [];
  const query = (params.get("q") || "").trim().slice(0, 100);
  if (query) {
    // Почта хранится в нижнем регистре. LIKE в SQLite не различает регистр только у латиницы:
    // имя на кириллице ищется с учётом регистра
    where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    const pattern = `%${query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    binds.push(pattern, `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (FILTERS[filter]) where.push(FILTERS[filter]);
  const condition = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  const [page, count] = await env.DB.batch([
    env.DB.prepare(`${USER_SELECT}${condition} ORDER BY u.id DESC LIMIT ? OFFSET ?`).bind(Date.now(), ...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u${condition}`).bind(...binds)
  ]);
  return json({ users: page.results.map(toAdminUser), total: count.results[0].n });
}
