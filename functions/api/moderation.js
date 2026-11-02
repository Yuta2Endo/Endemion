// Модерация: очередь жалоб пользователей, решения по контенту, ограничение публикаций, журнал модераторов.
// Доступно модераторам и администраторам. Каждый экспорт — маршрут, адреса перечислены в src/worker.js

import { error, json, readJson } from "../_lib/http.js";
import {
  CONTENT_LABELS, contentStatements, loadTarget, moderationNotice, moderationStatement, REPORT_REASONS, REPORT_TARGETS
} from "../_lib/moderation.js";
import { requireRole } from "../_lib/roles.js";
import { parseId } from "../_lib/titles.js";
import { cleanText, intParam, lengthProblem } from "../_lib/validate.js";

/** GET /api/moderation/reports?status=open — жалобы, сгруппированные по цели, с текстом контента */
export const moderationReports = {
  async onRequestGet({ request, env }) {
    const { response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const search = new URL(request.url).searchParams;
    const status = search.get("status") || "open";
    if (!["open", "resolved", "rejected"].includes(status)) return error("Неизвестный статус.");
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");

    const { results } = await env.DB.prepare(
      `SELECT r.target_type, r.target_id, COUNT(*) AS reports, MIN(r.created_at) AS first_at, MAX(r.created_at) AS last_at,
         json_group_array(json_object('id', r.id, 'reason', r.reason, 'details', r.details, 'reporter', u.name, 'createdAt', r.created_at)) AS items
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
       WHERE r.status = ? GROUP BY r.target_type, r.target_id ORDER BY reports DESC, first_at LIMIT 30 OFFSET ?`
    ).bind(status, offset).all();
    const count = await env.DB.prepare("SELECT COUNT(DISTINCT target_type || ':' || target_id) AS n FROM reports WHERE status = 'open'").first();

    const groups = await Promise.all(results.map(async (row) => {
      const target = await loadTarget(env, row.target_type, row.target_id);
      return {
        targetType: row.target_type,
        targetId: row.target_id,
        label: CONTENT_LABELS[row.target_type],
        reports: row.reports,
        firstAt: row.first_at,
        lastAt: row.last_at,
        items: JSON.parse(row.items).map((item) => ({ ...item, reasonLabel: REPORT_REASONS[item.reason] })),
        content: target ? { text: String(target.text || "").slice(0, 1000), removed: Boolean(target.removed_at), link: target.link, ownerId: target.owner_id } : null
      };
    }));
    return json({ groups, open: count.n, reasons: REPORT_REASONS });
  }
};

/**
 * POST /api/moderation/actions — решение модератора.
 * { targetType, targetId, action: "remove" | "restore" | "reject", reason, muteDays? }
 * remove — скрыть или удалить контент и закрыть жалобы, reject — жалобы необоснованны, restore — вернуть скрытое.
 * muteDays (1–30) — заодно запретить автору публиковать на этот срок
 */
export const moderationActions = {
  async onRequestPost({ request, env }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (!REPORT_TARGETS.includes(body.targetType) || !Number.isInteger(body.targetId)) return error("Укажите, что модерировать.");
    if (!["remove", "restore", "reject"].includes(body.action)) return error("Неизвестное действие.");
    const reason = cleanText(body.reason ?? "");
    const problem = lengthProblem(reason, "Причина", 0, 500);
    if (problem) return error(problem);
    const target = await loadTarget(env, body.targetType, body.targetId);
    if (!target) return error("Не найдено.", 404);

    const statements = [];
    if (body.action !== "reject") {
      if (body.targetType === "user") return error("Профили блокирует администратор в разделе «Пользователи».", 409);
      const content = contentStatements(env, user, body.targetType, body.targetId, body.action);
      if (!content) return error("Это действие недоступно для такого контента.", 409);
      statements.push(...content);
      if (body.action === "remove") {
        statements.push(...moderationNotice(env, target.owner_id,
          `Модератор скрыл ваш контент (${CONTENT_LABELS[body.targetType].toLowerCase()})${reason ? `: ${reason}` : "."}`));
      }
    }

    if (body.muteDays !== undefined && body.muteDays !== null) {
      if (!Number.isInteger(body.muteDays) || body.muteDays < 1 || body.muteDays > 30) return error("Срок ограничения: от 1 до 30 дней.");
      if (!target.owner_id) return error("У контента нет автора.", 409);
      const owner = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(target.owner_id).first();
      if (owner && owner.role !== "user") return error("Нельзя ограничить модератора или администратора.", 409);
      statements.push(
        env.DB.prepare("UPDATE users SET muted_until = datetime('now', ?) WHERE id = ?").bind(`+${body.muteDays} days`, target.owner_id),
        moderationStatement(env, user, { action: "user.mute", targetType: "user", targetId: target.owner_id, reason: `${body.muteDays} дн. ${reason}`.trim() }),
        ...moderationNotice(env, target.owner_id, `Публикации ограничены на ${body.muteDays} дн.${reason ? ` Причина: ${reason}` : ""}`)
      );
    }

    const status = body.action === "reject" ? "rejected" : "resolved";
    statements.push(
      env.DB.prepare(
        `UPDATE reports SET status = ?, resolved_by = ?, resolved_at = datetime('now')
         WHERE target_type = ? AND target_id = ? AND status = 'open'`
      ).bind(status, user.id, body.targetType, body.targetId),
      moderationStatement(env, user, {
        action: `${body.targetType}.${body.action}`, targetType: body.targetType, targetId: body.targetId, reason
      })
    );
    await env.DB.batch(statements);
    return json({ ok: true });
  }
};

/** POST /api/moderation/users/:id/unmute — снять ограничение публикаций */
export const moderationUnmute = {
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const id = parseId(params.id);
    const result = id ? await env.DB.prepare("UPDATE users SET muted_until = NULL WHERE id = ? AND muted_until IS NOT NULL").bind(id).run() : null;
    if (!result?.meta.changes) return error("Ограничений нет.", 404);
    await moderationStatement(env, user, { action: "user.unmute", targetType: "user", targetId: id }).run();
    return json({ ok: true });
  }
};

/** GET /api/moderation/log — журнал решений модераторов, новые сверху */
export const moderationLog = {
  async onRequestGet({ request, env }) {
    const { response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const offset = intParam(new URL(request.url).searchParams.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const [list, count] = await env.DB.batch([
      env.DB.prepare(
        "SELECT id, moderator_name, action, target_type, target_id, reason, created_at FROM moderation_actions ORDER BY id DESC LIMIT 50 OFFSET ?"
      ).bind(offset),
      env.DB.prepare("SELECT COUNT(*) AS n FROM moderation_actions")
    ]);
    return json({
      entries: list.results.map((row) => ({
        id: row.id, moderator: row.moderator_name, action: row.action, targetType: row.target_type, targetId: row.target_id,
        reason: row.reason, createdAt: row.created_at
      })),
      total: count.results[0].n
    });
  }
};

/** GET /api/moderation/comments — последние комментарии сообщества для просмотра модератором */
export const moderationComments = {
  async onRequestGet({ request, env }) {
    const { response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const offset = intParam(new URL(request.url).searchParams.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.body, c.target_type, c.target_id, c.created_at, c.user_id, u.name, p.username,
         (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status = 'open') AS reports
       FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN user_profiles p ON p.user_id = c.user_id
       WHERE c.deleted_at IS NULL ORDER BY c.id DESC LIMIT 50 OFFSET ?`
    ).bind(offset).all();
    return json({
      comments: results.map((row) => ({
        id: row.id, body: row.body, targetType: row.target_type, targetId: row.target_id, createdAt: row.created_at,
        author: row.user_id ? { id: row.user_id, name: row.name, username: row.username } : null, reports: row.reports
      }))
    });
  }
};
