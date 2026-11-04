// Тестовый администратор: `npm run seed`. Создаётся, только если заданы SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD (см. README).
// Игры студии и категории форума добавляет миграция 0020_studio.sql, демо-данных больше нет.
// На рабочей базе (NODE_ENV=production) скрипт не запускается без SEED_ALLOW_PRODUCTION=1

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../functions/_lib/crypto.js";
import { createProfile } from "../functions/_lib/profiles.js";
import { normalizeEmail, validateEmail, validatePassword } from "../functions/_lib/validate.js";
import { DATA_DIR, DB_FILE, MIGRATIONS_DIR } from "./config.mjs";
import { openDatabase } from "./d1.mjs";
import { applyMigrations, pendingMigrations } from "./migrate.mjs";

/** Тестовый администратор из переменных окружения. Пароль не хранится нигде, кроме хеша в базе */
export async function seedAdmin(env, email, password, { log = console.log } = {}) {
  const normalized = normalizeEmail(email);
  const problem = validateEmail(normalized) || validatePassword(password);
  if (problem) throw new Error(`SEED_ADMIN_*: ${problem}`);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalized).first();
  if (existing) {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(existing.id).run();
    log(`Администратор: ${normalized} уже есть, роль admin подтверждена (пароль не меняется)`);
    return existing.id;
  }
  const row = await env.DB.prepare(
    "INSERT INTO users (name, email, password_hash, consent_at, role) VALUES (?, ?, ?, datetime('now'), 'admin') RETURNING id"
  ).bind("Администратор", normalized, await hashPassword(password)).first();
  await createProfile(env, row.id, normalized, "admin");
  log(`Администратор создан: ${normalized}`);
  return row.id;
}

// Запуск из командной строки. Тесты импортируют seedAdmin() без этого блока
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error("NODE_ENV=production: на рабочей базе seed не запускается. Если это точно нужно, задайте SEED_ALLOW_PRODUCTION=1.");
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const db = openDatabase(DB_FILE);
  applyMigrations(db.raw, MIGRATIONS_DIR, pendingMigrations(db.raw, MIGRATIONS_DIR));
  const env = { DB: db };
  try {
    if (process.env.SEED_ADMIN_EMAIL || process.env.SEED_ADMIN_PASSWORD) {
      await seedAdmin(env, process.env.SEED_ADMIN_EMAIL || "", process.env.SEED_ADMIN_PASSWORD || "");
    } else {
      console.log("Администратор не создан: задайте SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD или выдайте права командой npm run grant-admin.");
    }
    console.log(`Готово. База: ${DB_FILE}`);
  } finally {
    db.close();
  }
}
