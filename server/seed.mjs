// Демонстрационные данные: `npm run seed`. Заполняет базу своего сервера (data/endemion.sqlite или DATA_DIR)
// тайтлами из server/seed-data.mjs: жанры, авторы, теги, персонажи, связи, главы с демо-страницами, голосования без голосов.
// Повторный запуск не дублирует данные: тайтлы с тем же названием пропускаются.
// Оценки, отзывы и голоса читателей не создаются: рейтинг читателей появляется только от людей.
//
// Тестовый администратор создаётся, только если заданы SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD (см. README).
// На рабочей базе (NODE_ENV=production) скрипт не запускается без SEED_ALLOW_PRODUCTION=1

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TITLE_COLUMNS, titleValues } from "../functions/_lib/admin.js";
import { hashPassword } from "../functions/_lib/crypto.js";
import { createProfile } from "../functions/_lib/profiles.js";
import { replaceTagsStatements, syncTaxonomyStatements } from "../functions/_lib/taxonomy.js";
import { backfillSearch } from "../functions/_lib/titles.js";
import { normalizeEmail, validateEmail, validatePassword } from "../functions/_lib/validate.js";
import { DATA_DIR, DB_FILE, MIGRATIONS_DIR } from "./config.mjs";
import { openDatabase } from "./d1.mjs";
import { applyMigrations, pendingMigrations } from "./migrate.mjs";
import { DEMO_TRANSLATOR, GENRE_DESCRIPTIONS, POLLS, RELATIONS, TITLES } from "./seed-data.mjs";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error("NODE_ENV=production: демо-данные в рабочую базу не добавляются. Если это точно нужно, задайте SEED_ALLOW_PRODUCTION=1.");
  process.exit(1);
}

const DAY = 86_400_000;

/** Дата в формате базы: «2026-10-30 12:00:00» */
function sqlDate(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Даты выхода глав: у выходящих тайтлов последняя глава вышла недавно (в свой день недели),
 * у завершённых — главы раз в неделю, последняя — год назад и раньше
 */
function releaseDates(title, count, index) {
  const now = Date.now();
  let last;
  if (title.status === "ongoing") {
    const day = title.releaseDay ?? index % 7;
    const back = (new Date(now).getUTCDay() - day + 7) % 7;
    last = now - back * DAY;
  } else {
    last = now - (365 + index * 20) * DAY;
  }
  return Array.from({ length: count }, (_, i) => sqlDate(last - (count - 1 - i) * 7 * DAY));
}

export async function seed(env, { log = console.log } = {}) {
  const added = [];
  const ids = new Map();
  for (const [index, item] of TITLES.entries()) {
    const existing = await env.DB.prepare("SELECT id FROM titles WHERE title = ?").bind(item.title).first();
    if (existing) {
      ids.set(item.title, existing.id);
      continue;
    }
    const [c0, c1, c2] = item.colors;
    const title = {
      title: item.title,
      originalTitle: item.originalTitle,
      type: item.type,
      year: item.year,
      status: item.status,
      rating: item.rating,
      genres: item.genres,
      author: item.author,
      translator: DEMO_TRANSLATOR,
      symbol: item.symbol,
      poster: `linear-gradient(145deg, ${c0}, ${c1} 55%, ${c2})`,
      description: item.description,
      releaseDay: item.status === "ongoing" ? item.releaseDay ?? null : null
    };
    const dates = releaseDates(item, item.chapters, index);
    // Тайтлы «добавлены в каталог» в разное время: так работает сортировка «Новинки»
    const createdAt = sqlDate(Date.now() - (TITLES.length - index) * 3 * DAY);
    const row = await env.DB.prepare(
      `INSERT INTO titles (${TITLE_COLUMNS.join(", ")}, updated_at, created_at)
       VALUES (${TITLE_COLUMNS.map(() => "?").join(", ")}, ?, ?) RETURNING id`
    ).bind(...titleValues(title), createdAt, createdAt).first();
    ids.set(item.title, row.id);

    await env.DB.batch([
      ...syncTaxonomyStatements(env, row.id, title),
      ...replaceTagsStatements(env, row.id, item.tags.map(([code, weight]) => ({ code, weight }))),
      ...item.characters.map(([name, role, description, symbol]) =>
        env.DB.prepare("INSERT INTO characters (title_id, name, role, description, symbol) VALUES (?, ?, ?, ?, ?)")
          .bind(row.id, name, role, description, symbol))
    ]);
    // Главы по одной: триггер проверяет, что номера идут подряд
    for (let number = 1; number <= item.chapters; number++) {
      await env.DB.prepare("INSERT INTO chapters (title_id, number, volume, released_at) VALUES (?, ?, ?, ?)")
        .bind(row.id, number, Math.ceil(number / 8), dates[number - 1]).run();
    }
    added.push(item.title);
  }
  log(`Тайтлы: добавлено ${added.length}, уже были ${TITLES.length - added.length}`);

  await env.DB.batch(Object.entries(GENRE_DESCRIPTIONS).map(([name, description]) =>
    env.DB.prepare("UPDATE genres SET description = ? WHERE name = ? AND description = ''").bind(description, name)));

  for (const [a, b, kind] of RELATIONS) {
    if (ids.has(a) && ids.has(b)) {
      await env.DB.prepare("INSERT OR IGNORE INTO title_relations (title_id, related_id, kind) VALUES (?, ?, ?)").bind(ids.get(a), ids.get(b), kind).run();
    }
  }

  let polls = 0;
  for (const poll of POLLS) {
    if (await env.DB.prepare("SELECT 1 FROM polls WHERE question = ?").bind(poll.question).first()) continue;
    const options = [];
    for (const name of poll.characters || []) {
      const row = await env.DB.prepare("SELECT id FROM characters WHERE name = ?").bind(name).first();
      if (row) options.push({ label: name, characterId: row.id });
    }
    for (const name of poll.genres || []) {
      const row = await env.DB.prepare("SELECT id FROM genres WHERE name = ?").bind(name).first();
      if (row) options.push({ label: name, genreId: row.id });
    }
    if (options.length < 2) continue;
    const row = await env.DB.prepare("INSERT INTO polls (kind, question, description) VALUES (?, ?, ?) RETURNING id")
      .bind(poll.kind, poll.question, poll.description || "").first();
    await env.DB.batch(options.map((option, position) => env.DB.prepare(
      "INSERT INTO poll_options (poll_id, label, character_id, genre_id, position) VALUES (?, ?, ?, ?, ?)"
    ).bind(row.id, option.label, option.characterId ?? null, option.genreId ?? null, position)));
    polls++;
  }
  log(`Голосования: добавлено ${polls}`);
  await backfillSearch(env);
  return { added, polls };
}

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

// Запуск из командной строки. Тесты импортируют seed() и seedAdmin() без этого блока
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = openDatabase(DB_FILE);
  applyMigrations(db.raw, MIGRATIONS_DIR, pendingMigrations(db.raw, MIGRATIONS_DIR));
  const env = { DB: db };
  try {
    await seed(env);
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
