// Миграции базы своего сервера без запуска сайта: `npm run db:migrate`.
// Сервер (`npm start`) применяет их и сам; перед миграцией рабочей базы делается резервная копия

import { mkdirSync } from "node:fs";
import { backupDatabase } from "./backup.mjs";
import { DATA_DIR, DB_FILE, MIGRATIONS_DIR } from "./config.mjs";
import { openDatabase } from "./d1.mjs";
import { applyMigrations, pendingMigrations } from "./migrate.mjs";

mkdirSync(DATA_DIR, { recursive: true });
const db = openDatabase(DB_FILE);
const pending = pendingMigrations(db.raw, MIGRATIONS_DIR);
if (!pending.length) {
  console.log("Новых миграций нет.");
} else {
  const applied = Number(db.raw.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n);
  if (applied > 0) console.log(`Резервная копия перед миграциями: ${await backupDatabase(db.raw)}`);
  applyMigrations(db.raw, MIGRATIONS_DIR, pending);
}
db.close();
