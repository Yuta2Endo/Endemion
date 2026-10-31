// GET /api/titles/:id — один тайтл

import { error, json } from "../../_lib/http.js";
import { getTitle, parseId } from "../../_lib/titles.js";

export async function onRequestGet({ params, env }) {
  const id = parseId(params.id);
  const title = id ? await getTitle(env, id) : null;
  if (!title) return error("Тайтл не найден.", 404);
  return json({ title }, 200, { "Cache-Control": "public, max-age=60" });
}
