// Перенос базы из Cloudflare D1 на свой сервер: `node server/import-d1.mjs <выгрузка.sql>`.
// Выгрузка — файл из `npm run db:backup` (backups/endemion-....sql). Запускать до первого запуска сервера:
// в базе не должно быть таблиц, иначе данные перемешались бы

import { mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, DB_FILE } from "./config.mjs";

const source = process.argv[2];
if (!source) {
  console.error("Укажите файл выгрузки: node server/import-d1.mjs backups/endemion-<дата>.sql");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
if (tables.length) {
  console.error(`В базе ${DB_FILE} уже есть таблицы. Остановите сервер и удалите файлы endemion.sqlite*, затем повторите перенос.`);
  process.exit(1);
}

const sql = readFileSync(source, "utf8");
db.exec("BEGIN");
try {
  db.exec(sql);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error(`Перенос не удался, база не изменена: ${err.message}`);
  process.exit(1);
}

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.log(`База перенесена в ${DB_FILE}`);
console.log(`Пользователей: ${count("users")}, тем форума: ${count("threads")}, миграций: ${count("d1_migrations")}`);
db.close();
