// Полный путь входа через Endemion ID глазами сайта: openid-client на стороне сервера сайта, cookie-браузер на стороне пользователя

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as oidc from "openid-client";
import { startAuth, browser, interactionUid, csrfFrom, SITE, LIFE } from "./helpers.mjs";

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
  const done = await user.follow(`/interaction/${uid}/register`, { method: "POST", form: { consent: "1", ...values } });
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

test("без входа страницы аккаунта и сессий недоступны", async () => {
  const anon = browser(auth.issuer);
  assert.equal((await anon.request("/account")).location, "/login");
  assert.equal((await anon.request("/sessions")).location, "/login");
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
  assert.equal((await anon.request("/reset-password", { method: "POST", form: { token, password: "brand-new-pass-2" } })).status, 200);
  assert.equal((await anon.request("/reset-password", { method: "POST", form: { token, password: "another-pass-3" } })).status, 400, "ссылка одноразовая");

  await rejectsWith(oidc.refreshTokenGrant(site, tokens.refresh_token), "invalid_grant", "токены сайтов отозваны");
  const oldPassword = await login(browser(auth.issuer), site, SITE.redirect, "reader_two", "correct-horse-1");
  assert.equal(oldPassword.done.status, 401);
  const newPassword = await login(browser(auth.issuer), site, SITE.redirect, "reader_two", "brand-new-pass-2");
  assert.ok(newPassword.done.final);
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
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.ok(user.jar.has("_session"));
  assert.doesNotMatch(page.text, /<script>|style=/, "нет встроенных скриптов и стилей");
});

test("health check", async () => {
  const response = await fetch(new URL("/healthz", auth.issuer));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
