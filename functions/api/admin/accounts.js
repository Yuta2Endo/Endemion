// GET /api/admin/accounts — все аккаунты Endemion ID для админки, в том числе игроки Life, которые на сайт не заходили.
// Список отдаёт сервис auth по внутренней сети (ENDEMION_ID_INTERNAL_URL) с секретом AUTH_ADMIN_TOKEN.
// Параметры: q, platform (all, endemion, endemion_life, none), limit (до 100), offset

import { requireAdmin } from "../../_lib/admin.js";
import { error, json } from "../../_lib/http.js";

const PLATFORMS = ["all", "endemion", "endemion_life", "none"];
// Auth в той же сети Docker: дольше ждать нет смысла, админка покажет ошибку
const TIMEOUT_MS = 5000;

export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  if (!env.ENDEMION_ID_INTERNAL_URL || !env.AUTH_ADMIN_TOKEN) {
    return error("Список аккаунтов Endemion ID не настроен: задайте ENDEMION_ID_INTERNAL_URL и AUTH_ADMIN_TOKEN.", 503);
  }

  const params = new URL(request.url).searchParams;
  const platform = params.get("platform") || "all";
  if (!PLATFORMS.includes(platform)) return error("Неизвестный фильтр.");
  const limit = Number(params.get("limit") || 50);
  const offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    return error("Некорректные limit или offset.");
  }
  const query = (params.get("q") || "").trim().slice(0, 100);

  const url = new URL("/internal/accounts", env.ENDEMION_ID_INTERNAL_URL);
  url.search = new URLSearchParams({ platform, limit: String(limit), offset: String(offset), ...(query ? { q: query } : {}) }).toString();
  let data;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AUTH_ADMIN_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error("Endemion ID: список аккаунтов не получен", err.message);
    return error("Endemion ID не ответил. Попробуйте позже.", 502);
  }

  // Пользователь сайта, связанный с аккаунтом: по нему админка открывает его в разделе «Пользователи сайта»
  const subs = data.accounts.map((account) => account.sub);
  const linked = new Map();
  if (subs.length) {
    const rows = await env.DB.prepare(`SELECT id, endemion_sub, role, blocked_at FROM users WHERE endemion_sub IN (${subs.map(() => "?").join(", ")})`)
      .bind(...subs).all();
    for (const row of rows.results) linked.set(row.endemion_sub, { id: row.id, role: row.role, blockedAt: row.blocked_at });
  }
  return json({
    total: data.total,
    accounts: data.accounts.map((account) => ({ ...account, siteUser: linked.get(account.sub) || null }))
  });
}
