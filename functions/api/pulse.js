// ENDEMION PULSE: уведомления, календарь выхода глав, «Продолжить чтение», учёт просмотров тайтла.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { sha256 } from "../_lib/crypto.js";
import { clientIp, error, json, readJson } from "../_lib/http.js";
import { listNotifications, markRead, unreadCount } from "../_lib/notifications.js";
import { requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { getTitle, getTitlesByIds, parseId } from "../_lib/titles.js";
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

/**
 * GET /api/calendar — календарь обновлений: главы за последние 14 дней по дням и расписание выходящих тайтлов
 * по дням недели. mine=1 — только тайтлы с полки пользователя
 */
export const calendar = {
  async onRequestGet({ request, env }) {
    const mine = new URL(request.url).searchParams.get("mine") === "1";
    let shelf = "";
    const binds = [];
    if (mine) {
      const { user, response } = await requireUser(env, request);
      if (response) return response;
      shelf = "AND EXISTS (SELECT 1 FROM library l WHERE l.title_id = c.title_id AND l.user_id = ? AND (l.status IS NULL OR l.status <> 'dropped'))";
      binds.push(user.id);
    }
    const { results: recent } = await env.DB.prepare(
      `SELECT c.title_id, c.number, c.name, c.side_story, c.released_at, date(c.released_at) AS day
       FROM chapters c WHERE c.released_at >= datetime('now', '-14 days') ${shelf}
       ORDER BY c.released_at DESC LIMIT 300`
    ).bind(...binds).all();

    const scheduleShelf = shelf.replaceAll("c.title_id", "t.id");
    const { results: scheduled } = await env.DB.prepare(
      `SELECT t.id, t.release_day FROM titles t WHERE t.status = 'ongoing' AND t.release_day IS NOT NULL ${scheduleShelf}`
    ).bind(...binds).all();

    const titles = await getTitlesByIds(env, [...recent.map((row) => row.title_id), ...scheduled.map((row) => row.id)]);
    const byId = new Map(titles.map((title) => [title.id, title]));
    const compact = (title) => ({ id: title.id, title: title.title, type: title.type, symbol: title.symbol, poster: title.poster, cover: title.cover, chapters: title.chapters });

    const days = new Map();
    for (const row of recent) {
      const title = byId.get(row.title_id);
      if (!title) continue;
      const list = days.get(row.day) || [];
      list.push({ title: compact(title), number: row.number, name: row.name, sideStory: row.side_story === 1, releasedAt: row.released_at });
      days.set(row.day, list);
    }
    const week = Array.from({ length: 7 }, (_, day) => ({ day, titles: [] }));
    for (const row of scheduled) {
      const title = byId.get(row.id);
      if (title) week[row.release_day].titles.push(compact(title));
    }
    return json({ recent: [...days].map(([day, chapters]) => ({ day, chapters })), week, mine });
  }
};

/**
 * GET /api/continue — «Продолжить чтение»: тайтлы со статусом «Читаю» или с местом в главе,
 * где есть непрочитанные главы. Сортировка — недавно читанные сверху
 */
export const continueReading = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const { results } = await env.DB.prepare(
      `SELECT l.title_id, l.chapter, l.status, l.updated_at, p.chapter AS position_chapter, p.page AS position_page, p.updated_at AS position_at
       FROM library l LEFT JOIN positions p ON p.user_id = l.user_id AND p.title_id = l.title_id
       WHERE l.user_id = ? AND (l.status = 'reading' OR p.chapter IS NOT NULL)
       ORDER BY MAX(l.updated_at, COALESCE(p.updated_at, '')) DESC LIMIT 20`
    ).bind(user.id).all();
    const titles = await getTitlesByIds(env, results.map((row) => row.title_id));
    const byId = new Map(results.map((row) => [row.title_id, row]));
    const items = titles.map((title) => {
      const row = byId.get(title.id);
      const position = row.position_chapter && row.position_chapter > row.chapter ? { chapter: row.position_chapter, page: row.position_page } : null;
      const next = position ? position.chapter : Math.min(row.chapter + 1, title.chapters);
      return {
        title,
        chapter: row.chapter,
        position,
        next: title.chapters ? next : null,
        unread: Math.max(title.chapters - row.chapter, 0),
        progress: title.chapters ? Math.round((row.chapter / title.chapters) * 100) : 0
      };
    }).filter((item) => item.unread > 0 || item.position);
    return json({ items });
  }
};

/**
 * POST /api/titles/:id/view — посещение страницы тайтла: история просмотра (для вошедших) и счётчик уникальных
 * посетителей за день. Посетитель — хеш IP, браузера и дня: сам IP не хранится
 */
export const titleView = {
  async onRequestPost({ request, env, params }) {
    const id = parseId(params.id);
    const title = id ? await getTitle(env, id) : null;
    if (!title) return error("Тайтл не найден.", 404);
    const user = await currentUser(env, request);
    const day = new Date().toISOString().slice(0, 10);
    const visitor = user ? `u${user.id}` : (await sha256(`${clientIp(request)}|${request.headers.get("User-Agent") || ""}|${day}`)).slice(0, 32);

    const statements = [
      env.DB.prepare("INSERT OR IGNORE INTO title_view_log (day, title_id, visitor) VALUES (?, ?, ?)").bind(day, id, visitor),
      // changes() — сколько строк вставил предыдущий запрос: счётчик растёт только у нового посетителя за день
      env.DB.prepare("UPDATE titles SET views = views + 1 WHERE id = ? AND changes() > 0").bind(id)
    ];
    if (user) {
      statements.push(env.DB.prepare(
        `INSERT INTO view_history (user_id, title_id, viewed_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT (user_id, title_id) DO UPDATE SET viewed_at = excluded.viewed_at`
      ).bind(user.id, id));
    }
    if (Math.random() < 0.02) statements.push(env.DB.prepare("DELETE FROM title_view_log WHERE day < date('now', '-2 days')"));
    await env.DB.batch(statements);
    return json({ ok: true });
  }
};
