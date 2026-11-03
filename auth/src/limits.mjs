// Ограничение частоты попыток (вход, регистрация, письма) и журнал событий безопасности.
// Счётчики в SQLite: переживают перезапуск, отдельный Redis не нужен

const WINDOW_MS = 15 * 60 * 1000;

// Сколько событий разрешено за 15 минут на ключ
export const LIMITS = {
  loginIp: 30,
  loginAccount: 10,
  registerIp: 10,
  mailAddress: 3,
  mailIp: 20
};

// После стольких неверных паролей подряд вход в аккаунт закрывается на LOCK_MS
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60 * 1000;

export function createLimiter(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND created_at > ?");
  const insert = db.prepare("INSERT INTO rate_events (key, created_at) VALUES (?, ?)");
  const clear = db.prepare("DELETE FROM rate_events WHERE key = ?");
  const cleanup = db.prepare("DELETE FROM rate_events WHERE created_at <= ?");

  return {
    /** true, если лимит по ключу уже исчерпан */
    exceeded(key, limit) {
      return count.get(key, Date.now() - WINDOW_MS).n >= limit;
    },
    record(key) {
      insert.run(key, Date.now());
    },
    clear(key) {
      clear.run(key);
    },
    cleanup() {
      cleanup.run(Date.now() - WINDOW_MS);
    }
  };
}

export function createAudit(db) {
  const insert = db.prepare("INSERT INTO audit_log (account_sub, event, ip, detail) VALUES (?, ?, ?, ?)");
  return (event, { sub = null, ip = null, detail = null } = {}) => {
    insert.run(sub, event, ip, detail === null ? null : String(detail).slice(0, 500));
  };
}
