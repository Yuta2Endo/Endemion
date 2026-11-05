// Раздел админки «Аккаунты Endemion ID»: сайт берёт список у настоящего Endemion ID (auth/) по внутреннему API

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./helpers/app.mjs";
import { startAuth } from "../auth/tests/helpers.mjs";

const TOKEN = "admin-token-0123456789-0123456789-abcdef";

let auth;
let site;
let admin;
let reader;

before(async () => {
  auth = await startAuth({ AUTH_ADMIN_TOKEN: TOKEN });
  site = await createApp({ extraEnv: { ENDEMION_ID_INTERNAL_URL: auth.issuer, AUTH_ADMIN_TOKEN: TOKEN } });
  admin = await site.user("Админ", "admin");
  reader = await site.user("Читатель");
});

after(async () => {
  await site.close();
  await auth.stop();
});

test("администратор видит аккаунты Endemion ID и связанного пользователя сайта", async () => {
  const player = (await auth.accounts.register({ email: "player@example.com", username: "life_player", displayName: "Игрок", password: "correct-horse-1" })).account;
  const linked = (await auth.accounts.register({ email: "linked@example.com", username: "linked_one", displayName: "Связанный", password: "correct-horse-1" })).account;
  await site.db.prepare("UPDATE users SET endemion_sub = ? WHERE id = ?").bind(linked.sub, reader.id).run();

  const r = await admin.call("GET", "/api/admin/accounts?platform=all");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.total, 2);
  const byName = Object.fromEntries(r.data.accounts.map((account) => [account.username, account]));
  assert.equal(byName.life_player.sub, player.sub);
  assert.equal(byName.life_player.siteUser, null, "игрок Life на сайт не заходил");
  assert.equal(byName.linked_one.siteUser.id, reader.id);

  const search = await admin.call("GET", "/api/admin/accounts?q=life_player");
  assert.equal(search.data.total, 1);
});

test("не администратор и неверные параметры получают отказ", async () => {
  assert.equal((await reader.call("GET", "/api/admin/accounts")).status, 403);
  assert.equal((await site.client().call("GET", "/api/admin/accounts")).status, 401);
  assert.equal((await admin.call("GET", "/api/admin/accounts?platform=evil")).status, 400);
  assert.equal((await admin.call("GET", "/api/admin/accounts?limit=500")).status, 400);
});

test("без настроек — 503, неверный секрет или недоступный Endemion ID — 502", async () => {
  const saved = { url: site.env.ENDEMION_ID_INTERNAL_URL, token: site.env.AUTH_ADMIN_TOKEN };
  try {
    delete site.env.AUTH_ADMIN_TOKEN;
    assert.equal((await admin.call("GET", "/api/admin/accounts")).status, 503);
    site.env.AUTH_ADMIN_TOKEN = "wrong-token-0123456789-0123456789-abcdef";
    assert.equal((await admin.call("GET", "/api/admin/accounts")).status, 502);
    site.env.AUTH_ADMIN_TOKEN = saved.token;
    site.env.ENDEMION_ID_INTERNAL_URL = "http://127.0.0.1:1";
    assert.equal((await admin.call("GET", "/api/admin/accounts")).status, 502);
  } finally {
    site.env.ENDEMION_ID_INTERNAL_URL = saved.url;
    site.env.AUTH_ADMIN_TOKEN = saved.token;
  }
});
