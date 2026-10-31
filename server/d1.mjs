// База SQLite с тем же интерфейсом, что у Cloudflare D1: prepare().bind().first() / all() / run() и batch().
// Благодаря этому код в functions/ работает и на Workers, и на своём сервере без изменений

import { DatabaseSync } from "node:sqlite";

/** Значение для запроса так же, как его привязывает D1 */
function toSql(value) {
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: значение undefined нельзя передать в запрос");
  if (typeof value === "boolean") return value ? 1n : 0n;
  // Целые числа привязываются как INTEGER: без BigInt node:sqlite передал бы их как REAL
  if (Number.isSafeInteger(value)) return BigInt(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

class Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values.map(toSql));
  }

  async first(column) {
    const row = this.database.statement(this.sql).get(...this.params);
    if (!row) return null;
    return column === undefined ? { ...row } : row[column];
  }

  async all() {
    return this.allSync();
  }

  async run() {
    return this.runSync();
  }

  allSync() {
    const rows = this.database.statement(this.sql).all(...this.params);
    return { success: true, results: rows.map((row) => ({ ...row })), meta: {} };
  }

  runSync() {
    const info = this.database.statement(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  /** Возвращает ли запрос строки: SELECT и запросы с RETURNING */
  readsRows() {
    return this.database.statement(this.sql).columns().length > 0;
  }
}

export function openDatabase(file) {
  const raw = new DatabaseSync(file);
  // WAL: чтение не ждёт записи. Внешние ключи включены, как в D1: на них держатся каскадные удаления
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

  const cache = new Map();
  const database = {
    statement(sql) {
      let statement = cache.get(sql);
      if (!statement) {
        statement = raw.prepare(sql);
        cache.set(sql, statement);
      }
      return statement;
    }
  };

  return {
    raw,
    prepare: (sql) => new Statement(database, sql),
    /**
     * Все запросы в одной транзакции, как batch() в D1. Внутри нет await, поэтому запросы
     * других посетителей не вклиниваются между BEGIN и COMMIT
     */
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = statements.map((statement) => (statement.readsRows() ? statement.allSync() : statement.runSync()));
        raw.exec("COMMIT");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    close() {
      raw.close();
    }
  };
}
