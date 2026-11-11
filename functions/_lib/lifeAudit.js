// Структурированные события интеграции Endemion Life (Stage 11.2).
// Пишем только безопасные поля: хеш sub, jti, endpoint, результат. Никогда — JWT, ключи,
// заголовок Authorization, сырой sub, почту или имя пользователя.
// Отдельный модуль, чтобы не менять существующий журнал действий администраторов (audit.js).

/**
 * Одна JSON-строка на событие: её подхватывает observability Worker и сборщик логов Node.
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
export function lifeAuditEvent(event, fields) {
  const record = {
    event,
    ts: new Date().toISOString(),
    ...fields
  };
  // console.log есть и в Workers, и в Node; никаких секретов сюда не попадает по построению
  console.log(JSON.stringify(record));
}

export const LIFE_AUDIT_EVENTS = {
  assertionIssued: "life.assertion.issued",
  requestFailed: "life.request.failed"
};
