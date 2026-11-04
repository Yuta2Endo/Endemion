// /api/admin/complaints/:id — отметить результат разбора жалобы или удалить её

import { requireAdmin } from "../../../_lib/admin.js";
import { audit } from "../../../_lib/audit.js";
import { COMPLAINT_COLUMNS, COMPLAINT_STATUSES, toComplaint } from "../../../_lib/complaints.js";
import { parseId } from "../../../_lib/validate.js";
import { error, json, readJson } from "../../../_lib/http.js";

export async function onRequestPut({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;

  const id = parseId(params.id);
  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  if (!COMPLAINT_STATUSES.includes(body.status)) return error("Неизвестный статус жалобы.");

  const row = id
    ? await env.DB.prepare(`UPDATE complaints SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING ${COMPLAINT_COLUMNS}`)
      .bind(body.status, id)
      .first()
    : null;
  if (!row) return error("Жалоба не найдена.", 404);
  // В журнал попадает только номер жалобы: данные заявителя остаются в самой жалобе
  await audit(env, user, `complaint.${body.status}`, `жалоба №${id}`);
  return json({ complaint: toComplaint(row) });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(env, request);
  if (response) return response;

  const id = parseId(params.id);
  const result = id ? await env.DB.prepare("DELETE FROM complaints WHERE id = ?").bind(id).run() : null;
  if (!result?.meta.changes) return error("Жалоба не найдена.", 404);
  await audit(env, user, "complaint.delete", `жалоба №${id}`);
  return json({ ok: true });
}
