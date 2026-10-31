// GET /api/titles — весь каталог. Каталог общий, поэтому ответ можно ненадолго кешировать

import { json } from "../../_lib/http.js";
import { listTitles } from "../../_lib/titles.js";

export async function onRequestGet({ env }) {
  return json({ titles: await listTitles(env) }, 200, { "Cache-Control": "public, max-age=60" });
}
