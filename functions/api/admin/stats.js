// GET /api/admin/stats — сводка для первого экрана админки: пользователи, каталог, жалобы и объём файлов в R2

import { requireAdmin } from "../../_lib/admin.js";
import { json } from "../../_lib/http.js";

// R2 отдаёт список файлов по 1000 штук. 20 страниц — до 20 000 файлов, дальше сводка показывает «больше чем»
const R2_LIST_PAGES = 20;

async function storageSize(bucket) {
  if (!bucket) return null;
  let bytes = 0;
  let files = 0;
  let cursor;
  for (let i = 0; i < R2_LIST_PAGES; i++) {
    const list = await bucket.list({ cursor, limit: 1000 });
    for (const object of list.objects) {
      bytes += object.size;
      files++;
    }
    if (!list.truncated) return { bytes, files, complete: true };
    cursor = list.cursor;
  }
  return { bytes, files, complete: false };
}

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;

  const [users, content, complaints] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(role = 'admin'), 0) AS admins, COALESCE(SUM(role = 'moderator'), 0) AS moderators, COUNT(blocked_at) AS blocked,
         COALESCE(SUM(created_at >= datetime('now', '-7 days')), 0) AS week,
         COALESCE(SUM(created_at >= datetime('now', '-30 days')), 0) AS month
       FROM users`
    ),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM titles) AS titles, (SELECT COUNT(*) FROM chapters) AS chapters,
         (SELECT COUNT(*) FROM chapters WHERE pages IS NOT NULL) AS uploaded,
         (SELECT COALESCE(SUM(pages), 0) FROM chapters) AS pages`
    ),
    env.DB.prepare("SELECT COALESCE(SUM(status = 'new'), 0) AS fresh, COUNT(*) AS total FROM complaints")
  ]);

  const c = complaints.results[0];
  return json({
    users: users.results[0],
    content: content.results[0],
    complaints: { new: c.fresh, total: c.total },
    storage: await storageSize(env.PAGES)
  });
}
