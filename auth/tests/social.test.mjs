// Вход через Google, GitHub, VK ID и Discord. Вместо настоящих провайдеров — локальные заглушки (fake-providers.mjs),
// которые проверяют client_id, redirect_uri, PKCE, nonce, device_id и одноразовость кода так же, как настоящие

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as oidc from "openid-client";
import { startAuth, browser, interactionUid, csrfFrom, SITE, LIFE } from "./helpers.mjs";
import { startFakeProviders } from "./fake-providers.mjs";
import { generateJwks, loadConfig } from "../src/config.mjs";

let auth;
let fake;
let site;
let life;

before(async () => {
  fake = await startFakeProviders();
  auth = await startAuth(fake.env());
  fake.setRedirectBase(auth.issuer);
  const issuer = new URL(auth.issuer);
  site = await oidc.discovery(issuer, SITE.id, SITE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
  life = await oidc.discovery(issuer, LIFE.id, LIFE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
});

after(async () => {
  await auth.stop();
  await fake.stop();
});

const count = (sql, ...args) => auth.db.prepare(sql).get(...args).n;
const accountsCount = () => count("SELECT COUNT(*) AS n FROM accounts");

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

const finishLogin = (config, start, callbackUrl) =>
  oidc.authorizationCodeGrant(config, callbackUrl, { pkceCodeVerifier: start.verifier, expectedState: start.state, expectedNonce: start.nonce });

/** Нажать «Войти через …» и пройти провайдера. Возвращает адрес ответа провайдера (callback Endemion ID) */
async function viaProvider(user, action) {
  const started = await user.request(action, { method: "POST", form: {} });
  assert.equal(started.status, 303, `вход у провайдера не начался: ${started.status} ${started.text.slice(0, 200)}`);
  const answer = await fetch(started.location, { redirect: "manual" });
  assert.equal(answer.status, 302, `провайдер отклонил запрос: ${await answer.text()}`);
  return answer.headers.get("location");
}

/** Сайт отправляет на вход, пользователь выбирает провайдера. result — то, чем закончились перенаправления */
async function socialLogin(user, provider, behaviour, { config = site, redirect = SITE.redirect, extra = {} } = {}) {
  // Все входы тестов идут с 127.0.0.1: счётчики частоты сбрасываются, сами лимиты проверяет oidc.test.mjs
  auth.db.prepare("DELETE FROM rate_events").run();
  fake.next(provider, behaviour);
  const start = await startLogin(config, redirect, extra);
  const page = await user.follow(start.url.href);
  const uid = interactionUid(page.text);
  const callback = await viaProvider(user, `/interaction/${uid}/social/${provider}`);
  return { start, uid, callback, result: await user.follow(callback) };
}

const pendingToken = (html) => html.match(/name="token" value="([^"]+)"/)[1];

/** Форма «Завершите регистрацию» после первого входа через провайдера */
async function completeSignup(user, uid, page, values) {
  return user.follow(`/interaction/${uid}/social`, { method: "POST", form: { token: pendingToken(page.text), consent: "1", ...values } });
}

const lastAuthorize = (provider) => fake.authorizeRequests.filter((item) => item.provider === provider).at(-1).params;

test("кнопки входа: Google, ВКонтакте, GitHub и Discord, без Apple и X", async () => {
  const user = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect);
  const page = await user.follow(start.url.href);
  assert.match(page.text, /Войти через Google/);
  assert.match(page.text, /Войти через ВКонтакте/);
  assert.match(page.text, /Войти через GitHub/);
  assert.match(page.text, /Войти через Discord/);
  assert.doesNotMatch(page.text, /apple|twitter|Войти через X/i);
  // Кнопки — формы POST, ссылок на начало входа нет
  assert.match(page.text, /<form method="post" action="\/interaction\/[^/"]+\/social\/google">/);
  assert.doesNotMatch(page.text, /href="[^"]*\/social\//);
  const csp = page.headers.get("content-security-policy");
  assert.match(csp, new RegExp(`form-action [^;]*${fake.base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const registerStart = await startLogin(site, SITE.redirect, { screen: "register" });
  const registerPage = await browser(auth.issuer).follow(registerStart.url.href);
  assert.match(registerPage.text, /Войти через GitHub/);
});

test("без ключей провайдера кнопки нет, а неполные ключи не дают запуститься", async () => {
  const plain = await startAuth();
  try {
    const config = await oidc.discovery(new URL(plain.issuer), SITE.id, SITE.secret, undefined, { execute: [oidc.allowInsecureRequests] });
    const user = browser(plain.issuer);
    const start = await startLogin(config, SITE.redirect);
    const page = await user.follow(start.url.href);
    assert.doesNotMatch(page.text, /Войти через|social-buttons/);
    const uid = interactionUid(page.text);
    assert.equal((await user.request(`/interaction/${uid}/social/google`, { method: "POST", form: {} })).status, 404);
    assert.doesNotMatch(page.headers.get("content-security-policy"), /google|github|vk/);
  } finally {
    await plain.stop();
  }
  // Ключ подписи из переменной: иначе loadConfig создал бы ключ разработки в data/auth репозитория
  const base = { AUTH_JWKS: JSON.stringify(generateJwks()) };
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "test", AUTH_GOOGLE_CLIENT_ID: "only-id" }), /AUTH_GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "test", AUTH_VK_CLIENT_ID: "not-a-number" }), /AUTH_VK_CLIENT_ID/);
  // Адреса провайдеров подменяются только в тестах: в рабочей среде вход идёт только к настоящим Google, GitHub, VK
  const production = loadConfig({ ...base, NODE_ENV: "development", AUTH_GOOGLE_CLIENT_ID: "a", AUTH_GOOGLE_CLIENT_SECRET: "b", AUTH_GOOGLE_ISSUER: "https://evil.example" });
  assert.equal(production.social.google.issuer, "https://accounts.google.com");
});

test("Google: первый вход — регистрация без пароля, повторный — сразу на сайт, затем SSO в Life", async () => {
  const before = accountsCount();
  const user = browser(auth.issuer);
  const first = await socialLogin(user, "google", { user: { sub: "google-sub-1", email: "G.User@Gmail.com", name: "Гугл Юзер" } });
  const params = lastAuthorize("google");
  assert.equal(params.scope, "openid email profile");
  assert.equal(params.code_challenge_method, "S256");
  assert.ok(params.nonce && params.state);

  assert.match(first.result.text, /Завершите регистрацию/);
  assert.match(first.result.text, /Вы вошли через Google/);
  assert.match(first.result.text, /value="g\.user@gmail\.com"/, "почта, подтверждённая Google, подставлена в форму");
  assert.doesNotMatch(first.result.text, /type="password"/, "пароль не нужен");
  assert.equal(accountsCount(), before, "до формы аккаунт не создан");

  const done = await completeSignup(user, first.uid, first.result, { email: "g.user@gmail.com", username: "google_user", displayName: "Гугл Юзер" });
  assert.ok(done.final, `вход не вернул на сайт: ${done.status} ${done.text.slice(0, 300)}`);
  const claims = (await finishLogin(site, first.start, done.final)).claims();
  assert.match(claims.sub, /^[0-9a-f-]{36}$/, "сайт получает внутренний Endemion ID, а не номер Google");
  assert.notEqual(claims.sub, "google-sub-1");
  assert.equal(claims.email_verified, false, "почту подтверждает только письмо Endemion ID");
  const row = auth.accounts.find(claims.sub);
  assert.equal(row.password_hash, "!");
  assert.ok(auth.mailer.sent.some((letter) => letter.to === "g.user@gmail.com"), "письмо подтверждения отправлено");

  const again = browser(auth.issuer);
  const second = await socialLogin(again, "google", { user: { sub: "google-sub-1", email: "other@gmail.com", name: "Новое имя" } });
  assert.ok(second.result.final, "привязанный аккаунт входит без формы");
  assert.equal((await finishLogin(site, second.start, second.result.final)).claims().sub, claims.sub, "тот же Endemion ID");

  const lifeStart = await startLogin(life, LIFE.redirect);
  const lifeDone = await again.follow(lifeStart.url.href);
  assert.ok(lifeDone.final, "Life получает код без повторного входа");
  assert.equal((await finishLogin(life, lifeStart, lifeDone.final)).claims().sub, claims.sub, "один Endemion ID на обоих сайтах");
});

test("GitHub: вход по числовому id, почта подставляется только подтверждённая", async () => {
  const user = browser(auth.issuer);
  const first = await socialLogin(user, "github", { user: { id: 4242, login: "octocat", name: null, email: "octo@example.com", emailVerified: false } });
  const params = lastAuthorize("github");
  assert.equal(params.scope, "user:email", "только почта, без доступа к репозиториям");
  assert.equal(params.code_challenge_method, "S256");
  assert.match(first.result.text, /Завершите регистрацию/);
  assert.match(first.result.text, /name="email" type="email" value=""/, "неподтверждённая почта GitHub не подставляется");
  assert.match(first.result.text, /value="octocat"/, "имя — логин GitHub");

  const done = await completeSignup(user, first.uid, first.result, { email: "octo@endemion.test", username: "octocat" });
  assert.ok(done.final);
  const sub = (await finishLogin(site, first.start, done.final)).claims().sub;

  // Логин и почта в GitHub сменились, номер тот же — тот же аккаунт
  const second = await socialLogin(browser(auth.issuer), "github", { user: { id: 4242, login: "renamed-cat", email: "new@example.com" } });
  assert.ok(second.result.final);
  assert.equal((await finishLogin(site, second.start, second.result.final)).claims().sub, sub);
});

test("Discord: вход по id, почта только подтверждённая, имя из global_name", async () => {
  const user = browser(auth.issuer);
  const first = await socialLogin(user, "discord", { user: { id: "1234567890123456789", username: "endemion_fan", global_name: "Фанат Endemion", email: "fan@discord.test", verified: false } });
  const params = lastAuthorize("discord");
  assert.equal(params.scope, "identify email", "только профиль и почта, без серверов и сообщений");
  assert.equal(params.response_type, "code");
  assert.equal(params.code_challenge_method, "S256");
  assert.match(first.result.text, /Завершите регистрацию/);
  assert.match(first.result.text, /name="email" type="email" value=""/, "неподтверждённая почта Discord не подставляется");
  assert.match(first.result.text, /value="Фанат Endemion"/);

  const done = await completeSignup(user, first.uid, first.result, { email: "fan@endemion.test", username: "discord_fan" });
  assert.ok(done.final, done.text.slice(0, 300));
  const sub = (await finishLogin(site, first.start, done.final)).claims().sub;
  assert.equal(count("SELECT COUNT(*) AS n FROM external_identities WHERE provider = 'discord' AND provider_user_id = '1234567890123456789'"), 1);

  // Имя и почта в Discord сменились, id тот же — тот же аккаунт
  const second = await socialLogin(browser(auth.issuer), "discord", { user: { id: "1234567890123456789", username: "renamed", email: "new@discord.test", verified: true } });
  assert.ok(second.result.final);
  assert.equal((await finishLogin(site, second.start, second.result.final)).claims().sub, sub);

  // Подтверждённая почта подставляется в форму нового аккаунта
  const other = await socialLogin(browser(auth.issuer), "discord", { user: { id: "1234567890123456780", username: "verified_one", email: "ok@discord.test", verified: true } });
  assert.match(other.result.text, /name="email" type="email" value="ok@discord.test"/);
});

test("VK ID: PKCE, device_id и state при обмене кода, вход по user_id", async () => {
  const user = browser(auth.issuer);
  const first = await socialLogin(user, "vk", { user: { user_id: 777001, first_name: "Иван", last_name: "Петров", email: "ivan@vk.example" } });
  const params = lastAuthorize("vk");
  assert.equal(params.scope, "vkid.personal_info email");
  assert.equal(params.response_type, "code");
  assert.ok(params.state.length >= 32, "VK ID требует state не короче 32 символов");
  assert.match(first.result.text, /value="Иван Петров"/);

  const done = await completeSignup(user, first.uid, first.result, { email: "ivan@vk.example", username: "ivan_petrov" });
  assert.ok(done.final, done.text.slice(0, 300));
  const sub = (await finishLogin(site, first.start, done.final)).claims().sub;

  const second = await socialLogin(browser(auth.issuer), "vk", { user: { user_id: 777001, first_name: "Иван", last_name: "П." } });
  assert.ok(second.result.final);
  assert.equal((await finishLogin(site, second.start, second.result.final)).claims().sub, sub);
});

test("отмена у провайдера: снова форма входа с сообщением, аккаунт не создан", async () => {
  const before = accountsCount();
  for (const [provider, name] of [["google", "Google"], ["vk", "ВКонтакте"], ["github", "GitHub"], ["discord", "Discord"]]) {
    const { result } = await socialLogin(browser(auth.issuer), provider, { deny: true });
    assert.equal(result.status, 200);
    assert.match(result.text, new RegExp(`Вход через ${name} отменён`));
    assert.match(result.text, /name="password"/, "показана обычная форма входа");
  }
  // Некоторые провайдеры отвечают на отмену без state: вход тоже просто закрывается
  const noState = await socialLogin(browser(auth.issuer), "google", { deny: true, dropState: true });
  assert.match(noState.result.text, /Вход через Google отменён/);
  assert.equal(accountsCount(), before);
  assert.ok(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'social.cancel'") >= 4);
});

test("ошибки провайдеров: входа нет, сообщение без подробностей", async () => {
  const before = accountsCount();
  const cases = [
    ["google", { error: "server_error" }],
    ["google", { user: { sub: "x" }, tokenError: true }],
    ["google", { user: { sub: "nonce-attack" }, wrongNonce: true }],
    ["google", { user: { sub: "forged" }, badSignature: true }],
    ["github", { user: { id: 1 }, tokenError: true }],
    ["github", { user: { id: 2 }, userinfoFail: true }],
    ["vk", { user: { user_id: 3 }, tokenError: true }],
    ["vk", { user: { user_id: 4 }, userinfoFail: true }],
    ["vk", { user: { user_id: 5 }, wrongState: true }],
    ["discord", { user: { id: "1300000000000000099" }, tokenError: true }],
    ["discord", { user: { id: "1300000000000000098" }, userinfoFail: true }],
    ["discord", { user: { id: "not-a-snowflake" } }]
  ];
  for (const [provider, behaviour] of cases) {
    const { result } = await socialLogin(browser(auth.issuer), provider, behaviour);
    const label = `${provider} ${JSON.stringify(behaviour)}`;
    assert.ok(!result.final, `${label}: код не ушёл сайту`);
    assert.equal(result.status, 200, label);
    assert.match(result.text, /Не удалось войти через/, label);
    assert.doesNotMatch(result.text, /Завершите регистрацию|invalid_grant|nonce|server_error/, label);
  }
  assert.equal(accountsCount(), before);
  assert.ok(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'social.login_failed'") >= cases.length);
});

test("CSRF и повтор: ответ провайдера принимается один раз, только в начавшем вход браузере", async () => {
  // Повтор того же ответа
  const user = browser(auth.issuer);
  const signed = await socialLogin(user, "google", { user: { sub: "google-sub-1" } });
  assert.ok(signed.result.final);
  assert.equal((await user.request(signed.callback)).status, 400, "второй раз тот же ответ не принимается");

  // Чужой ответ (вход злоумышленника) в браузере жертвы, где начат свой вход
  const attacker = browser(auth.issuer);
  fake.next("github", { user: { id: 666 } });
  const attackerStart = await attacker.follow((await startLogin(site, SITE.redirect)).url.href);
  const attackerCallback = await viaProvider(attacker, `/interaction/${interactionUid(attackerStart.text)}/social/github`);
  const victim = browser(auth.issuer);
  const victimPage = await victim.follow((await startLogin(site, SITE.redirect)).url.href);
  await victim.request(`/interaction/${interactionUid(victimPage.text)}/social/github`, { method: "POST", form: {} });
  assert.equal((await victim.request(attackerCallback)).status, 400, "state не совпал с cookie жертвы");
  assert.equal((await browser(auth.issuer).request(attackerCallback)).status, 400, "без cookie начатого входа");

  // Ответ одного провайдера на адрес другого
  const mixed = browser(auth.issuer);
  fake.next("google", { user: { sub: "google-sub-1" } });
  const mixedPage = await mixed.follow((await startLogin(site, SITE.redirect)).url.href);
  const googleCallback = new URL(await viaProvider(mixed, `/interaction/${interactionUid(mixedPage.text)}/social/google`));
  assert.equal((await mixed.request(googleCallback.href.replace("/social/callback/google", "/social/callback/github"))).status, 400);

  // Повторённый state и подделанная cookie
  const doubled = browser(auth.issuer);
  fake.next("google", { user: { sub: "google-sub-1" } });
  const doubledPage = await doubled.follow((await startLogin(site, SITE.redirect)).url.href);
  const doubledCallback = new URL(await viaProvider(doubled, `/interaction/${interactionUid(doubledPage.text)}/social/google`));
  doubledCallback.searchParams.append("state", doubledCallback.searchParams.get("state"));
  assert.equal((await doubled.request(doubledCallback.href)).status, 400);
  const forged = browser(auth.issuer);
  forged.jar.set("endemion_social", "A".repeat(43));
  assert.equal((await forged.request(`/social/callback/google?state=${"A".repeat(43)}&code=x`)).status, 400, "cookie без подписи не принимается");

  // Начать вход можно только формой со страницы Endemion ID
  const page = await browser(auth.issuer).follow((await startLogin(site, SITE.redirect)).url.href);
  const uid = interactionUid(page.text);
  const crossSite = browser(auth.issuer);
  assert.equal((await crossSite.request(`/interaction/${uid}/social/google`, { method: "POST", origin: "https://evil.example", form: {} })).status, 403);
  assert.notEqual((await crossSite.request(`/interaction/${uid}/social/google`)).status, 303, "GET не начинает вход");

  // Токен формы регистрации бесполезен в другом браузере: там нет cookie входа сайта
  const owner = browser(auth.issuer);
  const pending = await socialLogin(owner, "vk", { user: { user_id: 990001, first_name: "Ч" } });
  const stolen = await browser(auth.issuer).request(`/interaction/${pending.uid}/social?t=${pendingToken(pending.result.text)}`);
  assert.equal(stolen.status, 400);
});

test("совпадение почты не объединяет аккаунты", async () => {
  const user = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect, { screen: "register" });
  const page = await user.follow(start.url.href);
  const registered = await user.follow(`/interaction/${interactionUid(page.text)}/register`, {
    method: "POST", form: { consent: "1", email: "same@example.com", username: "same_owner", password: "owner-password-1" }
  });
  assert.ok(registered.final);
  const owner = auth.accounts.findByEmail("same@example.com");
  const before = accountsCount();

  // Чужой Google-аккаунт с той же (даже подтверждённой Google) почтой
  const stranger = browser(auth.issuer);
  const first = await socialLogin(stranger, "google", { user: { sub: "google-same-mail", email: "same@example.com", emailVerified: true } });
  const done = await completeSignup(stranger, first.uid, first.result, { email: "same@example.com", username: "same_stranger" });
  assert.equal(done.status, 409);
  assert.match(done.text, /Аккаунт Endemion ID с этой почтой уже есть/);
  assert.match(done.text, /привяжите Google на странице аккаунта/);
  assert.equal(accountsCount(), before, "новый аккаунт не создан");
  assert.equal(count("SELECT COUNT(*) AS n FROM external_identities WHERE provider_user_id = 'google-same-mail'"), 0, "к владельцу почты ничего не привязано");
  assert.equal(auth.accounts.find(owner.sub).password_hash, owner.password_hash);
  assert.ok(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'social.email_conflict'") >= 1);

  // С другой почтой та же личность регистрируется отдельным аккаунтом
  const other = await completeSignup(stranger, first.uid, first.result, { email: "stranger@example.com", username: "same_stranger" });
  assert.ok(other.final);
  assert.notEqual((await finishLogin(site, first.start, other.final)).claims().sub, owner.sub);
});

const errorParam = (location) => new URL(location, auth.issuer).searchParams.get("error") || "";

/** Сделать вход в сессии давним: привязка и отвязка потребуют войти ещё раз */
function ageSessions(sub) {
  auth.db.prepare("UPDATE oidc_models SET payload = json_set(payload, '$.loginTs', ?) WHERE model = 'Session' AND account_id = ?")
    .run(Math.floor(Date.now() / 1000) - 3600, sub);
}

test("привязка и отвязка провайдера в настройках аккаунта", async () => {
  const user = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect, { screen: "register" });
  const page = await user.follow(start.url.href);
  await user.follow(`/interaction/${interactionUid(page.text)}/register`, {
    method: "POST", form: { consent: "1", email: "linker@example.com", username: "linker", password: "linker-password-1" }
  });
  const sub = auth.accounts.findByEmail("linker@example.com").sub;

  const account = await user.request("/account");
  assert.match(account.text, /Способы входа/);
  assert.equal((account.text.match(/>Привязать</g) || []).length, 4);
  assert.doesNotMatch(account.text, /apple|twitter/i);
  const csrf = csrfFrom(account.text);

  assert.equal((await user.request("/account/social/github/link", { method: "POST", form: {} })).status, 403, "без токена CSRF");
  assert.equal((await user.request("/account/social/github/link", { method: "POST", origin: "https://evil.example", form: { csrf } })).status, 403, "с чужого сайта");

  // Давний вход: сначала подтвердить его
  ageSessions(sub);
  const stale = await user.request("/account/social/github/link", { method: "POST", form: { csrf } });
  assert.match(stale.text, /Подтвердите вход/);
  const reauth = await user.follow("/account/reauth");
  assert.match(reauth.text, /name="password"/, "повторный вход спрашивает пароль при живой сессии");
  const confirmed = await user.follow(`/interaction/${interactionUid(reauth.text)}/login`, { method: "POST", form: { login: "linker", password: "linker-password-1" } });
  assert.match(confirmed.text, /Вход подтверждён/);
  const freshCsrf = csrfFrom(confirmed.text);

  fake.next("github", { user: { id: 31337, login: "linker-gh", email: "linker@users.github.test" } });
  const linkStart = await user.request("/account/social/github/link", { method: "POST", form: { csrf: freshCsrf } });
  assert.equal(linkStart.status, 303);
  const linkAnswer = await fetch(linkStart.location, { redirect: "manual" });
  const linked = await user.follow(linkAnswer.headers.get("location"));
  assert.match(linked.text, /Способ входа привязан/);
  assert.match(linked.text, /linker@users\.github\.test/);
  assert.ok(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'social.link' AND account_sub = ?", sub) === 1);

  // Теперь вход через GitHub попадает в этот же Endemion ID
  const viaGithub = await socialLogin(browser(auth.issuer), "github", { user: { id: 31337, login: "linker-gh" } });
  assert.ok(viaGithub.result.final);
  assert.equal((await finishLogin(site, viaGithub.start, viaGithub.result.final)).claims().sub, sub);

  // Тот же GitHub нельзя привязать к другому Endemion ID
  const other = browser(auth.issuer);
  const otherStart = await startLogin(site, SITE.redirect, { screen: "register" });
  const otherPage = await other.follow(otherStart.url.href);
  await other.follow(`/interaction/${interactionUid(otherPage.text)}/register`, {
    method: "POST", form: { consent: "1", email: "other-linker@example.com", username: "other_linker", password: "other-password-1" }
  });
  fake.next("github", { user: { id: 31337, login: "linker-gh" } });
  const otherLink = await other.request("/account/social/github/link", { method: "POST", form: { csrf: csrfFrom((await other.request("/account")).text) } });
  const otherResult = await other.follow((await fetch(otherLink.location, { redirect: "manual" })).headers.get("location"));
  assert.match(otherResult.text, /уже привязан к другому Endemion ID/);
  assert.equal(count("SELECT COUNT(*) AS n FROM external_identities WHERE provider_user_id = '31337'"), 1);

  // Сессия сменилась между началом привязки и ответом провайдера — ничего не привязывается
  const otherSub = auth.accounts.findByEmail("other-linker@example.com").sub;
  fake.next("vk", { user: { user_id: 555001 } });
  const vkLink = await other.request("/account/social/vk/link", { method: "POST", form: { csrf: csrfFrom((await other.request("/account")).text) } });
  const vkAnswer = (await fetch(vkLink.location, { redirect: "manual" })).headers.get("location");
  auth.db.prepare("DELETE FROM oidc_models WHERE model = 'Session' AND account_id = ?").run(otherSub);
  assert.equal((await other.request(vkAnswer)).status, 403);
  assert.equal(count("SELECT COUNT(*) AS n FROM external_identities WHERE account_sub = ?", otherSub), 0);

  // Отвязка: у аккаунта есть пароль, поэтому можно
  const unlinked = await user.request("/account/social/github/unlink", { method: "POST", form: { csrf: freshCsrf } });
  assert.match(unlinked.location, /done=unlinked/);
  const afterUnlink = await socialLogin(browser(auth.issuer), "github", { user: { id: 31337, login: "linker-gh" } });
  assert.match(afterUnlink.result.text, /Завершите регистрацию/, "после отвязки GitHub больше не входит в этот аккаунт");
});

test("аккаунт без пароля: последний способ входа не отвязывается, после пароля — отвязывается", async () => {
  const user = browser(auth.issuer);
  const signed = await socialLogin(user, "google", { user: { sub: "google-sub-1" } });
  assert.ok(signed.result.final);
  const sub = (await finishLogin(site, signed.start, signed.result.final)).claims().sub;

  const account = await user.request("/account");
  assert.match(account.text, /Задать пароль/);
  assert.doesNotMatch(account.text, /name="currentPassword"/);
  const csrf = csrfFrom(account.text);

  const refused = await user.request("/account/social/google/unlink", { method: "POST", form: { csrf } });
  assert.match(errorParam(refused.location), /единственный способ входа/);
  assert.equal(count("SELECT COUNT(*) AS n FROM external_identities WHERE account_sub = ?", sub), 1);

  ageSessions(sub);
  assert.match((await user.request("/account/password", { method: "POST", form: { csrf, newPassword: "google-user-pass-1" } })).text, /Подтвердите вход/,
    "пароль без старого пароля — только при недавнем входе");
  // Сессия жива, поэтому сайт просит войти заново (prompt=login), как при подтверждении опасного действия
  const fresh = await socialLogin(user, "google", { user: { sub: "google-sub-1" } }, { extra: { prompt: "login" } });
  assert.ok(fresh.result.final);

  const csrfNow = csrfFrom((await user.request("/account")).text);
  const saved = await user.request("/account/password", { method: "POST", form: { csrf: csrfNow, newPassword: "google-user-pass-1" } });
  assert.match(saved.location, /done=password/);
  assert.match((await user.request("/account/social/google/unlink", { method: "POST", form: { csrf: csrfNow } })).location, /done=unlinked/);

  const byPassword = browser(auth.issuer);
  const start = await startLogin(site, SITE.redirect);
  const page = await byPassword.follow(start.url.href);
  const done = await byPassword.follow(`/interaction/${interactionUid(page.text)}/login`, { method: "POST", form: { login: "google_user", password: "google-user-pass-1" } });
  assert.ok(done.final, "после отвязки входит паролем");
  assert.equal((await finishLogin(site, start, done.final)).claims().sub, sub);
});

test("заблокированный аккаунт не входит через провайдера", async () => {
  const user = browser(auth.issuer);
  const first = await socialLogin(user, "vk", { user: { user_id: 880001, first_name: "Блок" } });
  await completeSignup(user, first.uid, first.result, { email: "blocked@vk.example", username: "blocked_vk" });
  auth.db.prepare("UPDATE accounts SET status = 'blocked' WHERE email = 'blocked@vk.example'").run();
  const { result } = await socialLogin(browser(auth.issuer), "vk", { user: { user_id: 880001 } });
  assert.equal(result.status, 403);
  assert.match(result.text, /Аккаунт заблокирован/);
  assert.ok(!result.final);
});

test("вёрстка кнопок: в ряд на компьютере, столбцом во всю ширину на телефоне", () => {
  const css = readFileSync(new URL("../public/assets/auth.css", import.meta.url), "utf8");
  assert.match(css, /\.social-buttons \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile, /\.social-buttons \{\s*grid-template-columns: 1fr;/);
});
