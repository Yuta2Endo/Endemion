// /api/me/sessions — активные сессии текущего пользователя: список и завершение своей сессии

import { error, json, readJson } from "../../_lib/http.js";
import { requireUser } from "../../_lib/roles.js";
import { sha256 } from "../../_lib/crypto.js";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(env, request);
  if (response) return response;

  const { results } = await env.DB.prepare(
    `SELECT token_hash, expires_at, created_at AS session_created_at, refreshed_at, last_ok_at, auth_time
     FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`
  ).bind(user.id, Date.now()).all();

  const currentToken = (request.headers.get("Cookie") || "").split("; ").find((part) => part.startsWith("endemion_session="));
  const currentHash = currentToken ? await sha256(currentToken.split("=")[1]) : null;

  return json({
    sessions: results.map((row) => ({
      id: row.token_hash.slice(0, 12),
      current: row.token_hash === currentHash,
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
      lastActivity: row.refreshed_at || row.session_created_at
    }))
  });
}

export async function onRequestDelete({ request, env }) {
  const { user, response } = await requireUser(env, request);
  if (response) return response;

  const body = await readJson(request);
  if (!body || typeof body.sessionId !== "string") return error("Некорректный запрос.", 400);

  // sessionId — первые 12 символов token_hash. Находим полную сессию пользователя.
  const { results } = await env.DB.prepare(
    `SELECT token_hash FROM sessions WHERE user_id = ? AND token_hash LIKE ?`
  ).bind(user.id, `${body.sessionId}%`).all();

  const target = results.find((row) => row.token_hash.startsWith(body.sessionId));
  if (!target) return error("Сессия не найдена.", 404);

  const currentToken = (request.headers.get("Cookie") || "").split("; ").find((part) => part.startsWith("endemion_session="));
  const currentHash = currentToken ? await sha256(currentToken.split("=")[1]) : null;
  if (target.token_hash === currentHash) return error("Нельзя завершить текущую сессию этим способом. Используйте выход.", 409);

  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?").bind(target.token_hash, user.id).run();
  return json({ ok: true });
}
