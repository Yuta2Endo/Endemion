// /api/admin/users/:id — действия с пользователем: блокировка, завершение сеансов, права администратора, удаление.
// Выдача и снятие прав и удаление требуют пароль администратора. Со своим аккаунтом из админки ничего делать нельзя:
// так администратор не снимет права с себя и не останется без доступа

import { confirmPassword, requireAdmin } from "../../../_lib/admin.js";
import { audit, userLabel } from "../../../_lib/audit.js";
import { error, json, readJson } from "../../../_lib/http.js";
import { parseId } from "../../../_lib/titles.js";
import { deleteUserStatements, getAdminUser } from "../../../_lib/users.js";

const ACTIONS = new Set(["block", "unblock", "logout", "grantAdmin", "revokeAdmin"]);
const WITH_PASSWORD = new Set(["grantAdmin", "revokeAdmin"]);

/** Запросы для действия или ответ с ошибкой, если действие сейчас недоступно */
function plan(env, action, user) {
  switch (action) {
    case "block":
      if (user.isAdmin) return { problem: "Сначала снимите права администратора." };
      if (user.blockedAt) return { problem: "Пользователь уже заблокирован." };
      // Блокировка сразу завершает все сеансы и отменяет ссылки для нового пароля
      return {
        statements: [
          env.DB.prepare("UPDATE users SET blocked_at = datetime('now') WHERE id = ?").bind(user.id),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
          env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(user.id)
        ]
      };
    case "unblock":
      if (!user.blockedAt) return { problem: "Пользователь не заблокирован." };
      return { statements: [env.DB.prepare("UPDATE users SET blocked_at = NULL WHERE id = ?").bind(user.id)] };
    case "logout":
      return { statements: [env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id)] };
    case "grantAdmin":
      if (user.blockedAt) return { problem: "Сначала разблокируйте пользователя." };
      if (user.isAdmin) return { problem: "Пользователь уже администратор." };
      return { statements: [env.DB.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(user.id)] };
    case "revokeAdmin":
      if (!user.isAdmin) return { problem: "Пользователь не администратор." };
      return { statements: [env.DB.prepare("UPDATE users SET is_admin = 0 WHERE id = ?").bind(user.id)] };
    default:
      return { problem: "Неизвестное действие." };
  }
}

async function load(env, request, params) {
  const { user: admin, response } = await requireAdmin(env, request);
  if (response) return { response };
  const id = parseId(params.id);
  const user = id ? await getAdminUser(env, id) : null;
  if (!user) return { response: error("Пользователь не найден.", 404) };
  if (user.id === admin.id) return { response: error("Свой аккаунт меняйте в профиле.", 409) };
  return { admin, user };
}

export async function onRequestPut({ request, env, params }) {
  const { admin, user, response } = await load(env, request, params);
  if (response) return response;

  const body = await readJson(request);
  if (!body) return error("Некорректный запрос.");
  if (!ACTIONS.has(body.action)) return error("Неизвестное действие.");
  // Действие известно, но сейчас недоступно: например, заблокировать уже заблокированного
  const { statements, problem } = plan(env, body.action, user);
  if (problem) return error(problem, 409);
  if (WITH_PASSWORD.has(body.action)) {
    const denied = await confirmPassword(env, request, admin, body.password);
    if (denied) return denied;
  }

  await env.DB.batch(statements);
  await audit(env, admin, `user.${body.action}`, userLabel(user));
  return json({ user: await getAdminUser(env, user.id) });
}

export async function onRequestDelete({ request, env, params }) {
  const { admin, user, response } = await load(env, request, params);
  if (response) return response;
  if (user.isAdmin) return error("Сначала снимите права администратора.", 409);

  const body = await readJson(request);
  const denied = await confirmPassword(env, request, admin, body?.password);
  if (denied) return denied;

  await env.DB.batch(deleteUserStatements(env, user));
  await audit(env, admin, "user.delete", userLabel(user));
  return json({ ok: true });
}
