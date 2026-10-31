// GET /api/library — личная библиотека: избранное, статусы и прочитанные главы по каждому тайтлу

import { error, json } from "../../_lib/http.js";
import { currentUser } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return error("Войдите в профиль.", 401);

  const { results } = await env.DB.prepare(
    "SELECT title_id, favorite, status, chapter, updated_at FROM library WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(user.id).all();

  return json({
    items: results.map((row) => ({
      titleId: row.title_id,
      favorite: row.favorite === 1,
      status: row.status,
      chapter: row.chapter,
      updatedAt: row.updated_at
    }))
  });
}
