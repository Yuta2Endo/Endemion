// POST /api/auth/logout — выйти на этом устройстве.
// Если вход был через Endemion ID, в ответе адрес выхода у провайдера: там можно выйти и из Endemion Life

import { endemionIdEnabled, endSessionUrl } from "../../_lib/endemionId.js";
import { json } from "../../_lib/http.js";
import { currentUser, destroySession } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const user = endemionIdEnabled(env) ? await currentUser(env, request) : null;
  const setCookie = await destroySession(env, request);
  let redirect = null;
  if (user?.viaEndemionId) {
    try {
      redirect = await endSessionUrl(env, request);
    } catch (err) {
      // Провайдер недоступен: на сайте выход уже выполнен, сессия Endemion ID закончится сама
      console.error("Endemion ID: адрес выхода недоступен", err.message);
    }
  }
  return json({ ok: true, redirect }, 200, { "Set-Cookie": setCookie });
}
