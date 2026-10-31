// GET /api/admin/complaints — жалобы правообладателей: сначала неразобранные, внутри — новые сверху

import { requireAdmin } from "../../../_lib/admin.js";
import { COMPLAINT_COLUMNS, toComplaint } from "../../../_lib/complaints.js";
import { json } from "../../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;

  const { results } = await env.DB.prepare(
    `SELECT ${COMPLAINT_COLUMNS} FROM complaints ORDER BY status = 'new' DESC, created_at DESC, id DESC LIMIT 500`
  ).all();
  return json({ complaints: results.map(toComplaint) });
}
