// Вход на сайт через Endemion ID: настоящий провайдер из auth/ на свободном порту и код сайта (src/worker.js)
// на временной базе. Браузер — cookie вручную: у сайта и провайдера разные cookie

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import worker from "../src/worker.js";
import { BASE, createApp } from "./helpers/app.mjs";
import { startAuth, browser, interactionUid } from "../auth/tests/helpers.mjs";

const CLIENT = { id: "endemion-web", secret: "site-test-secret-0123456789-0123456789" };

let auth;
let site;

before(async () => {
  auth = await startAuth({
    OIDC_CLIENTS: JSON.stringify([{
      client_id: CLIENT.id, client_secret: CLIENT.secret, platform: "endemion",
      redirect_uris: [`${BASE}/auth/callback`], post_logout_redirect_uris: [`${BASE}/`]
    }])
  });
  site = await createApp();
  Object.assign(site.env, {
    ENDEMION_ID: "1",
    ENDEMION_ID_ISSUER: auth.issuer,
    ENDEMION_ID_CLIENT_ID: CLIENT.id,
    ENDEMION_ID_CLIENT_SECRET: CLIENT.secret,
    ENDEMION_ID_TOKEN_KEY: randomBytes(32).toString("base64")
  });
});

after(async () => {
  await site.close();
  await auth.stop();
});

/**
 * Запрос к сайту. cookies — Map имя → значение, обновляется по Set-Cookie ответа
 * @param {Map<string, string>} cookies
 * @param {string} url
 * @param {{ method?: string, body?: any }} [options]
 */
async function siteRequest(cookies, url, { method = "GET", body } = {}) {
  /** @type {Record<string, string>} */
  const headers = { "CF-Connecting-IP": "10.9.0.1" };
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  if (method !== "GET") headers.Origin = BASE;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await worker.fetch(new Request(new URL(url, BASE), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" }),
    site.env, { waitUntil() {}, passThroughOnException() {} });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!value || /Max-Age=0/i.test(line)) cookies.delete(name);
    else cookies.set(name, value);
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: response.status, location: response.headers.get("location"), text, data };
}

/**
 * Вход на сайт: /auth/login → Endemion ID → /auth/callback. action — что сделать на странице Endemion ID:
 * { register: {...} }, { login, password } или ничего (центральная сессия уже есть)
 */
async function signIn(user, cookies, action = {}, next = "/profile") {
  const start = await siteRequest(cookies, `/auth/login?next=${encodeURIComponent(next)}${action.register ? "&screen=register" : ""}`);
  assert.equal(start.status, 302);
  assert.ok(start.location.startsWith(`${auth.issuer}/auth?`), start.location);
  const authorize = new URL(start.location);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!authorize.searchParams.has("code_verifier"), "verifier не уходит в адрес");

  let result = await user.follow(start.location);
  if (!result.final) {
    const uid = interactionUid(result.text);
    result = action.register
      ? await user.follow(`/interaction/${uid}/register`, { method: "POST", form: { consent: "1", ...action.register } })
      : await user.follow(`/interaction/${uid}/login`, { method: "POST", form: { login: action.login, password: action.password } });
  }
  assert.ok(result.final, `Endemion ID не вернул на сайт: ${result.status} ${result.text?.slice(0, 200)}`);
  assert.equal(result.final.origin, BASE);
  const callback = await siteRequest(cookies, result.final.pathname + result.final.search);
  return { callback, callbackUrl: result.final.pathname + result.final.search };
}

async function forceRefresh() {
  // Сверка с Endemion ID идёт раз в 5 минут. В тесте время не ждём: помечаем, что сверки давно не было
  await site.db.prepare("UPDATE sessions SET refreshed_at = 0 WHERE refresh_token IS NOT NULL").run();
}

test("регистрация в Endemion ID, вход на сайт, профиль из Endemion ID", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  const { callback, callbackUrl } = await signIn(user, cookies, { register: { email: "new@example.com", username: "new_reader", displayName: "Новый читатель", password: "correct-horse-1" } });
  assert.equal(callback.status, 302);
  assert.equal(callback.location, `${BASE}/profile`);
  assert.ok(cookies.has("endemion_session"));
  assert.ok(!cookies.has("endemion_oidc"), "cookie начатого входа удалена");

  const me = await siteRequest(cookies, "/api/me");
  assert.equal(me.data.user.name, "Новый читатель");
  assert.equal(me.data.user.username, "new_reader");
  assert.equal(me.data.user.email, "new@example.com");
  assert.equal(me.data.user.viaEndemionId, true);

  const row = await site.db.prepare("SELECT endemion_sub, password_hash FROM users WHERE id = ?").bind(me.data.user.id).first();
  assert.equal(row.endemion_sub, auth.accounts.findByEmail("new@example.com").sub);
  assert.equal(row.password_hash, "!", "пароля на сайте нет");

  const replay = await siteRequest(new Map(), callbackUrl);
  assert.equal(replay.status, 400, "ответ провайдера нельзя использовать второй раз и в другом браузере");
});

test("смена имени и username в Endemion ID появляется на сайте, полка остаётся", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  await signIn(user, cookies, { login: "new_reader", password: "correct-horse-1" });
  const me = (await siteRequest(cookies, "/api/me")).data.user;
  const shelfBefore = await site.db.prepare("SELECT COUNT(*) AS n FROM library WHERE user_id = ?").bind(me.id).first();

  const sub = auth.accounts.findByEmail("new@example.com").sub;
  auth.accounts.updateProfile(sub, { username: "renamed_reader", displayName: "Другое имя" });
  await forceRefresh();
  const updated = (await siteRequest(cookies, "/api/me")).data.user;
  assert.equal(updated.id, me.id, "тот же пользователь сайта");
  assert.equal(updated.username, "renamed_reader");
  assert.equal(updated.name, "Другое имя");
  const shelfAfter = await site.db.prepare("SELECT COUNT(*) AS n FROM library WHERE user_id = ?").bind(me.id).first();
  assert.equal(shelfAfter.n, shelfBefore.n);
});

test("старый аккаунт сайта связывается только после подтверждения почты", async () => {
  // Пользователь сайта до Endemion ID, с записью на полке
  const old = await site.db.prepare("INSERT INTO users (name, email, password_hash, consent_at) VALUES ('Старый', 'old@example.com', 'pbkdf2$1$AA==$AA==', datetime('now')) RETURNING id").first();
  await site.db.prepare("INSERT INTO user_profiles (user_id, username) VALUES (?, 'old_one')").bind(old.id).run();

  const user = browser(auth.issuer);
  const cookies = new Map();
  const first = await signIn(user, cookies, { register: { email: "old@example.com", username: "old_in_id", password: "correct-horse-1" } });
  assert.equal(first.callback.status, 409, "неподтверждённая почта не даёт чужой аккаунт");
  assert.match(first.callback.text, /Подтвердите почту/);
  assert.ok(!cookies.has("endemion_session"));
  assert.equal((await site.db.prepare("SELECT endemion_sub FROM users WHERE id = ?").bind(old.id).first()).endemion_sub, null);

  auth.accounts.markEmailVerified(auth.accounts.findByEmail("old@example.com").sub);
  const second = await signIn(user, cookies);
  assert.equal(second.callback.status, 302);
  const me = (await siteRequest(cookies, "/api/me")).data.user;
  assert.equal(me.id, old.id, "вход в старый аккаунт сайта");
  assert.equal(me.username, "old_in_id");
});

test("старые входы паролем сайта закрыты", async () => {
  const cookies = new Map();
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/auth/forgot", "/api/auth/reset"]) {
    const response = await siteRequest(cookies, path, { method: "POST", body: { email: "old@example.com", password: "x" } });
    assert.equal(response.status, 410, path);
  }
  const page = await siteRequest(cookies, "/auth?next=/pulse");
  assert.equal(page.status, 302);
  assert.equal(page.location, `${BASE}/auth/login?next=%2Fpulse`);
});

test("next на чужой сайт после входа не уводит", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  const { callback } = await signIn(user, cookies, { login: "renamed_reader", password: "correct-horse-1" }, "https://evil.example/x");
  assert.equal(callback.location, `${BASE}/`);
});

test("отзыв сессий в Endemion ID выводит и с сайта", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  await signIn(user, cookies, { login: "renamed_reader", password: "correct-horse-1" });
  assert.ok((await siteRequest(cookies, "/api/me")).data.user);

  const tokenHash = createHash("sha256").update(cookies.get("endemion_session")).digest("hex");
  auth.revokeAll(auth.accounts.findByEmail("new@example.com").sub);
  await forceRefresh();
  assert.equal((await siteRequest(cookies, "/api/me")).data.user, null);
  // Остальные сессии этого пользователя удаляются так же — при их следующем запросе, не позже REFRESH_MS
  const left = await site.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(tokenHash).first();
  assert.equal(left.n, 0, "сессия сайта удалена");
});

test("выход на сайте ведёт на выход в Endemion ID", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  await signIn(user, cookies, { login: "renamed_reader", password: "correct-horse-1" });
  const logout = await siteRequest(cookies, "/api/auth/logout", { method: "POST", body: {} });
  assert.equal(logout.status, 200);
  const redirect = new URL(logout.data.redirect);
  assert.equal(redirect.origin + redirect.pathname, `${auth.issuer}/session/end`);
  assert.equal(redirect.searchParams.get("post_logout_redirect_uri"), `${BASE}/`);
  assert.ok(!cookies.has("endemion_session"));
  assert.equal((await siteRequest(cookies, "/api/me")).data.user, null);
});

test("опасные действия требуют свежего входа в Endemion ID", async () => {
  const user = browser(auth.issuer);
  const cookies = new Map();
  await signIn(user, cookies, { login: "renamed_reader", password: "correct-horse-1" });
  await site.db.prepare("UPDATE sessions SET auth_time = ? WHERE refresh_token IS NOT NULL").bind(Math.floor(Date.now() / 1000) - 3600).run();
  const remove = await siteRequest(cookies, "/api/me", { method: "DELETE", body: {} });
  assert.equal(remove.status, 403);
  assert.match(remove.data.reauth, /^\/auth\/login\?reauth=1/);
  const password = await siteRequest(cookies, "/api/me/password", { method: "POST", body: { currentPassword: "x", newPassword: "yyyyyyyy" } });
  assert.equal(password.status, 409, "пароль меняется в Endemion ID");
});
