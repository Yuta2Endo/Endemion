// Stage 11.2: утверждения портала для Endemion Life. Проверяем подпись, claims, JWKS и защиту конфигурации.
// Ключи генерируются в тесте и живут только в памяти: production-секреты не используются.

import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { after, before, test } from "node:test";
import { BASE, createApp } from "./helpers/app.mjs";
import { onRequestGet as jwksHandler } from "../functions/jwks.js";
import {
  LIFE_ASSERTION_AUDIENCE,
  LIFE_ASSERTION_AUDIENCE_DEFAULT,
  LIFE_ASSERTION_ISSUER,
  LIFE_ASSERTION_ISSUER_DEFAULT,
  LIFE_ASSERTION_SCOPE,
  getPublicJwks,
  issueAssertionForRequest,
  issuePortalAssertion,
  lifeSubjectHash
} from "../functions/_lib/lifeAssertion.js";
import { requestLifeProfile } from "../functions/_lib/lifeClient.js";

const FORGED_SUB = "33333333-3333-4333-8333-333333333333";
let app;
let keyPair;
let privateKeyBase64;
let publicKeyJwk;
let previousKeyPair;
let stagingKeyPair;
let stagingPrivateKeyBase64;
let stagingPublicKeyJwk;

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function decodeJwt(token) {
  const [header, payload, signature] = token.split(".");
  return { header: decodeSegment(header), payload: decodeSegment(payload), signingInput: `${header}.${payload}`, signature };
}

function verifyWithJwk(token, jwk) {
  const { signingInput, signature } = decodeJwt(token);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  return verifySignature("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
}

function keyEnv(overrides = {}) {
  return {
    ...app.env,
    ENDEMION_LIFE_ASSERTION: "1",
    ENDEMION_LIFE_JWT_KID: "portal-test-1",
    ENDEMION_LIFE_JWT_PRIVATE_KEY: privateKeyBase64,
    ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: "[]",
    ...overrides
  };
}

/**
 * Код ошибки из assert.rejects: аргумент приходит как unknown.
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  return /** @type {{ code?: string }} */ (error).code;
}

/**
 * @param {any} user
 * @param {string} [sub]
 */
async function withSub(user, sub = crypto.randomUUID()) {
  await app.db.prepare("UPDATE users SET endemion_sub = ? WHERE id = ?").bind(sub, user.id).run();
  user.endemionSub = sub;
  return user;
}

/** token_hash сессии из cookie: в базе и в currentUser хранится только SHA-256 токена. */
function sessionHash(cookieHeader) {
  return createHash("sha256").update(cookieHeader.slice(cookieHeader.indexOf("=") + 1)).digest("hex");
}

function captureConsole() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map((item) => String(item)).join(" "));
  return {
    lines,
    restore() {
      console.log = original;
    }
  };
}

before(async () => {
  keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  privateKeyBase64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  previousKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  // Second key pair simulating a separate environment (e.g. staging) for cross-environment tests
  stagingKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  stagingPrivateKeyBase64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", stagingKeyPair.privateKey)).toString("base64");
  stagingPublicKeyJwk = await crypto.subtle.exportKey("jwk", stagingKeyPair.publicKey);
  app = await createApp();
});

after(async () => {
  await app.close();
});

test("проверенная сессия выпускает JWT с точными iss/aud/scope и сроком 120 секунд", async () => {
  const user = await withSub(await app.user("Алиса"));
  const response = await issueAssertionForRequest(keyEnv(), new Request(`${BASE}/account`, { headers: { Cookie: user.cookie } }));
  const { header, payload } = decodeJwt(response.token);

  assert.deepEqual(header, { alg: "ES256", typ: "JWT", kid: "portal-test-1" });
  assert.equal(payload.iss, LIFE_ASSERTION_ISSUER);
  assert.equal(payload.aud, LIFE_ASSERTION_AUDIENCE);
  assert.equal(payload.scope, LIFE_ASSERTION_SCOPE);
  assert.equal(payload.sub, user.endemionSub);
  assert.equal(payload.exp - payload.iat, 120);
  assert.equal(typeof payload.jti, "string");
  assert.ok(payload.jti.length >= 16);
  assert.ok(Number.isInteger(payload.iat));
});

test("без сессии утверждение не выпускается", async () => {
  await assert.rejects(
    () => issueAssertionForRequest(keyEnv(), new Request(`${BASE}/account`)),
    (error) => errorCode(error) === "UNAUTHENTICATED"
  );
});

test("отозванная сессия портала не выпускает новое утверждение", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("Отозванная"));
  const request = new Request(`${BASE}/account`, { headers: { Cookie: user.cookie } });

  const before = await issueAssertionForRequest(env, request);
  assert.equal(typeof before.token, "string");

  // Сессия удалена (выход или отзыв): текущая cookie больше не действует
  await app.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(sessionHash(user.cookie)).run();
  await assert.rejects(() => issueAssertionForRequest(env, request), (error) => errorCode(error) === "UNAUTHENTICATED");
});

test("истёкшая сессия портала не выпускает новое утверждение", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("Истёкшая"));
  const request = new Request(`${BASE}/account`, { headers: { Cookie: user.cookie } });

  const before = await issueAssertionForRequest(env, request);
  assert.equal(typeof before.token, "string");

  await app.db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
    .bind(Date.now() - 1000, sessionHash(user.cookie))
    .run();
  await assert.rejects(() => issueAssertionForRequest(env, request), (error) => errorCode(error) === "UNAUTHENTICATED");
});

test("без endemion_sub утверждение не выпускается, почта и имя не заменяют sub", async () => {
  const user = await app.user("Без-ID");
  await assert.rejects(
    () => issuePortalAssertion(keyEnv(), user),
    (error) => errorCode(error) === "NO_SUBJECT"
  );
});

test("sub из браузера игнорируется: берётся только users.endemion_sub", async () => {
  const user = await withSub(await app.user("Браузер"));
  const token = await issuePortalAssertion(keyEnv(), { id: user.id, sub: FORGED_SUB, endemion_sub: FORGED_SUB, email: user.email });
  assert.equal(decodeJwt(token).payload.sub, user.endemionSub);
});

test("некорректный endemion_sub не подписывается", async () => {
  const user = await withSub(await app.user("Кривой-ID"), "not-a-uuid");
  await assert.rejects(
    () => issuePortalAssertion(keyEnv(), user),
    (error) => errorCode(error) === "NO_SUBJECT"
  );
});

test("jti уникален для каждого утверждения", async () => {
  const user = await withSub(await app.user("Джити"));
  const first = decodeJwt(await issuePortalAssertion(keyEnv(), user)).payload;
  const second = decodeJwt(await issuePortalAssertion(keyEnv(), user)).payload;
  assert.notEqual(first.jti, second.jti);
});

test("подпись проверяется опубликованным публичным ключом, приватных полей в JWKS нет", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("Подпись"));
  const token = await issuePortalAssertion(env, user);
  const jwks = await getPublicJwks(env);

  assert.equal(jwks.keys.length, 1);
  const key = jwks.keys[0];
  assert.deepEqual(Object.keys(key).sort(), ["alg", "crv", "kid", "kty", "use", "x", "y"]);
  assert.equal(key.alg, "ES256");
  assert.equal(key.use, "sig");
  assert.equal(key.kid, "portal-test-1");
  assert.equal(key.d, undefined);
  assert.equal(verifyWithJwk(token, key), true);
});

test("JWKS отдаёт текущий и прошлый ключи с кэш-заголовками", async () => {
  const previous = { kty: "EC", crv: "P-256", kid: "portal-test-0", x: "", y: "" };
  const exported = await crypto.subtle.exportKey("jwk", previousKeyPair.publicKey);
  previous.x = exported.x;
  previous.y = exported.y;
  const env = keyEnv({ ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: JSON.stringify([previous]) });

  const response = await jwksHandler({ env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /max-age=300/);
  assert.match(response.headers.get("Content-Type"), /application\/jwk-set\+json/);
  assert.deepEqual(body.keys.map((key) => key.kid), ["portal-test-1", "portal-test-0"]);
  for (const key of body.keys) assert.equal(key.d, undefined);
});

test("выключенная интеграция и неверная конфигурация отказывают закрыто", async () => {
  const user = await withSub(await app.user("Фейл"));
  const base = { ...app.env, ENDEMION_LIFE_JWT_KID: "portal-test-1", ENDEMION_LIFE_JWT_PRIVATE_KEY: privateKeyBase64 };

  await assert.rejects(() => issuePortalAssertion({ ...base, ENDEMION_LIFE_ASSERTION: "0" }, user), (error) => errorCode(error) === "DISABLED");
  await assert.rejects(
    () => issuePortalAssertion({ ...base, ENDEMION_LIFE_ASSERTION: "1", ENDEMION_LIFE_JWT_KID: "" }, user),
    (error) => errorCode(error) === "INVALID_CONFIG"
  );
  await assert.rejects(
    () => issuePortalAssertion({ ...base, ENDEMION_LIFE_ASSERTION: "1", ENDEMION_LIFE_JWT_PRIVATE_KEY: "bm90LWEta2V5" }, user),
    (error) => errorCode(error) === "INVALID_CONFIG"
  );
  await assert.rejects(
    () => getPublicJwks({ ...base, ENDEMION_LIFE_ASSERTION: "1", ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: '[{"kty":"EC"}]' }),
    (error) => errorCode(error) === "INVALID_CONFIG"
  );

  const response = await jwksHandler({ env: { ...base, ENDEMION_LIFE_ASSERTION: "0" } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /"keys"/);
});

test("журнал содержит хеш sub и jti, но не JWT, ключ и сырой sub", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("Журнал"));
  const capture = captureConsole();
  let token;
  try {
    token = await issuePortalAssertion(env, user);
  } finally {
    capture.restore();
  }
  const text = capture.lines.join("\n");
  const { jti } = decodeJwt(token);
  assert.match(text, /"event":"life\.assertion\.issued"/);
  assert.match(text, new RegExp(await lifeSubjectHash(user.endemionSub)));
  assert.match(text, new RegExp(jti));
  assert.equal(text.includes(token), false);
  assert.equal(text.includes(privateKeyBase64), false);
  assert.equal(text.includes(user.endemionSub), false);
  assert.equal(text.includes(user.email), false);
});

test("клиент Life выпускает новое утверждение на каждый запрос и не журналирует токен", async () => {
  const env = keyEnv({ ENDEMION_LIFE_URL: "https://life.example.test" });
  const user = await withSub(await app.user("Клиент"));
  const headers = [];
  const fetchImpl = async (url, init) => {
    headers.push(init.headers.Authorization);
    assert.equal(url, "https://life.example.test/api/portal/profile");
    return new Response(JSON.stringify({ profile: { exists: true } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const capture = captureConsole();
  let first;
  let second;
  try {
    first = await requestLifeProfile(env, user, { fetchImpl });
    second = await requestLifeProfile(env, user, { fetchImpl });
  } finally {
    capture.restore();
  }
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(headers.length, 2);
  assert.notEqual(headers[0], headers[1]);
  const text = capture.lines.join("\n");
  assert.match(text, /"event":"life\.assertion\.issued"/);
  for (const header of headers) assert.equal(text.includes(header.slice("Bearer ".length)), false);
});

test("ошибка Life журналируется как life.request.failed без тела и токена", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("Ошибка"));
  const capture = captureConsole();
  let result;
  try {
    result = await requestLifeProfile(env, user, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "NO_LIFE_PROFILE", message: "нет" } }), { status: 404 })
    });
  } finally {
    capture.restore();
  }
  assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 404, code: "NO_LIFE_PROFILE" });
  assert.match(capture.lines.join("\n"), /"event":"life\.request\.failed".*"status":404/);
});

test("маршрут /.well-known/jwks.json: 503 без ключа и 200 с ключом через общий роутер", async () => {
  const disabled = await app.client().call("GET", "/.well-known/jwks.json");
  assert.equal(disabled.status, 503);
  assert.equal(disabled.data.keys, undefined);

  const enabled = await createApp({
    extraEnv: {
      ENDEMION_LIFE_ASSERTION: "1",
      ENDEMION_LIFE_JWT_KID: "portal-test-1",
      ENDEMION_LIFE_JWT_PRIVATE_KEY: privateKeyBase64,
      ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: "[]"
    }
  });
  try {
    const response = await enabled.client().call("GET", "/.well-known/jwks.json");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/jwk-set\+json/);
    assert.deepEqual(response.data.keys.map((key) => key.kid), ["portal-test-1"]);
    assert.equal(response.data.keys[0].d, undefined);
    assert.equal(response.data.keys[0].alg, "ES256");
  } finally {
    await enabled.close();
  }
});

// ---------- Task C: JWT environment separation tests ----------

test("default production configuration produces production issuer and audience", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("default-config"));
  const token = await issuePortalAssertion(env, user);
  const { payload } = decodeJwt(token);
  assert.equal(payload.iss, LIFE_ASSERTION_ISSUER_DEFAULT);
  assert.equal(payload.aud, LIFE_ASSERTION_AUDIENCE_DEFAULT);
});

test("explicit staging configuration produces staging issuer and audience", async () => {
  const env = keyEnv({
    ENDEMION_LIFE_JWT_ISSUER: "https://staging.endemion.online",
    ENDEMION_LIFE_JWT_AUDIENCE: "https://staging-life.endemion.online"
  });
  const user = await withSub(await app.user("staging-config"));
  const token = await issuePortalAssertion(env, user);
  const { payload } = decodeJwt(token);
  assert.equal(payload.iss, "https://staging.endemion.online");
  assert.equal(payload.aud, "https://staging-life.endemion.online");
});

test("missing issuer/audience falls back to production defaults (safe default policy)", async () => {
  const env = keyEnv();
  delete env.ENDEMION_LIFE_JWT_ISSUER;
  delete env.ENDEMION_LIFE_JWT_AUDIENCE;
  const user = await withSub(await app.user("missing-config"));
  const token = await issuePortalAssertion(env, user);
  const { payload } = decodeJwt(token);
  assert.equal(payload.iss, LIFE_ASSERTION_ISSUER_DEFAULT);
  assert.equal(payload.aud, LIFE_ASSERTION_AUDIENCE_DEFAULT);
});

test("invalid issuer is rejected with INVALID_CONFIG", async () => {
  const env = keyEnv({ ENDEMION_LIFE_JWT_ISSUER: "not-a-url" });
  const user = await withSub(await app.user("bad-issuer"));
  await assert.rejects(() => issuePortalAssertion(env, user), (error) => errorCode(error) === "INVALID_CONFIG");
});

test("invalid audience is rejected with INVALID_CONFIG", async () => {
  const env = keyEnv({ ENDEMION_LIFE_JWT_AUDIENCE: "not-a-url" });
  const user = await withSub(await app.user("bad-audience"));
  await assert.rejects(() => issuePortalAssertion(env, user), (error) => errorCode(error) === "INVALID_CONFIG");
});

test("http issuer is rejected (https only)", async () => {
  const env = keyEnv({ ENDEMION_LIFE_JWT_ISSUER: "http://staging.endemion.online" });
  const user = await withSub(await app.user("http-issuer"));
  await assert.rejects(() => issuePortalAssertion(env, user), (error) => errorCode(error) === "INVALID_CONFIG");
});

test("http audience is rejected (https only)", async () => {
  const env = keyEnv({ ENDEMION_LIFE_JWT_AUDIENCE: "http://staging-life.endemion.online" });
  const user = await withSub(await app.user("http-audience"));
  await assert.rejects(() => issuePortalAssertion(env, user), (error) => errorCode(error) === "INVALID_CONFIG");
});

test("staging configuration does not silently fall back to production values", async () => {
  const env = keyEnv({
    ENDEMION_LIFE_JWT_ISSUER: "https://staging.endemion.online",
    ENDEMION_LIFE_JWT_AUDIENCE: "https://staging-life.endemion.online"
  });
  const user = await withSub(await app.user("no-fallback"));
  const token = await issuePortalAssertion(env, user);
  const { payload } = decodeJwt(token);
  assert.notEqual(payload.iss, "https://endemion.online");
  assert.notEqual(payload.aud, "https://life.endemion.online");
  assert.equal(payload.iss, "https://staging.endemion.online");
  assert.equal(payload.aud, "https://staging-life.endemion.online");
});

test("production configuration never silently adopts staging values", async () => {
  const env = keyEnv(); // no issuer/audience override → production defaults
  const user = await withSub(await app.user("prod-no-staging"));
  const token = await issuePortalAssertion(env, user);
  const { payload } = decodeJwt(token);
  assert.equal(payload.iss, "https://endemion.online");
  assert.equal(payload.aud, "https://life.endemion.online");
  assert.notEqual(payload.iss, "https://staging.endemion.online");
  assert.notEqual(payload.aud, "https://staging-life.endemion.online");
});

test("production-signed token is not verifiable with staging key (cross-environment negative)", async () => {
  const prodEnv = keyEnv({
    ENDEMION_LIFE_JWT_KID: "portal-prod-1"
  });
  const user = await withSub(await app.user("prod-signed"));
  const prodToken = await issuePortalAssertion(prodEnv, user);

  const { signingInput, signature } = decodeJwt(prodToken);
  const prodHeader = decodeJwt(prodToken).header;

  // Production token signed with production key; staging verifier has staging public key only
  const validWithStagingKey = verifySignature(
    "sha256",
    Buffer.from(signingInput),
    { key: createPublicKey({ key: stagingPublicKeyJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url")
  );
  assert.equal(validWithStagingKey, false);

  // Production token's kid is not present in staging JWKS (different kid)
  const stagingJwks = await getPublicJwks(keyEnv({
    ENDEMION_LIFE_JWT_PRIVATE_KEY: stagingPrivateKeyBase64,
    ENDEMION_LIFE_JWT_KID: "portal-staging-1",
    ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: "[]"
  }));
  assert.equal(stagingJwks.keys.find((k) => k.kid === prodHeader.kid), undefined);
});

test("staging-signed token is not verifiable with production key (cross-environment negative)", async () => {
  const stagingEnv = keyEnv({
    ENDEMION_LIFE_JWT_PRIVATE_KEY: stagingPrivateKeyBase64,
    ENDEMION_LIFE_JWT_KID: "portal-staging-1",
    ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS: "[]"
  });
  const user = await withSub(await app.user("staging-signed"));
  const stagingToken = await issuePortalAssertion(stagingEnv, user);

  const { signingInput, signature } = decodeJwt(stagingToken);
  const stagingHeader = decodeJwt(stagingToken).header;

  // Staging token signed with staging key; production verifier has production public key only
  const validWithProdKey = verifySignature(
    "sha256",
    Buffer.from(signingInput),
    { key: createPublicKey({ key: publicKeyJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url")
  );
  assert.equal(validWithProdKey, false);

  // Staging token's kid is not present in production JWKS (different kid)
  const prodJwks = await getPublicJwks(keyEnv({
    ENDEMION_LIFE_JWT_KID: "portal-prod-1"
  }));
  assert.equal(prodJwks.keys.find((k) => k.kid === stagingHeader.kid), undefined);
});

test("existing production integration tests remain valid (regression)", async () => {
  const env = keyEnv();
  const user = await withSub(await app.user("regression"));
  const token = await issuePortalAssertion(env, user);
  const { header, payload } = decodeJwt(token);
  assert.equal(header.alg, "ES256");
  assert.equal(header.typ, "JWT");
  assert.equal(payload.iss, LIFE_ASSERTION_ISSUER_DEFAULT);
  assert.equal(payload.aud, LIFE_ASSERTION_AUDIENCE_DEFAULT);
  assert.equal(payload.scope, "portal:read");
  assert.equal(typeof payload.jti, "string");
  assert.ok(payload.jti.length >= 16);
  assert.ok(Number.isInteger(payload.iat));
  assert.ok(Number.isInteger(payload.exp));
  assert.equal(payload.exp - payload.iat, 120);
  // Signature verifies with production public key
  assert.ok(verifyWithJwk(token, publicKeyJwk));
});
