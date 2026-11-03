// Перенос пользователей сайта Endemion в Endemion ID.
//
//   node scripts/import-endemion-users.mjs --source ../data/endemion.sqlite --files ../data/files [--dry-run]
//
// База сайта открывается только на чтение. Перед записью делается копия auth.sqlite (data/auth/backups).
// Повторный запуск безопасен: уже перенесённые пользователи (есть запись в platform_links) пропускаются.
// Пароли переносятся хешами PBKDF2 как есть, при первом входе они заменяются на scrypt.
// Ничего не объединяется автоматически: если почта уже занята другим аккаунтом Endemion ID,
// пользователь попадает в import_conflicts и ждёт решения владельца

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { openDatabase, migrate } from "../src/db.mjs";
import { AUTH_ROOT, REPO_ROOT } from "../src/config.mjs";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EXTENSIONS = ["jpg", "png", "webp", "avif"];

/** «2026-10-31 12:00:00» из SQLite сайта → ISO с часовым поясом UTC */
function isoDate(value) {
  const date = new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Файл аватара в хранилище сайта на диске (server/storage.mjs: ключ avatars/<id>/<версия>) */
function findAvatarFile(filesDir, userId, version) {
  const base = encodeURIComponent(`avatars/${userId}/${version}`).replaceAll(".", "%2E");
  return EXTENSIONS.map((ext) => path.join(filesDir, `${base}.${ext}`)).find((file) => existsSync(file)) || null;
}

export function importEndemionUsers({ source, authDb, avatarsDir, filesDir = null, dryRun = false, log = console.log }) {
  const site = new DatabaseSync(source, { readOnly: true });
  const users = site.prepare(
    `SELECT u.id, u.name, u.email, u.password_hash, u.created_at, u.blocked_at, p.username, p.avatar_version
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ORDER BY u.id`
  ).all();
  site.close();

  const linked = authDb.prepare("SELECT 1 FROM platform_links WHERE platform = 'endemion' AND platform_user_id = ?");
  const emailOwner = authDb.prepare("SELECT sub FROM accounts WHERE email = ?");
  const usernameTaken = authDb.prepare("SELECT 1 FROM accounts WHERE username = ?");
  const insertAccount = authDb.prepare(
    `INSERT INTO accounts (sub, email, username, display_name, avatar_version, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLink = authDb.prepare("INSERT INTO platform_links (account_sub, platform, platform_user_id) VALUES (?, 'endemion', ?)");
  const insertConflict = authDb.prepare(
    `INSERT INTO import_conflicts (source, source_user_id, email, username, reason) VALUES ('endemion', ?, ?, ?, ?)
     ON CONFLICT (source, source_user_id) DO UPDATE SET reason = excluded.reason, email = excluded.email, username = excluded.username`
  );

  const report = { total: users.length, imported: 0, skipped: 0, conflicts: 0, renamed: 0, avatars: 0, avatarsMissing: 0 };
  const avatarCopies = [];

  authDb.exec("BEGIN IMMEDIATE");
  try {
    for (const user of users) {
      const id = String(user.id);
      if (linked.get(id)) {
        report.skipped++;
        continue;
      }
      const email = String(user.email).trim().toLowerCase();
      if (emailOwner.get(email)) {
        insertConflict.run(id, email, user.username, "email_taken");
        report.conflicts++;
        continue;
      }

      // Имя сайта переносится как есть. Если его уже занял другой аккаунт Endemion ID, берётся имя с номером
      let username = USERNAME_RE.test(user.username || "") ? user.username : `user${user.id}`;
      if (usernameTaken.get(username)) {
        const renamed = `${username.slice(0, 24 - String(user.id).length - 1)}_${user.id}`;
        insertConflict.run(id, email, user.username, `username_renamed:${renamed}`);
        username = renamed;
        report.renamed++;
      }

      const sub = randomUUID();
      const avatarFile = user.avatar_version && filesDir ? findAvatarFile(filesDir, user.id, user.avatar_version) : null;
      if (user.avatar_version && !avatarFile) report.avatarsMissing++;
      if (avatarFile) avatarCopies.push({ file: avatarFile, sub });

      const created = isoDate(user.created_at);
      insertAccount.run(sub, email, username, String(user.name).slice(0, 40), avatarFile ? Number(user.avatar_version) : null,
        user.password_hash, user.blocked_at ? "blocked" : "active", created, created);
      insertLink.run(sub, id);
      report.imported++;
    }

    if (dryRun) {
      authDb.exec("ROLLBACK");
    } else {
      // Файлы аватаров копируются до COMMIT: если копирование упадёт, база останется как была
      mkdirSync(avatarsDir, { recursive: true });
      for (const { file, sub } of avatarCopies) copyFileSync(file, path.join(avatarsDir, sub));
      report.avatars = avatarCopies.length;
      authDb.exec("COMMIT");
    }
  } catch (err) {
    authDb.exec("ROLLBACK");
    throw err;
  }

  log(`${dryRun ? "Пробный запуск, ничего не записано. " : ""}Пользователей на сайте: ${report.total}, перенесено: ${report.imported}, ` +
    `уже были перенесены: ${report.skipped}, конфликтов почты: ${report.conflicts}, переименовано: ${report.renamed}, ` +
    `аватаров скопировано: ${dryRun ? avatarCopies.length + " (будет)" : report.avatars}, без файла аватара: ${report.avatarsMissing}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(AUTH_ROOT, "scripts", "import-endemion-users.mjs")) {
  const { values } = parseArgs({
    options: {
      source: { type: "string", default: path.join(REPO_ROOT, "data", "endemion.sqlite") },
      files: { type: "string" },
      "dry-run": { type: "boolean", default: false }
    }
  });
  const dataDir = path.resolve(process.env.AUTH_DATA_DIR || path.join(REPO_ROOT, "data", "auth"));
  const dbFile = path.join(dataDir, "auth.sqlite");
  if (!existsSync(values.source)) {
    console.error(`Нет базы сайта: ${values.source}`);
    process.exit(1);
  }

  const authDb = openDatabase(dbFile);
  migrate(authDb, path.join(AUTH_ROOT, "migrations"));
  if (!values["dry-run"]) {
    const backups = path.join(dataDir, "backups");
    mkdirSync(backups, { recursive: true });
    const backup = path.join(backups, `auth-before-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
    authDb.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    console.log(`Копия базы Endemion ID: ${backup}`);
  }
  const report = importEndemionUsers({
    source: values.source,
    authDb,
    avatarsDir: path.join(dataDir, "avatars"),
    filesDir: values.files ? path.resolve(values.files) : null,
    dryRun: values["dry-run"]
  });
  const conflicts = authDb.prepare("SELECT source_user_id, email, username, reason FROM import_conflicts WHERE source = 'endemion' ORDER BY id").all();
  if (conflicts.length) {
    const file = path.join(dataDir, "import-conflicts.json");
    writeFileSync(file, JSON.stringify(conflicts, null, 2), { mode: 0o600 });
    console.log(`Конфликты записаны в ${file}: их нужно разобрать вручную, см. docs/ENDEMION_ACCOUNT_MIGRATION.md`);
  }
  authDb.close();
  process.exit(report.conflicts && !values["dry-run"] ? 2 : 0);
}
