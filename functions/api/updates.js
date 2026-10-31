// GET /api/updates — тайтлы с недавно вышедшими главами

import { json } from "../_lib/http.js";
import { listTitles } from "../_lib/titles.js";

const LIMIT = 6;

export async function onRequestGet({ env }) {
  const titles = await listTitles(env, "updated");
  return json({ titles: titles.slice(0, LIMIT) }, 200, { "Cache-Control": "public, max-age=60" });
}
