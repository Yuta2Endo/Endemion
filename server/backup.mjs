// Резервные копии базы SQLite в data/backups. Сервер делает копию перед миграциями и раз в BACKUP_HOURS часов.
// Вручную: `node server/backup.mjs` (в Docker: `docker compose exec app node server/backup.mjs`).
// Копия делается средствами SQLite и не мешает работе сайта

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { BACKUP_DIR, DB_FILE } from "./config.mjs";

const NAME = /^endemion-.+\.sqlite$/;

export async function backupDatabase(db, keep = 14) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `endemion-${stamp}.sqlite`);
  await backup(db, file);

  // Старые копии удаляются: остаются последние keep штук. Имена содержат дату, поэтому сортировка по имени — по времени
  const old = readdirSync(BACKUP_DIR).filter((name) => NAME.test(name)).sort().reverse().slice(keep);
  for (const name of old) rmSync(path.join(BACKUP_DIR, name), { force: true });
  return file;
}

export function startScheduledBackups(db, { hours, keep }) {
  if (!(hours > 0)) return null;
  const timer = setInterval(() => {
    backupDatabase(db, keep)
      .then((file) => console.log(`Резервная копия базы: ${file}`))
      .catch((err) => console.error("Резервная копия базы не создана:", err.message));
  }, hours * 60 * 60 * 1000);
  // Таймер не держит процесс: при остановке сервера он не мешает завершиться
  timer.unref();
  return timer;
}

// Запуск вручную
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const file = await backupDatabase(db, Number(process.env.BACKUP_KEEP || 14));
  db.close();
  console.log(`Резервная копия базы: ${file}`);
}
