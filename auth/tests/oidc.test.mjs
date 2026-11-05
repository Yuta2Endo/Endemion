// Полный путь входа через Endemion ID глазами сайта: openid-client на стороне сервера сайта, cookie-браузер на стороне пользователя

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as oidc from "openid-client";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { startAuth, browser, interactionUid, csrfFrom, SITE, LIFE } from "./helpers.mjs";
import { currentCode, decryptSecret } from "../src/totp.mjs";

let auth;

/** Ошибка OAuth от сервера: код лежит в err.error (openid-client), а не в тексте сообщения */
async function rejectsWith(promise, code, message) {
  await assert.rejects(promise, (err) => {
    const actual = err.error ?? err.cause?.error ?? (err.response?.status === 401 ? "invalid_token" : undefined);
    assert.equal(actual, code, message);
    return true;
  });
}

let site;
let life;

before(async () => {
  auth = await startAuth();
  const issuer = new URL(auth.issuer);
  // Тестовый провайдер работает по http на 127.0.0.1, в production адреса только https
  site = await oidc.discovery(issuer, SITE.id, SITE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
  life = await oidc.discovery(issuer, LIFE.id, LIFE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
});

after(async () => {
  await auth.stop();
});

/** Сайт начинает вход: PKCE S256, state и nonce хранятся у сайта, в адрес уходит только challenge */
async function startLogin(config, redirect, extra = {}) {
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
    ...extra
  });
  return { url, verifier, state, nonce };
}

async function finishLogin(config, start, callbackUrl) {
  return oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: start.verifier,
    expectedState: start.state,
    expectedNonce: start.nonce
  });
}

async function register(user, values) {
  const start = await startLogin(site, SITE.redirect, { screen: "register" });
  const page = await user.follow(start.url.href);
  assert.match(page.text, /Создать Endemion ID/);
  const uid = interactionUid(page.text);
  const done = await user.follow(`/interaction/${uid}/register`, { method: "POST", form: { consent: "1", confirmPassword: values.password, ...values } });
  assert.ok(done.final, `регистрация не вернула на сайт: ${done.status} ${done.text.slice(0, 300)}`);
  return { start, tokens: await finishLogin(site, start, done.final) };
}

async function login(user, config, redirect, loginValue, password) {
  const start = await startLogin(config, redirect);
  const page = await user.follow(start.url.href);
  const uid = interactionUid(page.text);
  const done = await user.follow(`/interaction/${uid}/login`, { method: "POST", form: { login: loginValue, password } });
  return { start, done };
}

function authenticatorData(rpId, signCount) {
  const bytes = Buffer.alloc(37);
  createHash("sha256").update(rpId).digest().copy(bytes);
  bytes[32] = 0x01;
  bytes.writeUInt32BE(signCount, 33);
  return bytes;
}

test("ключ доступа входит без пароля, чужая подпись не принимается", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "key@example.com", username: "key_user", password: "key-password-1" });
  const csrf = csrfFrom((await user.request("/account/security")).text);
  const options = await user.request("/account/passkey/options", { method: "POST", headers: { "x-csrf-token": csrf } });
  const { challenge } = JSON.parse(options.text);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const id = "passkey-credential-1";
  const origin = auth.issuer;
  const client = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin }));
  const added = await user.request("/account/passkey", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      id,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      authenticatorData: authenticatorData("127.0.0.1", 0).toString("base64url"),
      clientDataJSON: client.toString("base64url")
    })
  });
  assert.equal(added.status, 200, added.text);
  assert.match((await user.request("/account")).text, /badge ok">есть<\/span> Ключ доступа/);

  const other = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect);
  const page = await other.follow(start.url.href);
  const uid = interactionUid(page.text);
  const loginOptions = JSON.parse((await other.request(`/interaction/${uid}/passkey/options`)).text);
  const loginClient = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: loginOptions.challenge, origin }));
  const loginAuth = authenticatorData("127.0.0.1", 1);
  const signature = sign("sha256", Buffer.concat([loginAuth, createHash("sha256").update(loginClient).digest()]), privateKey);
  const forged = await other.request(`/interaction/${uid}/passkey`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, authenticatorData: loginAuth.toString("base64url"), clientDataJSON: loginClient.toString("base64url"), signature: Buffer.alloc(64).toString("base64url") })
  });
  assert.equal(forged.status, 401);
  const fresh = await other.follow((await startLogin(site, SITE.redirect)).url.href);
  const freshUid = interactionUid(fresh.text);
  const again = JSON.parse((await other.request(`/interaction/${freshUid}/passkey/options`)).text);
  const againClient = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: again.challenge, origin }));
  const againAuth = authenticatorData("127.0.0.1", 2);
  const againSignature = sign("sha256", Buffer.concat([againAuth, createHash("sha256").update(againClient).digest()]), privateKey);
  const passed = await other.follow(`/interaction/${freshUid}/passkey`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, authenticatorData: againAuth.toString("base64url"), clientDataJSON: againClient.toString("base64url"), signature: againSignature.toString("base64url") })
  });
  assert.ok(passed.final, "ключ доступа завершает вход без пароля");
  const renameCsrf = csrfFrom((await user.request("/account/security")).text);
  const renamed = await user.request("/account/passkey/rename", { method: "POST", form: { csrf: renameCsrf, id, name: "Ноутбук" } });
  assert.match(renamed.location || "", /passkey-renamed/);
  assert.match((await user.request("/account/security")).text, /Ноутбук/);
});

test("ссылка «это был не я» меняет пароль и завершает сессии, открытие письма токен не тратит", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "alert@example.com", username: "alert_user", password: "alert-password-1" });
  auth.db.prepare("UPDATE accounts SET created_at = datetime('now', '-1 hour') WHERE email = 'alert@example.com'").run();
  await login(browser(auth.issuer), site, SITE.redirect, "alert_user", "alert-password-1");
  const letter = auth.mailer.sent.find((item) => item.subject === "Новый вход в Endemion ID" && item.to === "alert@example.com");
  const link = new URL(letter.text.match(/https?:\/\/\S+/)[0]);
  assert.equal(link.pathname, "/login-alert");
  const token = link.searchParams.get("token");
  assert.equal((await fetch(link)).status, 200, "почтовый сканер не тратит ссылку");
  const anon = browser(auth.issuer);
  assert.equal((await anon.request("/login-alert", { method: "POST", form: { token, password: "short" } })).status, 400);
  assert.equal((await anon.request("/login-alert", { method: "POST", form: { token, password: "alert-password-2", confirmPassword: "alert-password-2" } })).status, 200);
  assert.equal((await anon.request("/login-alert", { method: "POST", form: { token, password: "alert-password-3" } })).status, 400);
  assert.equal((await login(browser(auth.issuer), site, SITE.redirect, "alert_user", "alert-password-1")).done.status, 401);
  assert.ok((await login(browser(auth.issuer), site, SITE.redirect, "alert_user", "alert-password-2")).done.final);
  assert.equal((await user.request("/account")).location, "/login", "старая сессия завершена");
});

test("из WebP-аватара вырезается EXIF", async () => {
  const user = browser(auth.issuer);
  const { tokens } = await register(user, { email: "webp@example.com", username: "webp_user", password: "webp-password-1" });
  const sub = tokens.claims().sub;
  const csrf = csrfFrom((await user.request("/account")).text);
  const exif = Buffer.from("GPS latitude");
  const image = Buffer.concat([Buffer.from("VP8L"), Buffer.alloc(4), Buffer.from("img")]);
  image.writeUInt32LE(3, 4);
  const meta = Buffer.concat([Buffer.from("EXIF"), Buffer.alloc(4), exif]);
  meta.writeUInt32LE(exif.length, 4);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), meta, image]);
  webp.writeUInt32LE(webp.length - 8, 4);
  const uploaded = await user.request("/account/avatar", { method: "POST", headers: { "content-type": "image/webp", "x-csrf-token": csrf }, body: webp });
  assert.equal(uploaded.status, 200, uploaded.text);
  const stored = Buffer.from(await (await fetch(`${auth.issuer}/avatars/${sub}?v=2`)).arrayBuffer());
  assert.equal(stored.includes(exif), false);
  assert.equal(stored.includes(Buffer.from("VP8L")), true);
});

test("удаление аккаунта предупреждает почту", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "gone@example.com", username: "gone_user", password: "gone-password-1" });
  const csrf = csrfFrom((await user.request("/account/data")).text);
  const refused = await user.request("/account/delete", { method: "POST", form: { csrf, confirm: "чужое", password: "gone-password-1" } });
  assert.match(refused.location || "", /error=/);
  assert.match((await user.follow(refused.location)).text, /Имя пользователя не совпало/);
  const done = await user.request("/account/delete", { method: "POST", form: { csrf, confirm: "gone_user", password: "gone-password-1" } });
  assert.equal(done.status, 200);
  assert.ok(auth.mailer.sent.some((letter) => letter.to === "gone@example.com" && letter.subject === "Endemion ID удалён"));
  assert.equal(auth.accounts.findByEmail("gone@example.com"), null);
});

test("слабый сброс не тратит ссылку", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "weak@example.com", username: "weak_user", password: "weak-password-1" });
  await user.request("/forgot-password", { method: "POST", form: { email: "weak@example.com" } });
  const letter = auth.mailer.sent.find((item) => item.to === "weak@example.com" && item.subject === "Новый пароль для Endemion ID");
  const token = new URL(letter.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
  const weak = await user.request("/reset-password", { method: "POST", form: { token, password: "weak_user", confirmPassword: "weak_user" } });
  assert.equal(weak.status, 400);
  assert.match(weak.text, /не должен совпадать/);
  const ok = await user.request("/reset-password", { method: "POST", form: { token, password: "weak-password-2", confirmPassword: "weak-password-2" } });
  assert.equal(ok.status, 200);
});

test("смена пароля предупреждает почту", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "pass-mail@example.com", username: "pass_mail", password: "pass-mail-old-1" });
  const csrf = csrfFrom((await user.request("/account/security")).text);
  const mismatch = await user.request("/account/password", { method: "POST", form: { csrf, currentPassword: "pass-mail-old-1", newPassword: "pass-mail-new-1", confirmPassword: "other" } });
  assert.match(mismatch.location || "", /error=/);
  const changed = await user.request("/account/password", { method: "POST", form: { csrf, currentPassword: "pass-mail-old-1", newPassword: "pass-mail-new-1", confirmPassword: "pass-mail-new-1" } });
  assert.match(changed.location || "", /done=password/);
  const letter = auth.mailer.sent.find((item) => item.to === "pass-mail@example.com" && item.subject === "Пароль Endemion ID изменён");
  assert.match(letter.text, /\/login-alert\?token=/);
  assert.match((await user.request("/sessions")).text, /Пароль изменён/);
});

test("смена почты предупреждает старый адрес", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "old-mail@example.com", username: "old_mail", password: "old-mail-pass-1" });
  const csrf = csrfFrom((await user.request("/account/security")).text);
  const changed = await user.request("/account/email", { method: "POST", form: { csrf, email: "new-mail@example.com", password: "old-mail-pass-1" } });
  assert.match(changed.location || "", /done=email/);
  const letter = auth.mailer.sent.find((item) => item.to === "old-mail@example.com" && item.subject === "Почта Endemion ID изменена");
  const link = new URL(letter.text.match(/https?:\/\/\S+/)[0]);
  assert.equal(link.pathname, "/login-alert");
  const recovered = await browser(auth.issuer).request("/login-alert", { method: "POST", form: { token: link.searchParams.get("token"), password: "old-mail-pass-2", confirmPassword: "old-mail-pass-2" } });
  assert.equal(recovered.status, 200);
  assert.equal((await login(browser(auth.issuer), site, SITE.redirect, "new-mail@example.com", "old-mail-pass-2")).done.status, 401);
  assert.ok((await login(browser(auth.issuer), site, SITE.redirect, "old-mail@example.com", "old-mail-pass-2")).done.final);
  assert.equal(auth.accounts.findByEmail("old-mail@example.com").email_verified_at == null, false);
});

test("код из приложения обязателен и после пароля, запасной код входит один раз", async () => {
  const user = browser(auth.issuer);
  const { tokens } = await register(user, { email: "totp@example.com", username: "totp_user", password: "totp-password-1" });
  const sub = tokens.claims().sub;
  const security = await user.request("/account/security");
  const started = await user.request("/account/totp/start", { method: "POST", form: { csrf: csrfFrom(security.text) } });
  const secret = started.text.match(/<code>([^<]+)<\/code>/)[1].replace(/\s/g, "");
  const confirmed = await user.request("/account/totp/confirm", { method: "POST", form: { csrf: csrfFrom(started.text), code: currentCode(secret) } });
  assert.match(confirmed.text, /Сохраните запасные коды/);
  assert.match((await user.request("/account")).text, /badge ok">есть<\/span> Код из приложения/);
  const backup = confirmed.text.match(/<code>([A-Z0-9]{4}-[A-Z0-9]{4})<\/code>/)[1];

  const other = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect);
  const page = await other.follow(start.url.href);
  const uid = interactionUid(page.text);
  const asked = await other.follow(`/interaction/${uid}/login`, { method: "POST", form: { login: "totp_user", password: "totp-password-1" } });
  assert.match(asked.text, /Код из приложения/);
  assert.ok(!asked.final, "пароль один сайт на вход не пускает");
  assert.equal((await other.request(`/interaction/${uid}/totp`, { method: "POST", form: { code: "000000" } })).status, 401);
  const passed = await other.follow(`/interaction/${uid}/totp`, { method: "POST", form: { code: backup } });
  assert.ok(passed.final, "запасной код завершает вход");

  const third = browser(auth.issuer);
  const again = await third.follow((await startLogin(site, SITE.redirect)).url.href);
  const againUid = interactionUid(again.text);
  await third.follow(`/interaction/${againUid}/login`, { method: "POST", form: { login: "totp_user", password: "totp-password-1" } });
  assert.equal((await third.request(`/interaction/${againUid}/totp`, { method: "POST", form: { code: backup } })).status, 401, "запасной код одноразовый");
  assert.equal(decryptSecret(auth.db.prepare("SELECT secret FROM totp WHERE account_sub = ?").get(sub).secret, auth.config.cookieKeys[0]), secret);

  const blocked = await user.request("/account/password", { method: "POST", form: { csrf: csrfFrom((await user.request("/account/security")).text), currentPassword: "totp-password-1", newPassword: "totp-password-2" } });
  assert.match(blocked.location || "", /error=/, "смена пароля без кода не проходит");
  auth.db.prepare("UPDATE totp SET last_step = 0 WHERE account_sub = ?").run(sub);
  const securityNow = await user.request("/account/security");
  const refreshed = await user.request("/account/totp/backups", { method: "POST", form: { csrf: csrfFrom(securityNow.text), code: currentCode(secret) } });
  assert.match(refreshed.text, /Сохраните запасные коды/);
  const fourth = browser(auth.issuer);
  const next = await fourth.follow((await startLogin(site, SITE.redirect)).url.href);
  const nextUid = interactionUid(next.text);
  await fourth.follow(`/interaction/${nextUid}/login`, { method: "POST", form: { login: "totp_user", password: "totp-password-1" } });
  assert.equal((await fourth.request(`/interaction/${nextUid}/totp`, { method: "POST", form: { code: backup } })).status, 401, "старый запасной код больше не действует");
});

test("discovery: только code, PKCE S256, ключ RS256", () => {
  const meta = site.serverMetadata();
  assert.equal(meta.issuer, auth.issuer);
  assert.deepEqual(meta.response_types_supported, ["code"]);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(meta.id_token_signing_alg_values_supported, ["RS256"]);
  assert.ok(meta.end_session_endpoint);
});

test("регистрация, вход на Endemion и переход в Life без пароля (SSO)", async () => {
  const user = browser(auth.issuer);
  const { tokens } = await register(user, { email: "Reader@Example.com", username: "reader_one", displayName: "Читатель", password: "correct-horse-1" });
  const claims = tokens.claims();
  assert.match(claims.sub, /^[0-9a-f-]{36}$/);
  assert.equal(claims.email, "reader@example.com");
  assert.equal(claims.email_verified, false);
  assert.equal(claims.preferred_username, "reader_one");
  assert.equal(claims.name, "Читатель");
  assert.ok(tokens.refresh_token, "сайт получает refresh token");
  assert.equal(claims.exp - claims.iat, 600, "ID token живёт 10 минут");

  // Life: центральная сессия уже есть, форма входа не показывается
  const lifeStart = await startLogin(life, LIFE.redirect);
  const lifeDone = await user.follow(lifeStart.url.href);
  assert.ok(lifeDone.final, "Life получает код без формы входа");
  assert.equal(lifeDone.final.origin + lifeDone.final.pathname, LIFE.redirect);
  const lifeTokens = await finishLogin(life, lifeStart, lifeDone.final);
  assert.equal(lifeTokens.claims().sub, claims.sub, "один и тот же Endemion ID на обоих сайтах");

  const info = await oidc.fetchUserInfo(life, lifeTokens.access_token, claims.sub);
  assert.equal(info.preferred_username, "reader_one");
});

test("письмо подтверждения: ссылка одноразовая и подтверждает почту", async () => {
  const letter = auth.mailer.sent.find((item) => item.to === "reader@example.com" && /Подтвердите почту/.test(item.subject));
  assert.ok(letter, "письмо подтверждения отправлено");
  const link = new URL(letter.text.match(/https?:\/\/\S+/)[0]);
  const user = browser(auth.issuer);
  const page = await user.request(link.pathname + link.search);
  assert.equal(page.status, 200);
  assert.match(page.text, /Подтвердить/);
  const token = link.searchParams.get("token");
  assert.equal((await user.request("/verify-email", { method: "POST", form: { token } })).status, 200);
  assert.ok(auth.accounts.findByEmail("reader@example.com").email_verified_at);
  assert.equal((await user.request("/verify-email", { method: "POST", form: { token } })).status, 400, "повторно ссылка не работает");
});

test("неверный пароль, блокировка после 5 ошибок, одинаковый ответ для чужой почты", async () => {
  const user = browser(auth.issuer);
  await register(user, { email: "lock@example.com", username: "lock_me", password: "correct-horse-1" });

  const other = browser(auth.issuer);
  const unknown = await login(other, site, SITE.redirect, "nobody@example.com", "whatever-123");
  const wrong = await login(other, site, SITE.redirect, "lock@example.com", "wrong-password");
  assert.equal(unknown.done.status, 401);
  assert.equal(wrong.done.status, 401);
  assert.match(unknown.done.text, /Неверная почта, имя пользователя или пароль/);
  assert.match(wrong.done.text, /Неверная почта, имя пользователя или пароль/);

  for (let i = 0; i < 4; i++) await login(other, site, SITE.redirect, "lock@example.com", "wrong-password");
  const locked = await login(other, site, SITE.redirect, "lock_me", "correct-horse-1");
  assert.equal(locked.done.status, 429, "даже верный пароль не пускает, пока аккаунт закрыт");
});

test("неверный redirect_uri и запрос без PKCE отклоняются, код на чужой адрес не уходит", async () => {
  const user = browser(auth.issuer);
  const evil = await startLogin(site, "https://evil.example/callback");
  const response = await user.request(evil.url.href);
  assert.equal(response.status, 400);
  assert.ok(!response.location, "нет перенаправления на чужой адрес");

  const noPkce = new URL("/auth", auth.issuer);
  noPkce.search = new URLSearchParams({ client_id: SITE.id, redirect_uri: SITE.redirect, response_type: "code", scope: "openid", state: "s" }).toString();
  const rejected = await user.request(noPkce.href);
  assert.equal(new URL(rejected.location).searchParams.get("error"), "invalid_request");

  const implicit = new URL("/auth", auth.issuer);
  implicit.search = new URLSearchParams({ client_id: SITE.id, redirect_uri: SITE.redirect, response_type: "id_token", scope: "openid", nonce: "n" }).toString();
  const implicitResponse = await user.request(implicit.href);
  assert.ok(!/id_token=/.test(implicitResponse.location || ""), "implicit flow не выдаёт токен в адресе");
  assert.ok(implicitResponse.status === 400 || /error=/.test(implicitResponse.location || ""));
});

test("подмена state и чужой code_verifier не дают токенов", async () => {
  const user = browser(auth.issuer);
  const { done, start } = await login(user, site, SITE.redirect, "reader_one", "correct-horse-1");
  assert.ok(done.final);
  await assert.rejects(finishLogin(site, { ...start, state: "other-state" }, done.final), (err) => {
    assert.match(String(err.cause?.message || err.message), /state/);
    return true;
  });

  const second = await login(browser(auth.issuer), site, SITE.redirect, "reader_one", "correct-horse-1");
  await rejectsWith(finishLogin(site, { ...second.start, verifier: oidc.randomPKCECodeVerifier() }, second.done.final), "invalid_grant");
});

test("refresh token одноразовый: повторное использование отзывает всё", async () => {
  const user = browser(auth.issuer);
  const { done, start } = await login(user, site, SITE.redirect, "reader_one", "correct-horse-1");
  const tokens = await finishLogin(site, start, done.final);
  const rotated = await oidc.refreshTokenGrant(site, tokens.refresh_token);
  assert.ok(rotated.refresh_token && rotated.refresh_token !== tokens.refresh_token);

  await rejectsWith(oidc.refreshTokenGrant(site, tokens.refresh_token), "invalid_grant");
  // После попытки повтора отозван и новый токен: украденный токен не даст доступа никому
  await rejectsWith(oidc.refreshTokenGrant(site, rotated.refresh_token), "invalid_grant");
  await rejectsWith(oidc.fetchUserInfo(site, rotated.access_token, tokens.claims().sub), "invalid_token");
});

test("токен одного сайта не принимается другим клиентом", async () => {
  const user = browser(auth.issuer);
  const { done, start } = await login(user, site, SITE.redirect, "reader_one", "correct-horse-1");
  const tokens = await finishLogin(site, start, done.final);
  await rejectsWith(oidc.refreshTokenGrant(life, tokens.refresh_token), "invalid_grant");
});

test("изменение username и аватара видно сайтам при следующем обновлении токена", async () => {
  const user = browser(auth.issuer);
  const { done, start } = await login(user, site, SITE.redirect, "reader_one", "correct-horse-1");
  const tokens = await finishLogin(site, start, done.final);
  const sub = tokens.claims().sub;

  const account = await user.request("/account");
  assert.equal(account.status, 200);
  assert.match(account.text, new RegExp(sub));
  assert.match(account.text, /Код из приложения/);
  assert.match(account.text, /Ключ доступа/);
  const csrf = csrfFrom(account.text);

  const saved = await user.request("/account/profile", { method: "POST", form: { csrf, username: "reader_two", displayName: "Новое имя" } });
  assert.equal(saved.status, 303);
  assert.match(saved.location, /done=saved/);

  // Картинка проверяется по первым байтам: PNG-сигнатура и немного данных
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const avatar = await user.request("/account/avatar", { method: "POST", headers: { "content-type": "image/png", "x-csrf-token": csrf }, body: png });
  assert.equal(avatar.status, 200, avatar.text);
  const notImage = await user.request("/account/avatar", { method: "POST", headers: { "content-type": "image/png", "x-csrf-token": csrf }, body: Buffer.from("<svg onload=alert(1)>") });
  assert.equal(notImage.status, 415);

  const refreshed = await oidc.refreshTokenGrant(site, tokens.refresh_token);
  const claims = refreshed.claims();
  assert.equal(claims.sub, sub, "sub не меняется при смене username");
  assert.equal(claims.preferred_username, "reader_two");
  assert.equal(claims.name, "Новое имя");
  assert.ok(claims.picture.startsWith(`${auth.issuer}/avatars/${sub}?v=`));
  const picture = await fetch(claims.picture);
  assert.equal(picture.headers.get("content-type"), "image/png");

  const apps = await user.request("/account/apps");
  assert.match(apps.text, /<strong>Endemion<\/strong>/);
  assert.equal((apps.text.match(/name="id"/g) || []).length, 2, "сайты сведены, а не каждый грант отдельно");
  const grantId = apps.text.match(/name="id" value="([^"]+)"/)[1];
  const revoked = await user.request("/account/apps/revoke", { method: "POST", form: { csrf: csrfFrom(apps.text), id: grantId } });
  assert.equal(revoked.status, 303);
  await rejectsWith(oidc.refreshTokenGrant(site, refreshed.refresh_token), "invalid_grant", "отзыв приложения гасит его токены");
});

test("CSRF: форма аккаунта без токена или с чужого сайта отклоняется", async () => {
  const user = browser(auth.issuer);
  await login(user, site, SITE.redirect, "reader_two", "correct-horse-1");
  const noToken = await user.request("/account/profile", { method: "POST", form: { username: "hacked_name" } });
  assert.equal(noToken.status, 403);
  const page = await user.request("/account");
  const crossSite = await user.request("/account/profile", { method: "POST", origin: "https://evil.example", form: { csrf: csrfFrom(page.text), username: "hacked_name" } });
  assert.equal(crossSite.status, 403);
  assert.equal(auth.accounts.findByEmail("reader@example.com").username, "reader_two");
});

test("форма входа с Origin: null отклоняется, с адресом своей страницы в Referer принимается", async () => {
  const start = await startLogin(site, SITE.redirect);
  const user = browser(auth.issuer);
  const page = await user.follow(start.url.href);
  const uid = interactionUid(page.text);
  const blocked = await user.request(`/interaction/${uid}/login`, { method: "POST", origin: "null", form: { login: "reader_two", password: "brand-new-pass-2" } });
  assert.equal(blocked.status, 403, "Origin: null не доказывает, что форма с этого сайта");
  const accepted = await user.request(`/interaction/${uid}/login`, {
    method: "POST", origin: "", headers: { referer: `${auth.issuer}/interaction/${uid}` }, form: { login: "reader_two", password: "brand-new-pass-2" }
  });
  assert.notEqual(accepted.status, 403);
});

test("без входа страницы аккаунта и сессий недоступны", async () => {
  const anon = browser(auth.issuer);
  assert.equal((await anon.request("/account")).location, "/login");
  assert.equal((await anon.request("/sessions")).location, "/login");
  assert.equal((await anon.request("/account/apps")).location, "/login");
  assert.equal((await anon.request("/account/export")).location, "/login");
  const post = await anon.request("/account/password", { method: "POST", form: { currentPassword: "x", newPassword: "y" } });
  assert.equal(post.location, "/login");
  const info = await fetch(new URL("/me", auth.issuer), { headers: { authorization: "Bearer not-a-real-token" } });
  assert.equal(info.status, 401);
});

test("завершение другой сессии отзывает её токены на сайтах", async () => {
  const phone = browser(auth.issuer);
  const laptop = browser(auth.issuer);
  const onPhone = await login(phone, life, LIFE.redirect, "reader_two", "correct-horse-1");
  const phoneTokens = await finishLogin(life, onPhone.start, onPhone.done.final);
  await login(laptop, site, SITE.redirect, "reader_two", "correct-horse-1");

  const sessions = await laptop.request("/sessions");
  assert.match(sessions.text, /Endemion Life/);
  assert.match(sessions.text, /Недавние входы/);
  assert.match(sessions.text, /Вход по паролю/);
  const ids = [...sessions.text.matchAll(/name="id" value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 1);
  const revoked = await laptop.request("/sessions/revoke-others", { method: "POST", form: { csrf: csrfFrom(sessions.text) } });
  assert.equal(revoked.status, 303);

  await rejectsWith(oidc.refreshTokenGrant(life, phoneTokens.refresh_token), "invalid_grant");
  assert.equal((await phone.request("/account")).location, "/login", "на телефоне центральная сессия завершена");
  assert.equal((await laptop.request("/account")).status, 200, "текущая сессия осталась");
});

test("восстановление пароля: письмо, одноразовая ссылка, выход везде", async () => {
  const user = browser(auth.issuer);
  const signedIn = await login(user, site, SITE.redirect, "reader_two", "correct-horse-1");
  const tokens = await finishLogin(site, signedIn.start, signedIn.done.final);

  const anon = browser(auth.issuer);
  const before = auth.mailer.sent.length;
  const requested = await anon.request("/forgot-password", { method: "POST", form: { email: "reader@example.com" } });
  assert.match(requested.text, /письмо уже в пути/);
  const unknown = await anon.request("/forgot-password", { method: "POST", form: { email: "nobody@example.com" } });
  assert.equal(unknown.text, requested.text, "ответ не выдаёт, есть ли аккаунт");
  assert.equal(auth.mailer.sent.length, before + 1);

  const link = new URL(auth.mailer.sent.at(-1).text.match(/https?:\/\/\S+/)[0]);
  const token = link.searchParams.get("token");
  assert.equal((await anon.request("/reset-password", { method: "POST", form: { token, password: "short" } })).status, 400);
  assert.equal((await anon.request("/reset-password", { method: "POST", form: { token, password: "brand-new-pass-2", confirmPassword: "brand-new-pass-2" } })).status, 200);
  assert.equal((await anon.request("/reset-password", { method: "POST", form: { token, password: "another-pass-3" } })).status, 400, "ссылка одноразовая");

  await rejectsWith(oidc.refreshTokenGrant(site, tokens.refresh_token), "invalid_grant", "токены сайтов отозваны");
  const oldPassword = await login(browser(auth.issuer), site, SITE.redirect, "reader_two", "correct-horse-1");
  assert.equal(oldPassword.done.status, 401);
  const newPassword = await login(browser(auth.issuer), site, SITE.redirect, "reader_two", "brand-new-pass-2");
  assert.ok(newPassword.done.final);
  assert.ok(auth.mailer.sent.some((letter) => letter.subject === "Новый вход в Endemion ID"), "новый адрес получает письмо");
  const notices = auth.mailer.sent.length;
  await login(browser(auth.issuer), site, SITE.redirect, "reader_two", "brand-new-pass-2");
  assert.equal(auth.mailer.sent.length, notices, "повтор с того же адреса за сутки письмо не шлёт");
});

test("выход: подтверждение с защитой xsrf и выход со всех сайтов", async () => {
  const user = browser(auth.issuer);
  const { done, start } = await login(user, site, SITE.redirect, "reader_two", "brand-new-pass-2");
  const tokens = await finishLogin(site, start, done.final);
  const lifeStart = await startLogin(life, LIFE.redirect);
  const lifeTokens = await finishLogin(life, lifeStart, (await user.follow(lifeStart.url.href)).final);

  const endUrl = oidc.buildEndSessionUrl(site, { id_token_hint: tokens.id_token, post_logout_redirect_uri: SITE.logout });
  const page = await user.request(endUrl.href);
  assert.equal(page.status, 200);
  assert.match(page.text, /Выйти со всех сайтов Endemion/);
  const xsrf = page.text.match(/name="xsrf" value="([^"]+)"/)[1];

  const forged = await user.request("/session/end/confirm", { method: "POST", form: { xsrf: "forged", logout: "yes" } });
  assert.equal(forged.status, 400, "без настоящего xsrf выход не выполняется");

  const confirmed = await user.request("/session/end/confirm", { method: "POST", form: { xsrf, logout: "yes" } });
  assert.equal(confirmed.status, 303);
  assert.ok(confirmed.location.startsWith(SITE.logout));
  await rejectsWith(oidc.refreshTokenGrant(site, tokens.refresh_token), "invalid_grant");
  await rejectsWith(oidc.refreshTokenGrant(life, lifeTokens.refresh_token), "invalid_grant");
  assert.equal((await user.request("/account")).location, "/login");
});

test("заголовки безопасности и cookie сессии", async () => {
  const user = browser(auth.issuer);
  const { done } = await login(user, site, SITE.redirect, "reader_two", "brand-new-pass-2");
  assert.ok(done.final);
  const page = await user.request("/account");
  const csp = page.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  // С no-referrer браузер шлёт формы с Origin: null, и вход отклонялся бы с 403 (было в рабочей среде 2026-11-03)
  assert.equal(page.headers.get("referrer-policy"), "same-origin");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.ok(user.jar.has("_session"));
  assert.doesNotMatch(page.text, /<script>|style=/, "нет встроенных скриптов и стилей");
  assert.match(page.text, /src="\/assets\/reveal\.js"/);
  const signIn = await browser(auth.issuer).follow((await startLogin(site, SITE.redirect)).url.href);
  assert.match(signIn.text, /id="passkeyLogin"/);
  assert.match(signIn.text, /Войти паролем/);
});

test("health check", async () => {
  const response = await fetch(new URL("/healthz", auth.issuer));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("значки сайта: ICO и PNG отдаются, страницы ссылаются на них, а не на SVG", async () => {
  const icons = {
    "/favicon.ico": "image/x-icon",
    "/icons/favicon-16x16.png": "image/png",
    "/icons/favicon-32x32.png": "image/png",
    "/favicon.svg": "image/svg+xml"
  };
  for (const [iconPath, type] of Object.entries(icons)) {
    const response = await fetch(new URL(`${iconPath}?v=2`, auth.issuer));
    assert.equal(response.status, 200, iconPath);
    assert.equal(response.headers.get("content-type"), type, iconPath);
    assert.ok((await response.arrayBuffer()).byteLength > 0, iconPath);
  }
  // Чужие файлы из public/ сайта через папку значков не отдаются
  assert.equal((await fetch(new URL("/icons/icon-512.png", auth.issuer))).status, 404);
  assert.equal((await fetch(new URL("/icons/../manifest.webmanifest", auth.issuer))).status, 404);
  const robots = await fetch(new URL("/robots.txt", auth.issuer));
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);

  const page = await fetch(new URL("/forgot-password", auth.issuer));
  const html = await page.text();
  assert.match(html, /href="\/login"/, "логотип и «назад» ведут на вход, не в кабинет");
  assert.doesNotMatch(html, /href="\/account"/);

  const stale = await fetch(new URL("/interaction/stale-uid", auth.issuer), { redirect: "manual" });
  assert.equal(stale.status, 303);
  assert.match(stale.headers.get("location") || "", /\/auth\?/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico\?v=2" sizes="32x32">/);
  assert.match(html, /<link rel="icon" href="\/icons\/favicon-32x32\.png\?v=2" type="image\/png" sizes="32x32">/);
  assert.match(html, /<link rel="icon" href="\/icons\/favicon-16x16\.png\?v=2" type="image\/png" sizes="16x16">/);
  assert.doesNotMatch(html, /favicon\.svg/);
});
