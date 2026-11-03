// Перенос пользователей сайта: база сайта строится его же миграциями, пароль хешируется его же кодом (functions/_lib/crypto.js)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as oidc from "openid-client";
import { REPO_ROOT } from "../src/config.mjs";
import { pendingMigrations, applyMigrations } from "../../server/migrate.mjs";
import { hashPassword as siteHash } from "../../functions/_lib/crypto.js";
import { importEndemionUsers } from "../scripts/import-endemion-users.mjs";
import { startAuth, browser, interactionUid, SITE } from "./helpers.mjs";

let auth;
let site;
let siteDbFile;
let filesDir;

before(async () => {
  auth = await startAuth();
  site = await oidc.discovery(new URL(auth.issuer), SITE.id, SITE.secret, undefined, { execute: [oidc.allowInsecureRequests] });

  siteDbFile = path.join(auth.dataDir, "endemion.sqlite");
  filesDir = path.join(auth.dataDir, "files");
  const db = new DatabaseSync(siteDbFile);
  const migrationsDir = path.join(REPO_ROOT, "migrations");
  const log = console.log;
  console.log = () => {};
  applyMigrations(db, migrationsDir, pendingMigrations(db, migrationsDir));
  console.log = log;

  const addUser = db.prepare("INSERT INTO users (name, email, password_hash, consent_at, blocked_at) VALUES (?, ?, ?, datetime('now'), ?) RETURNING id");
  const addProfile = db.prepare("INSERT INTO user_profiles (user_id, username, avatar_version) VALUES (?, ?, ?)");
  const reader = addUser.get("Старый читатель", "old@example.com", await siteHash("old-password-1"), null).id;
  addProfile.run(reader, "old_reader", 1700000000000);
  const blocked = addUser.get("Заблокированный", "banned@example.com", await siteHash("banned-pass-1"), "2026-10-01 00:00:00").id;
  addProfile.run(blocked, "banned_one", null);
  const clash = addUser.get("Двойник", "taken@example.com", await siteHash("clash-pass-1"), null).id;
  addProfile.run(clash, "clash_user", null);
  db.close();

  // Аватар читателя в хранилище сайта на диске, ключ avatars/<id>/<версия> (server/storage.mjs)
  mkdirSync(filesDir, { recursive: true });
  const key = encodeURIComponent(`avatars/${reader}/1700000000000`).replaceAll(".", "%2E");
  writeFileSync(path.join(filesDir, `${key}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));

  // Почта taken@example.com уже занята аккаунтом, созданным в Endemion ID напрямую
  await auth.accounts.register({ email: "taken@example.com", username: "someone_else", displayName: "Другой", password: "other-pass-1" });
});

after(async () => {
  await auth.stop();
});

test("пробный запуск ничего не записывает", () => {
  const report = importEndemionUsers({ source: siteDbFile, authDb: auth.db, avatarsDir: auth.config.avatarsDir, filesDir, dryRun: true, log: () => {} });
  assert.equal(report.imported, 2);
  assert.equal(auth.db.prepare("SELECT COUNT(*) AS n FROM platform_links").get().n, 0);
});

test("перенос: аккаунты, аватар, конфликт почты без объединения, повторный запуск", () => {
  const report = importEndemionUsers({ source: siteDbFile, authDb: auth.db, avatarsDir: auth.config.avatarsDir, filesDir, log: () => {} });
  assert.deepEqual({ imported: report.imported, conflicts: report.conflicts, avatars: report.avatars }, { imported: 2, conflicts: 1, avatars: 1 });

  const reader = auth.accounts.findByEmail("old@example.com");
  assert.equal(reader.username, "old_reader");
  assert.equal(reader.display_name, "Старый читатель");
  assert.match(reader.password_hash, /^pbkdf2\$/, "хеш сайта перенесён как есть");
  assert.ok(existsSync(path.join(auth.config.avatarsDir, reader.sub)));
  assert.equal(auth.accounts.findByEmail("banned@example.com").status, "blocked");

  const other = auth.accounts.findByEmail("taken@example.com");
  assert.equal(other.username, "someone_else", "чужой аккаунт с той же почтой не тронут");
  const conflict = auth.db.prepare("SELECT reason FROM import_conflicts WHERE email = 'taken@example.com'").get();
  assert.equal(conflict.reason, "email_taken");

  const again = importEndemionUsers({ source: siteDbFile, authDb: auth.db, avatarsDir: auth.config.avatarsDir, filesDir, log: () => {} });
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);
});

test("вход со старым паролем сайта, замена хеша на scrypt и номер старого пользователя в токене", async () => {
  const user = browser(auth.issuer);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const url = oidc.buildAuthorizationUrl(site, {
    redirect_uri: SITE.redirect, scope: "openid email profile", state,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256"
  });
  const page = await user.follow(url.href);
  const done = await user.follow(`/interaction/${interactionUid(page.text)}/login`, { method: "POST", form: { login: "old@example.com", password: "old-password-1" } });
  assert.ok(done.final, done.text.slice(0, 200));
  const tokens = await oidc.authorizationCodeGrant(site, done.final, { pkceCodeVerifier: verifier, expectedState: state });
  const claims = tokens.claims();

  const siteDb = new DatabaseSync(siteDbFile, { readOnly: true });
  const siteId = siteDb.prepare("SELECT id FROM users WHERE email = 'old@example.com'").get().id;
  siteDb.close();
  assert.equal(claims["https://endemion.online/legacy_user_id"], String(siteId));
  assert.equal(claims.preferred_username, "old_reader");
  const picture = await fetch(claims.picture);
  assert.equal(picture.headers.get("content-type"), "image/png", "аватар сайта доступен через Endemion ID");

  assert.match(auth.accounts.findByEmail("old@example.com").password_hash, /^scrypt\$/, "после входа хеш заменён");
});

test("заблокированный пользователь не входит даже с верным паролем", async () => {
  const user = browser(auth.issuer);
  const url = oidc.buildAuthorizationUrl(site, {
    redirect_uri: SITE.redirect, scope: "openid", state: "s",
    code_challenge: await oidc.calculatePKCECodeChallenge(oidc.randomPKCECodeVerifier()), code_challenge_method: "S256"
  });
  const page = await user.follow(url.href);
  const done = await user.follow(`/interaction/${interactionUid(page.text)}/login`, { method: "POST", form: { login: "banned_one", password: "banned-pass-1" } });
  assert.equal(done.status, 403);
  assert.ok(!done.final);
});
