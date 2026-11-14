// Ошибки браузера: клиент присылает сообщение, админ видит список в админке.
// Ничего личного не пишем: только текст ошибки, файл, строка, адрес страницы и браузер.

import { requireAdmin } from "../_lib/admin.js";
import { error, json, readJson } from "../_lib/http.js";
import { currentUser } from "../_lib/session.js";
import { cleanText, lengthProblem } from "../_lib/validate.js";

const DEDUPE_MINUTES = 5;
const LIST_LIMIT = 50;

/** POST /api/client-errors — браузер сообщает об ошибке; доступно и гостям */
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  const message = cleanText(body.message ?? "");
  const problem = lengthProblem(message, "Сообщение", 1, 500);
  if (problem) return error(problem);
  const source = cleanText(body.source ?? "").slice(0, 300) || null;
  const url = cleanText(body.url ?? "").slice(0, 300) || null;
  const line = Number.isInteger(body.line) && body.line >= 0 && body.line < 1e6 ? body.line : null;
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 300) || null;
  const user = await currentUser(env, request);

  // Одна и та же ошибка на каждом клике не нужна: пяти минут достаточно
  const recent = await env.DB.prepare(
    `SELECT 1 AS found FROM client_errors
     WHERE message = ? AND created_at > datetime('now', '-${DEDUPE_MINUTES} minutes')
     LIMIT 1`
  ).bind(message).first();
  if (recent) return json({ ok: true });

  await env.DB.prepare(
    "INSERT INTO client_errors (message, source, line, url, user_agent, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(message, source, line, url, userAgent, user?.id ?? null).run();
  return json({ ok: true });
}

/** GET /api/client-errors — сводка по ошибкам: одна строка на сообщение */
export async function onRequestGet({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  // Группируем по тексту: список нужен, чтобы увидеть проблему, а не каждое падение
  const { results } = await env.DB.prepare(
    `SELECT message, MAX(source) AS source, MAX(url) AS url, MAX(line) AS line,
            COUNT(*) AS count, MAX(created_at) AS last_at
     FROM client_errors
     GROUP BY message
     ORDER BY last_at DESC
     LIMIT ${LIST_LIMIT}`
  ).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_errors").first();
  return json({ errors: results, total: total?.n ?? 0 });
}

/** DELETE /api/client-errors — очистить журнал */
export async function onRequestDelete({ request, env }) {
  const { response } = await requireAdmin(env, request);
  if (response) return response;
  const result = await env.DB.prepare("DELETE FROM client_errors").run();
  return json({ ok: true, deleted: result.meta.changes ?? 0 });
}
