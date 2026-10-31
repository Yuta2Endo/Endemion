// Миграции из migrations/ для своего сервера. Учёт тот же, что у wrangler (таблица d1_migrations),
// поэтому база, перенесённая из D1, сразу знает, какие миграции уже применены

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function pendingMigrations(db, dir) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS d1_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT UNIQUE,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
     )`
  );
  const applied = new Set(db.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name));
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).sort().filter((name) => !applied.has(name));
}

/** Каждая миграция в своей транзакции: при ошибке база остаётся как до неё */
export function applyMigrations(db, dir, names) {
  for (const name of names) {
    const sql = readFileSync(path.join(dir, name), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Миграция ${name} не применилась: ${err.message}`);
    }
    console.log(`Миграция применена: ${name}`);
  }
}
