// Резервные копии базы SQLite в data/backups. Сервер делает копию перед миграциями и раз в BACKUP_HOURS часов.
// Если задан BACKUP_S3_BUCKET, каждая копия ещё и уходит в S3-хранилище: так она переживёт поломку сервера.
// Вручную: `node server/backup.mjs` (в Docker: `docker compose exec app node server/backup.mjs`).
// Копия делается средствами SQLite и не мешает работе сайта

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { BACKUP_DIR, DB_FILE } from "./config.mjs";
import { REMOTE_REPORT } from "./backupStatus.mjs";
import { createS3Client } from "./storage.mjs";

const NAME = /^endemion-.+\.sqlite$/;
// Папка копий внутри бакета
const S3_PREFIX = "backups/";

/**
 * Отправить копию в S3 и удалить там старые: остаются последние keep штук.
 * Ошибка отправки не отменяет копию на диске
 */
async function uploadBackup(file, env) {
  const s3 = await createS3Client(env, "BACKUP_S3_");
  if (!s3) return null;
  const { client, bucket, sdk } = s3;
  const key = `${S3_PREFIX}${path.basename(file)}`;
  await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(file), ContentType: "application/vnd.sqlite3" }));

  const keep = Number(env.BACKUP_S3_KEEP || 30);
  const keys = [];
  let token;
  do {
    const page = await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: S3_PREFIX, ContinuationToken: token }));
    for (const object of page.Contents || []) if (NAME.test(object.Key.slice(S3_PREFIX.length))) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  // Имена содержат дату, поэтому сортировка по имени — по времени
  for (const old of keys.sort().reverse().slice(keep)) {
    await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: old }));
  }
  return `s3://${bucket}/${key}`;
}

export async function backupDatabase(db, keep = 14, env = process.env) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `endemion-${stamp}.sqlite`);
  await backup(db, file);

  // Старые копии удаляются: остаются последние keep штук. Имена содержат дату, поэтому сортировка по имени — по времени
  const old = readdirSync(BACKUP_DIR).filter((name) => NAME.test(name)).sort().reverse().slice(keep);
  for (const name of old) rmSync(path.join(BACKUP_DIR, name), { force: true });

  try {
    const remote = await uploadBackup(file, env);
    if (remote) {
      console.log(`Копия отправлена в хранилище: ${remote}`);
      writeRemoteReport({ at: new Date().toISOString(), ok: true, key: remote });
    }
  } catch (err) {
    console.error("Копия не отправлена в хранилище, она осталась только на диске сервера:", err.message);
    writeRemoteReport({ at: new Date().toISOString(), ok: false, error: err.message });
  }
  return file;
}

/** Отчёт о выгрузке читает /healthz/backup: по нему видно, что копия ушла не только на диск */
function writeRemoteReport(report) {
  try {
    writeFileSync(path.join(BACKUP_DIR, REMOTE_REPORT), JSON.stringify(report));
  } catch (err) {
    console.error("Не удалось записать отчёт о выгрузке копии:", err.message);
  }
}

/** Время последней копии в миллисекундах или 0, если копий нет */
function latestBackupTime() {
  try {
    const names = readdirSync(BACKUP_DIR).filter((name) => NAME.test(name)).sort();
    return names.length ? statSync(path.join(BACKUP_DIR, names.at(-1))).mtimeMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Копия по расписанию. Срок считается от последней копии в data/backups, а не от запуска сервера:
 * иначе при каждом обновлении сайта отсчёт начинался бы заново и при частых обновлениях копий не было бы вовсе.
 * Проверка — при запуске и потом раз в час
 */
export function startScheduledBackups(db, { hours, keep }) {
  if (!(hours > 0)) return null;
  const interval = hours * 60 * 60 * 1000;
  let running = false;

  function check() {
    // Минута запаса: копия, сделанная чуть меньше чем hours назад, не откладывает следующую на целый час
    if (running || Date.now() - latestBackupTime() < interval - 60 * 1000) return;
    running = true;
    backupDatabase(db, keep)
      .then((file) => console.log(`Резервная копия базы: ${file}`))
      .catch((err) => console.error("Резервная копия базы не создана:", err.message))
      .finally(() => (running = false));
  }

  check();
  const timer = setInterval(check, 60 * 60 * 1000);
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
