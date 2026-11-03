// Импорт пользователей из основной базы Endemion в Auth
// Использование: node scripts/import-endemion-users.mjs

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENDEMION_DB = path.join(ROOT, "..", "data", "endemion.sqlite");
const AUTH_DB = path.join(ROOT, "..", "data", "auth.sqlite");

function importUsers() {
  console.log("Импорт пользователей Endemion в Auth...");
  console.log(`  Источник: ${ENDEMION_DB}`);
  console.log(`  Назначение: ${AUTH_DB}`);

  // Открыть обе базы
  const sourceDb = new DatabaseSync(ENDEMION_DB, { readOnly: true });
  const targetDb = new DatabaseSync(AUTH_DB);

  // Получить всех пользователей Endemion
  const users = sourceDb.prepare(`
    SELECT u.id, u.name, u.email, u.password_hash, u.created_at,
           p.username, p.avatar_version, p.avatar_color
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.blocked_at IS NULL
  `).all();

  console.log(`  Найдено пользователей: ${users.length}`);

  let imported = 0;
  let skipped = 0;

  targetDb.exec("BEGIN");

  for (const user of users) {
    // Проверить, не импортирован ли уже
    const existing = targetDb.prepare(
      "SELECT sub FROM accounts WHERE LOWER(email) = ?"
    ).get(user.email.toLowerCase());

    if (existing) {
      skipped++;
      continue;
    }

    // Создать UUID для sub
    const sub = randomUUID();

    // Avatar URL (если есть загруженный аватар)
    const avatarUrl = user.avatar_version
      ? `https://endemion.online/avatars/${user.id}?v=${user.avatar_version}`
      : null;

    // Импортировать в accounts
    targetDb.prepare(`
      INSERT INTO accounts (sub, email, email_verified_at, username, display_name, avatar_url, password_hash, legacy_password_hash, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, '', ?, ?)
    `).run(
      sub,
      user.email,
      user.username || `user${user.id}`,
      user.name,
      avatarUrl,
      user.password_hash, // PBKDF2 хеш перемещаем в legacy_password_hash
      user.created_at
    );

    // Создать связь platform_links
    targetDb.prepare(`
      INSERT INTO platform_links (account_sub, platform, platform_user_id)
      VALUES (?, 'endemion', ?)
    `).run(sub, String(user.id));

    imported++;
  }

  targetDb.exec("COMMIT");

  sourceDb.close();
  targetDb.close();

  console.log(`✓ Импортировано: ${imported}`);
  console.log(`  Пропущено (уже есть): ${skipped}`);
  console.log("\nПримечание: пароли сохранены в legacy_password_hash.");
  console.log("При первом входе они будут проверены и перехешированы в scrypt.");
}

importUsers();
