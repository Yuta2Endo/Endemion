// Список аккаунтов для админки сайта: учёт сайтов, где входил аккаунт (client_activity), и внутренний API /internal/accounts

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as oidc from "openid-client";
import { startAuth, browser, interactionUid, SITE, LIFE } from "./helpers.mjs";
import { migrate, openDatabase } from "../src/db.mjs";
import { AUTH_ROOT } from "../src/config.mjs";

const TOKEN = "admin-token-0123456789-0123456789-abcdef";

let auth;
let site;
let life;

before(async () => {
  auth = await startAuth({ AUTH_ADMIN_TOKEN: TOKEN });
  const issuer = new URL(auth.issuer);
  site = await oidc.discovery(issuer, SITE.id, SITE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
  life = await oidc.discovery(issuer, LIFE.id, LIFE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
});

after(async () => {
  await auth.stop();
});

async function signIn(user, config, redirect, register) {
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirect,
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ...(register ? { screen: "register" } : {})
  });
  let done = await user.follow(url.href);
  if (register) {
    const uid = interactionUid(done.text);
    done = await user.follow(`/interaction/${uid}/register`, { method: "POST", form: { consent: "1", password: "correct-horse-1", ...register } });
  }
  assert.ok(done.final, `вход не вернул на сайт: ${done.status}`);
  return oidc.authorizationCodeGrant(config, done.final, { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce });
}

const list = (query = "", headers = { Authorization: `Bearer ${TOKEN}` }) => fetch(`${auth.issuer}/internal/accounts${query}`, { headers });

test("игрок Life виден в списке с меткой сайта, вход на сайт добавляет вторую метку", async () => {
  const player = browser(auth.issuer);
  const tokens = await signIn(player, life, LIFE.redirect, { email: "player@example.com", username: "life_player", displayName: "Игрок" });
  const sub = tokens.claims().sub;

  const res = await list("?platform=endemion_life");
  assert.equal(res.status, 200);
  let data = await res.json();
  const found = data.accounts.find((account) => account.sub === sub);
  assert.ok(found, "игрок Life в списке");
  assert.deepEqual(found.platforms.map((item) => item.platform), ["endemion_life"]);
  assert.equal(found.email, "player@example.com");
  assert.equal(found.username, "life_player");
  assert.ok(!("password_hash" in found) && !("passwordHash" in found), "хеш пароля не отдаётся");

  data = await (await list("?platform=endemion")).json();
  assert.ok(!data.accounts.some((account) => account.sub === sub), "на сайт ещё не заходил");

  // Сверка сессии Life (refresh token) обновляет последний вход, не создавая дублей
  await oidc.refreshTokenGrant(life, tokens.refresh_token);
  await signIn(player, site, SITE.redirect);
  data = await (await list(`?q=${encodeURIComponent("life_player")}`)).json();
  assert.equal(data.total, 1);
  assert.deepEqual(data.accounts[0].platforms.map((item) => item.platform).sort(), ["endemion", "endemion_life"]);
});

test("фильтр none: аккаунт без входов на сайты; поиск по почте и sub", async () => {
  // Аккаунт без входа на сайты: как после регистрации на страницах самого Endemion ID
  const result = await auth.accounts.register({ email: "lonely@example.com", username: "lonely_one", displayName: "Одиночка", password: "correct-horse-1" });
  assert.ok(result.account, "аккаунт создан");
  const data = await (await list("?platform=none")).json();
  assert.ok(data.accounts.some((account) => account.sub === result.account.sub));
  assert.ok(!data.accounts.some((account) => account.username === "life_player"));
  const bySub = await (await list(`?q=${result.account.sub}`)).json();
  assert.equal(bySub.total, 1);
  const byPercent = await (await list(`?q=${encodeURIComponent("%")}`)).json();
  assert.equal(byPercent.total, 0, "% в поиске — буква, а не шаблон");
});

test("без секрета, с чужим секретом или через прокси — 404; неверные параметры — 400", async () => {
  assert.equal((await list("", {})).status, 404);
  assert.equal((await list("", { Authorization: "Bearer wrong" })).status, 404);
  assert.equal((await list("", { Authorization: `Bearer ${TOKEN}x` })).status, 404);
  assert.equal((await list("", { Authorization: `Bearer ${TOKEN}`, "X-Forwarded-For": "1.2.3.4" })).status, 404);
  assert.equal((await list("?platform=evil")).status, 400);
  assert.equal((await list("?limit=1000")).status, 400);
  assert.equal((await list("?offset=-1")).status, 400);
});

test("без AUTH_ADMIN_TOKEN API выключен", async () => {
  const plain = await startAuth();
  try {
    const res = await fetch(`${plain.issuer}/internal/accounts`, { headers: { Authorization: "Bearer " } });
    assert.equal(res.status, 404);
  } finally {
    await plain.stop();
  }
});

test("миграция 0004 переносит прошлые входы из грантов и журнала", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "endemion-auth-mig-"));
  try {
    const source = path.join(AUTH_ROOT, "migrations");
    const all = readdirSync(source).filter((name) => name.endsWith(".sql")).sort();
    for (const name of all.filter((name) => name < "0004")) copyFileSync(path.join(source, name), path.join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    const add = db.prepare("INSERT INTO accounts (sub, email, username, display_name, password_hash) VALUES (?, ?, ?, ?, '!')");
    add.run("a", "a@example.com", "user_a", "A");
    add.run("b", "b@example.com", "user_b", "B");
    add.run("c", "c@example.com", "user_c", "C");
    db.prepare("INSERT INTO oidc_models (model, id, payload, account_id) VALUES ('Grant', 'g1', ?, 'a')")
      .run(JSON.stringify({ accountId: "a", clientId: LIFE.id, iat: 1_700_000_000 }));
    const log = db.prepare("INSERT INTO audit_log (account_sub, event, detail, created_at) VALUES (?, ?, ?, ?)");
    log.run("a", "login.success", LIFE.id, "2026-11-01T10:00:00.000Z");
    log.run("b", "social.signup", `google ${SITE.id}`, "2026-10-01T10:00:00.000Z");
    log.run("c", "register", "endemion-id", "2026-10-01T10:00:00.000Z");
    log.run("gone", "login.success", LIFE.id, "2026-10-01T10:00:00.000Z");
    for (const name of all.filter((name) => name >= "0004")) copyFileSync(path.join(source, name), path.join(dir, name));
    migrate(db, dir);
    const rows = db.prepare("SELECT account_sub, client_id, first_seen_at, last_seen_at FROM client_activity ORDER BY account_sub").all()
      .map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { account_sub: "a", client_id: LIFE.id, first_seen_at: "2023-11-14T22:13:20.000Z", last_seen_at: "2026-11-01T10:00:00.000Z" },
      { account_sub: "b", client_id: SITE.id, first_seen_at: "2026-10-01T10:00:00.000Z", last_seen_at: "2026-10-01T10:00:00.000Z" }
    ]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
