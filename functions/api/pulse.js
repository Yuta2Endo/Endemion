// Уведомления: список, отметка прочитанными, число непрочитанных для значка в шапке.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { error, json, readJson } from "../_lib/http.js";
import { listNotifications, markRead, unreadCount } from "../_lib/notifications.js";
import { requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { intParam } from "../_lib/validate.js";

/** /api/notifications — список (GET ?before=&unread=1) и отметка прочитанными (POST { ids } или { all: true }) */
export const notifications = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const params = new URL(request.url).searchParams;
    const before = intParam(params.get("before"), null, 1, Number.MAX_SAFE_INTEGER);
    const limit = intParam(params.get("limit"), 30, 1, 100);
    if (limit === null) return error("Некорректный limit.");
    return json(await listNotifications(env, user.id, { before, limit, unreadOnly: params.get("unread") === "1" }));
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (body.all === true) {
      await markRead(env, user.id, null);
    } else {
      if (!Array.isArray(body.ids) || body.ids.length > 100 || !body.ids.every((id) => Number.isInteger(id) && id > 0)) {
        return error("Некорректный список уведомлений.");
      }
      await markRead(env, user.id, body.ids);
    }
    return json({ unread: await unreadCount(env, user.id) });
  }
};

/** GET /api/notifications/count — число непрочитанных для значка в шапке */
export const notificationCount = {
  async onRequestGet({ request, env }) {
    const user = await currentUser(env, request);
    return json({ unread: user ? await unreadCount(env, user.id) : 0 });
  }
};

