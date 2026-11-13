// Серверный клиент Endemion Life. Stage 11.2.
// Каждый вызов выпускает свежее утверждение (никакого кэша JWT) и отправляет его только
// в заголовке Authorization. Браузер этот модуль не использует.
//
// Ошибки Life не раскрывают детали проверки: портал получает статус и код для своей логики.

import { issuePortalAssertionDetailed, lifeBaseUrl } from "./lifeAssertion.js";
import { lifeAuditEvent, LIFE_AUDIT_EVENTS } from "./lifeAudit.js";

const DEFAULT_TIMEOUT_MS = 3000;

/** Тело ошибки Life: { error: { code, message } }. Возвращаем только код. */
function errorCode(data) {
  const code = data?.error?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Запросить минимальный профиль Life для проверенной серверной сессии.
 * @param {any} env
 * @param {{ id: number|string }} user — результат currentUser/requireUser
 * @param {{ endpoint?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ ok: boolean, status: number, code: string|null, data: any }>}
 */
export async function requestLifeProfile(env, user, options = {}) {
  const {
    endpoint = "/api/portal/profile",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch
  } = options;

  const { token, jti, subHash } = await issuePortalAssertionDetailed(env, user, { endpoint });
  const url = `${lifeBaseUrl(env)}${endpoint}`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const code = errorCode(data);
      lifeAuditEvent(LIFE_AUDIT_EVENTS.requestFailed, {
        subHash,
        jti,
        endpoint,
        status: response.status,
        result: code || "error"
      });
      return { ok: false, status: response.status, code, data };
    }
    return { ok: true, status: response.status, code: null, data };
  } catch {
    // Сеть, таймаут или недоступность Life. Токен и текст ошибки не журналируем
    lifeAuditEvent(LIFE_AUDIT_EVENTS.requestFailed, {
      subHash,
      jti,
      endpoint,
      status: 0,
      result: "unavailable"
    });
    return { ok: false, status: 0, code: "UNAVAILABLE", data: null };
  }
}
