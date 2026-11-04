// Админка: роли пользователей и сводка сообщества.
// Только администратор: права проверяются в каждом обработчике. Каждый экспорт — маршрут, адреса в src/worker.js

import { confirmPassword, requireAdmin } from "../_lib/admin.js";
import { audit, userLabel } from "../_lib/audit.js";
import { error, json, readJson } from "../_lib/http.js";
import { ROLES } from "../_lib/roles.js";
import { getAdminUser } from "../_lib/users.js";
import { parseId } from "../_lib/validate.js";

// ==================== РОЛИ ====================

/**
 * PUT /api/admin/users/:id/role { role, password } — назначить роль user, moderator или admin.
 * Нужен пароль администратора: украденная сессия без пароля роль не выдаст
 */
export const adminUserRole = {
  async onRequestPut({ request, env, params }) {
    const { user: admin, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const target = id ? await getAdminUser(env, id) : null;
    if (!target) return error("Пользователь не найден.", 404);
    if (target.id === admin.id) return error("Свою роль изменить нельзя.", 409);
    const body = await readJson(request);
    if (!body || !ROLES.includes(body.role)) return error("Роль: user, moderator или admin.");
    if (target.blockedAt && body.role !== "user") return error("Сначала разблокируйте пользователя.", 409);
    if (target.role === body.role) return error("У пользователя уже эта роль.", 409);
    const denied = await confirmPassword(env, request, admin, body.password);
    if (denied) return denied;
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, target.id).run();
    await audit(env, admin, `user.role.${body.role}`, userLabel(target));
    return json({ user: await getAdminUser(env, target.id) });
  }
};

// ==================== СВОДКА СООБЩЕСТВА ====================

/** GET /api/admin/platform-stats — форум и пользователи: для первого экрана админки */
export const adminPlatformStats = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM threads WHERE deleted_at IS NULL) AS threads,
         (SELECT COUNT(*) FROM threads WHERE deleted_at IS NULL AND created_at >= datetime('now', '-7 days')) AS threads_week,
         (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL AND target_type = 'thread') AS comments,
         (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL AND target_type = 'thread' AND created_at >= datetime('now', '-7 days')) AS comments_week,
         (SELECT COUNT(*) FROM follows) AS follows,
         (SELECT COUNT(DISTINCT target_type || ':' || target_id) FROM reports
            WHERE status = 'open' AND target_type IN ('comment', 'thread', 'user')) AS reports_open,
         (SELECT COUNT(*) FROM users WHERE muted_until > datetime('now')) AS muted`
    ).first();
    return json(row);
  }
};
