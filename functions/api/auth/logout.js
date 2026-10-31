// POST /api/auth/logout — выйти на этом устройстве

import { json } from "../../_lib/http.js";
import { destroySession } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const setCookie = await destroySession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}
