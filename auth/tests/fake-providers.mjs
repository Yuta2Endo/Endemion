// Заглушки Google, GitHub, VK ID и Discord на одном локальном порту для тестов входа через провайдеров.
// Каждая проверяет то же, что настоящий провайдер: client_id, точный redirect_uri, PKCE S256, одноразовый код,
// у Google — секрет клиента и подписанный RS256 ID token с nonce, у VK — device_id и state при обмене кода.
// Поведение следующего входа задаёт тест: fake.next(provider, { user, deny, error, ... })

import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

export const GOOGLE = { id: "google-client.apps.test", secret: "google-secret-test" };
export const GITHUB = { id: "github-client-test", secret: "github-secret-test" };
export const VK = { id: "51234567" };
export const DISCORD = { id: "1300000000000000001", secret: "discord-secret-test" };

const b64u = (value) => Buffer.from(value).toString("base64url");

function signJwt(payload, privateKey, kid) {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64u(JSON.stringify(payload));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function startFakeProviders() {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const codes = new Map();
  const tokens = new Map();
  const behaviour = {};
  /** Запросы авторизации, которые получили заглушки: тесты проверяют scope и PKCE */
  const authorizeRequests = [];
  let redirectBase = "";
  let base = "";

  const redirectUri = (provider) => `${redirectBase}/social/callback/${provider}`;

  function authorize(provider, url, res) {
    const q = url.searchParams;
    authorizeRequests.push({ provider, params: Object.fromEntries(q) });
    const clientId = { google: GOOGLE.id, github: GITHUB.id, vk: VK.id, discord: DISCORD.id }[provider];
    const problems = [];
    if (q.get("client_id") !== clientId) problems.push("client_id");
    if (q.get("redirect_uri") !== redirectUri(provider)) problems.push("redirect_uri");
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") || "")) problems.push("pkce");
    if (!q.get("state") || (provider === "vk" && q.get("state").length < 32)) problems.push("state");
    if (provider !== "github" && q.get("response_type") !== "code") problems.push("response_type");
    if (provider === "google" && !q.get("nonce")) problems.push("nonce");
    // Неверный запрос: настоящий провайдер показывает свою страницу ошибки и не уходит на redirect_uri
    if (problems.length) return json(res, 400, { error: "invalid_request", problems });

    const next = behaviour[provider] || {};
    delete behaviour[provider];
    const back = new URL(q.get("redirect_uri"));
    if (next.deny || next.error) {
      back.search = new URLSearchParams({ error: next.deny ? "access_denied" : next.error, error_description: "test", ...(next.dropState ? {} : { state: q.get("state") }) }).toString();
    } else {
      const code = randomBytes(16).toString("hex");
      const deviceId = randomBytes(8).toString("hex");
      codes.set(code, { provider, challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), nonce: q.get("nonce"), state: q.get("state"), deviceId, next });
      back.search = new URLSearchParams({ code, state: q.get("state"), ...(provider === "vk" ? { device_id: deviceId, type: "code_v2", expires_in: "600" } : {}) }).toString();
    }
    res.writeHead(302, { location: back.href });
    res.end();
  }

  function takeCode(provider, form) {
    const entry = codes.get(form.get("code"));
    codes.delete(form.get("code"));
    if (!entry || entry.provider !== provider || entry.redirectUri !== form.get("redirect_uri")) return null;
    const challenge = createHash("sha256").update(form.get("code_verifier") || "").digest("base64url");
    if (challenge !== entry.challenge) return null;
    return entry;
  }

  function issueAccess(entry) {
    const accessToken = randomBytes(16).toString("hex");
    tokens.set(accessToken, entry);
    return accessToken;
  }

  async function handle(req, res) {
    const url = new URL(req.url, base);
    const path = url.pathname;

    if (path === "/google/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: `${base}/google`,
        authorization_endpoint: `${base}/google/authorize`,
        token_endpoint: `${base}/google/token`,
        jwks_uri: `${base}/google/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
      });
    }
    if (path === "/google/jwks") return json(res, 200, { keys: [{ ...key.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
    if (path === "/google/authorize") return authorize("google", url, res);
    if (path === "/github/login/oauth/authorize") return authorize("github", url, res);
    if (path === "/vk/authorize") return authorize("vk", url, res);
    if (path === "/discord/oauth2/authorize") return authorize("discord", url, res);

    if (path === "/discord/api/oauth2/token" && req.method === "POST") {
      const form = await readBody(req);
      if (form.get("client_id") !== DISCORD.id || form.get("client_secret") !== DISCORD.secret) return json(res, 401, { error: "invalid_client" });
      if (form.get("grant_type") !== "authorization_code") return json(res, 400, { error: "unsupported_grant_type" });
      const entry = takeCode("discord", form);
      if (!entry || entry.next.tokenError) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: issueAccess(entry), token_type: "Bearer", expires_in: 604800, refresh_token: "discord-refresh", scope: "identify email" });
    }

    if (path === "/discord/api/users/@me") {
      const entry = tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
      if (!entry) return json(res, 401, { message: "401: Unauthorized", code: 0 });
      if (entry.next.userinfoFail) return json(res, 500, { message: "Internal Server Error" });
      const user = entry.next.user;
      return json(res, 200, {
        id: user.id, username: user.username, global_name: user.global_name ?? null,
        email: user.email ?? null, verified: user.verified ?? Boolean(user.email)
      });
    }

    if (path === "/google/token" && req.method === "POST") {
      const form = await readBody(req);
      if (form.get("client_id") !== GOOGLE.id || form.get("client_secret") !== GOOGLE.secret) return json(res, 401, { error: "invalid_client" });
      const entry = takeCode("google", form);
      if (!entry || entry.next.tokenError) return json(res, 400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const user = entry.next.user;
      const idToken = signJwt({
        iss: `${base}/google`, aud: GOOGLE.id, sub: user.sub, iat: now, exp: now + 3600,
        nonce: entry.next.wrongNonce ? "someone-elses-nonce" : entry.nonce,
        email: user.email, email_verified: user.emailVerified ?? true, name: user.name
      }, entry.next.badSignature ? otherKey.privateKey : key.privateKey, kid);
      return json(res, 200, { access_token: issueAccess(entry), token_type: "Bearer", expires_in: 3599, id_token: idToken, scope: "openid email profile" });
    }

    if (path === "/github/login/oauth/access_token" && req.method === "POST") {
      const form = await readBody(req);
      if (form.get("client_id") !== GITHUB.id || form.get("client_secret") !== GITHUB.secret) return json(res, 200, { error: "incorrect_client_credentials" });
      const entry = takeCode("github", form);
      // Как настоящий GitHub: ошибка обмена кода приходит с HTTP 200
      if (!entry || entry.next.tokenError) return json(res, 200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
      return json(res, 200, { access_token: issueAccess(entry), token_type: "bearer", scope: "user:email" });
    }

    if (path.startsWith("/github/api/")) {
      const entry = tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
      if (!entry) return json(res, 401, { message: "Bad credentials" });
      if (entry.next.userinfoFail) return json(res, 500, { message: "Server Error" });
      const user = entry.next.user;
      if (path === "/github/api/user") return json(res, 200, { id: user.id, login: user.login, name: user.name ?? null });
      if (path === "/github/api/user/emails") return json(res, 200, user.email ? [{ email: user.email, primary: true, verified: user.emailVerified ?? true }] : []);
    }

    if (path === "/vk/oauth2/auth" && req.method === "POST") {
      const form = await readBody(req);
      const entry = codes.get(form.get("code"));
      if (!entry || form.get("client_id") !== VK.id || form.get("grant_type") !== "authorization_code") return json(res, 400, { error: "invalid_request" });
      if (form.get("device_id") !== entry.deviceId || form.get("state") !== entry.state) {
        codes.delete(form.get("code"));
        return json(res, 400, { error: "invalid_request", error_description: "device_id or state" });
      }
      const taken = takeCode("vk", form);
      if (!taken || taken.next.tokenError) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, {
        access_token: issueAccess(taken), refresh_token: "vk-refresh", id_token: "not.checked.here", token_type: "Bearer",
        expires_in: 3600, user_id: Number(taken.next.user.user_id), state: taken.next.wrongState ? "x".repeat(43) : taken.state, scope: "vkid.personal_info email"
      });
    }

    if (path === "/vk/oauth2/user_info" && req.method === "POST") {
      const form = await readBody(req);
      const entry = tokens.get(form.get("access_token") || "");
      if (!entry || form.get("client_id") !== VK.id) return json(res, 400, { error: "invalid_token" });
      if (entry.next.userinfoFail) return json(res, 500, { error: "server_error" });
      const user = entry.next.user;
      return json(res, 200, { user: { user_id: String(user.user_id), first_name: user.first_name, last_name: user.last_name, email: user.email ?? "" } });
    }

    json(res, 404, { error: "not_found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => json(res, 500, { error: err.message }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    authorizeRequests,
    /** Адрес Endemion ID: заглушки принимают только его redirect_uri */
    setRedirectBase(value) {
      redirectBase = value;
    },
    /** Как поведёт себя провайдер при следующем входе */
    next(provider, options) {
      behaviour[provider] = options;
    },
    env() {
      return {
        AUTH_GOOGLE_CLIENT_ID: GOOGLE.id,
        AUTH_GOOGLE_CLIENT_SECRET: GOOGLE.secret,
        AUTH_GOOGLE_ISSUER: `${base}/google`,
        AUTH_GITHUB_CLIENT_ID: GITHUB.id,
        AUTH_GITHUB_CLIENT_SECRET: GITHUB.secret,
        AUTH_GITHUB_AUTHORIZE_URL: `${base}/github/login/oauth/authorize`,
        AUTH_GITHUB_TOKEN_URL: `${base}/github/login/oauth/access_token`,
        AUTH_GITHUB_API_URL: `${base}/github/api`,
        AUTH_VK_CLIENT_ID: VK.id,
        AUTH_VK_BASE_URL: `${base}/vk`,
        AUTH_DISCORD_CLIENT_ID: DISCORD.id,
        AUTH_DISCORD_CLIENT_SECRET: DISCORD.secret,
        AUTH_DISCORD_AUTHORIZE_URL: `${base}/discord/oauth2/authorize`,
        AUTH_DISCORD_TOKEN_URL: `${base}/discord/api/oauth2/token`,
        AUTH_DISCORD_API_URL: `${base}/discord/api`
      };
    },
    stop: () => new Promise((resolve) => server.close(resolve))
  };
}
