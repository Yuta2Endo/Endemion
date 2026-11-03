// Одно соединение с SQLite на процесс. node:sqlite синхронный, поэтому запросы одного обработчика
// не перемешиваются с чужими, пока между ними нет await

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function openDatabase(file) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  return db;
}

/** Применить новые миграции. Каждая в своей транзакции: при ошибке база остаётся как до неё */
export function migrate(db, dir) {
  db.exec("CREATE TABLE IF NOT EXISTS auth_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const applied = new Set(db.prepare("SELECT name FROM auth_migrations").all().map((row) => row.name));
  const pending = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort().filter((name) => !applied.has(name));
  for (const name of pending) {
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(path.join(dir, name), "utf8"));
      db.prepare("INSERT INTO auth_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Миграция ${name} не применилась: ${err.message}`, { cause: err });
    }
  }
  return pending;
}

/** Несколько изменений одной транзакцией. fn синхронная: внутри нельзя ждать await */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
