// Запуск Endemion ID: node --env-file-if-exists=.env src/server.mjs (npm start)

import path from "node:path";
import { loadConfig } from "./config.mjs";
import { createApp, createLogger } from "./app.mjs";
import { backupDatabase, latestBackupTime, openDatabase, pendingMigrations } from "./db.mjs";

const BACKUP_HOURS = Number(process.env.AUTH_BACKUP_HOURS ?? 24);
const BACKUP_KEEP = Number(process.env.AUTH_BACKUP_KEEP ?? 14);

const config = loadConfig();
const log = createLogger(config.production);
const backupDir = path.join(config.dataDir, "backups");

// Перед новыми миграциями рабочей базы — копия. Пустой новой базе копия не нужна
if (config.dbFile !== ":memory:") {
  const db = openDatabase(config.dbFile);
  const { pending, appliedCount } = pendingMigrations(db, config.migrationsDir);
  if (pending.length && appliedCount > 0) log("info", "backup before migrations", { file: await backupDatabase(db, backupDir, BACKUP_KEEP) });
  db.close();
}

const app = createApp(config, { log });

// Истёкшие сессии, коды и счётчики попыток удаляются раз в 10 минут
const cleanupTimer = setInterval(() => {
  try {
    app.cleanup();
  } catch (err) {
    log("error", "cleanup failed", { error: err.message });
  }
}, 10 * 60 * 1000);
cleanupTimer.unref();

// Копия по расписанию. Срок считается от последней копии, а не от запуска: частые перезапуски его не сбивают
if (BACKUP_HOURS > 0 && config.dbFile !== ":memory:") {
  const check = async () => {
    if (Date.now() - latestBackupTime(backupDir) < BACKUP_HOURS * 60 * 60 * 1000) return;
    try {
      log("info", "scheduled backup", { file: await backupDatabase(app.db, backupDir, BACKUP_KEEP) });
    } catch (err) {
      log("error", "backup failed", { error: err.message });
    }
  };
  void check();
  setInterval(check, 60 * 60 * 1000).unref();
}

const server = app.provider.listen(config.port, config.host, () => {
  log("info", "Endemion ID started", { issuer: config.issuer, port: config.port, clients: config.clients.map((c) => c.client_id), mail: config.mail.driver });
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
