// Endemion ID: OpenID Connect провайдер (oidc-provider) и свои страницы — вход, регистрация, письма, аккаунт, сессии.
// Provider сам является приложением Koa, свои маршруты подключаются через provider.use до его обработчиков

import Provider from "oidc-provider";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "./db.mjs";
import { createAdapter, cleanupExpired } from "./adapter.mjs";
import { createAccounts, validatePassword } from "./accounts.mjs";
import { createMailer } from "./mail.mjs";
import { createLimiter, createAudit, LIMITS } from "./limits.mjs";
import { createSocial, PROVIDERS, PROVIDER_NAMES, SocialError } from "./social.mjs";
import * as views from "./views.mjs";
import { AUTH_ROOT, REPO_ROOT } from "./config.mjs";

// Внутренний клиент для страниц самого Endemion ID (/login, /register → /account)
const ACCOUNT_CLIENT = "endemion-id";
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// Вход через провайдера: сколько ждём ответа провайдера и сколько — заполнения формы регистрации
const SOCIAL_LOGIN_TTL_MS = 10 * 60 * 1000;
const SOCIAL_PENDING_TTL_MS = 15 * 60 * 1000;
const SOCIAL_COOKIE = "endemion_social";
// Привязка и отвязка провайдеров, пароль без старого пароля: вход должен быть не раньше стольких секунд назад
const REAUTH_SECONDS = 10 * 60;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const STATIC_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };
// Значки сайта, которые отдаёт Endemion ID (файлы из public/ сайта)
const SHARED_ICONS = new Map([
  ["/favicon.svg", "favicon.svg"],
  ["/favicon.ico", "favicon.ico"],
  ["/icons/favicon-16x16.png", "icons/favicon-16x16.png"],
  ["/icons/favicon-32x32.png", "icons/favicon-32x32.png"]
]);

/** Тип картинки по первым байтам: расширению и заявленному Content-Type не доверяем */
function imageType(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function createLogger(production) {
  return (level, msg, extra = {}) => {
    const line = production
      ? JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra })
      : `[${level}] ${msg}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`;
    (level === "error" ? console.error : console.log)(line);
  };
}

export function createApp(config, { mailer = createMailer(config.mail), log = createLogger(config.production) } = {}) {
  const db = openDatabase(config.dbFile);
  migrate(db, config.migrationsDir);
  const accounts = createAccounts(db, { issuer: config.issuer });
  const limiter = createLimiter(db);
  const audit = createAudit(db);
  const sharedDir = path.resolve(process.env.SHARED_PUBLIC_DIR || path.join(REPO_ROOT, "public"));
  const ownDir = path.join(AUTH_ROOT, "public");

  // Сайты экосистемы и внутренний клиент страниц аккаунта
  const platformByClient = new Map(config.clients.map((client) => [client.client_id, client["urn:endemion:platform"]]));
  const clients = config.clients.map(({ "urn:endemion:platform": _platform, ...client }) => client);
  clients.push({
    client_id: ACCOUNT_CLIENT,
    token_endpoint_auth_method: "none",
    redirect_uris: [`${config.issuer}/account/callback`],
    grant_types: ["authorization_code"],
    response_types: ["code"]
  });
  const social = createSocial(config.social, { redirectBase: config.issuer });
  // Куда браузер может уйти после отправки формы входа: CSP form-action проверяет и перенаправления.
  // Кнопки входа через провайдеров — формы, поэтому адреса включённых провайдеров тоже здесь
  const redirectOrigins = [...new Set([
    ...config.clients.flatMap((client) => [...client.redirect_uris, ...client.post_logout_redirect_uris]).map((uri) => new URL(uri).origin),
    ...social.formOrigins()
  ])];

  const provider = new Provider(config.issuer, {
    adapter: createAdapter(db),
    clients,
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      long: { httpOnly: true, sameSite: "lax", signed: true },
      short: { httpOnly: true, sameSite: "lax", signed: true }
    },
    async findAccount(ctx, sub) {
      const row = accounts.find(sub);
      if (!row || row.status !== "active") return undefined;
      const platform = platformByClient.get(ctx.oidc?.client?.clientId) || null;
      return { accountId: sub, claims: (_use, scope) => accounts.claimsFor(row, new Set(String(scope || "").split(" ")), platform) };
    },
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name", "preferred_username", "picture", "updated_at", "https://endemion.online/legacy_user_id"]
    },
    scopes: ["openid", "offline_access", "email", "profile"],
    // Имя, почта и аватар сразу в ID token: сайтам не нужен лишний запрос к userinfo при входе
    conformIdTokenClaims: false,
    responseTypes: ["code"],
    // PKCE обязателен для всех клиентов, метод только S256
    pkce: { required: () => true },
    allowOmittingSingleRegisteredRedirectUri: false,
    // Браузеры не обращаются к token и userinfo напрямую: обмен кода идёт с серверов сайтов
    clientBasedCORS: () => false,
    extraParams: ["screen"],
    // Refresh token выдаётся сайтам всегда и живёт не дольше центральной сессии (expiresWithSession).
    // Сайты раз в несколько минут обновляют его: так узнают о выходе, блокировке и новом имени или аватаре
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    // Каждый refresh token одноразовый. Повторное использование отзывает весь grant (код oidc-provider)
    rotateRefreshToken: true,
    ttl: {
      AccessToken: 10 * 60,
      AuthorizationCode: 60,
      IdToken: 10 * 60,
      RefreshToken: 30 * 24 * 60 * 60,
      Interaction: 60 * 60,
      Session: 30 * 24 * 60 * 60,
      Grant: 30 * 24 * 60 * 60
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        logoutSource: async (ctx, form) => {
          ctx.type = "html";
          ctx.body = views.logoutPage({ form, clientPlatform: platformByClient.get(ctx.oidc.client?.clientId) });
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.type = "html";
          ctx.body = views.noticePage({ title: "Вы вышли", text: "Вы вышли из Endemion ID.", link: { href: "/login", text: "Войти снова" } });
        }
      }
    },
    renderError: async (ctx, out) => {
      ctx.type = "html";
      ctx.body = views.errorPage({ text: out.error_description || "Запрос входа не прошёл проверку. Начните вход заново с сайта.", status: out.error });
    }
  });
  provider.proxy = config.trustProxy;

  provider.on("server_error", (_ctx, err) => log("error", "oidc server_error", { error: err.message }));
  provider.on("grant.error", (_ctx, err) => log("warn", "grant.error", { error: err.error, description: err.error_description }));

  // ---------- общие части запросов ----------

  function securityHeaders(ctx) {
    ctx.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: " + new URL(config.links.site).origin,
      "font-src 'self'",
      "connect-src 'self'",
      `form-action 'self' ${redirectOrigins.join(" ")}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'"
    ].join("; "));
    ctx.set("X-Content-Type-Options", "nosniff");
    ctx.set("X-Frame-Options", "DENY");
    // Не no-referrer: с ним браузер отправляет формы с Origin: null, и проверка sameOrigin отклоняет их (403).
    // same-origin отдаёт адрес страницы только своему сайту: адрес с uid входа на чужие сайты не уходит
    ctx.set("Referrer-Policy", "same-origin");
    ctx.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    ctx.set("Cross-Origin-Opener-Policy", "same-origin");
    if (config.production) ctx.set("Strict-Transport-Security", "max-age=31536000");
  }

  /** Изменяющий запрос принимается только со страниц самого Endemion ID (защита от CSRF) */
  function sameOrigin(ctx) {
    const origin = ctx.get("origin");
    if (origin) return origin === config.issuer;
    const referer = ctx.get("referer");
    if (!referer) return false;
    try {
      return new URL(referer).origin === config.issuer;
    } catch {
      return false;
    }
  }

  async function readBody(ctx, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > maxBytes) ctx.throw(413, "Слишком большой запрос.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }

  async function readForm(ctx) {
    if (!ctx.is("application/x-www-form-urlencoded")) ctx.throw(415, "Неверный формат формы.");
    return Object.fromEntries(new URLSearchParams((await readBody(ctx, 16 * 1024)).toString("utf8")));
  }

  function html(ctx, body, status = 200) {
    ctx.status = status;
    ctx.type = "html";
    ctx.set("Cache-Control", "no-store");
    ctx.body = body;
  }

  /** Центральная сессия браузера: из неё страницы аккаунта узнают, кто вошёл */
  async function currentSession(ctx) {
    const session = await provider.Session.get(ctx);
    if (!session.accountId) return null;
    const account = accounts.find(session.accountId);
    if (!account || account.status !== "active") return null;
    return { session, account };
  }

  function csrfFor(session) {
    return createHmac("sha256", config.cookieKeys[0]).update("csrf:" + session.uid).digest("base64url");
  }

  function checkCsrf(session, value) {
    const expected = Buffer.from(csrfFor(session));
    const actual = Buffer.from(String(value || ""));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  // ---------- письма ----------

  function issueToken(sub, purpose, email, ttl) {
    const token = newToken();
    db.prepare("DELETE FROM auth_tokens WHERE account_sub = ? AND purpose = ?").run(sub, purpose);
    db.prepare("INSERT INTO auth_tokens (account_sub, purpose, token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sub, purpose, sha256(token), email, Date.now() + ttl, Date.now());
    return token;
  }

  /** Одноразовый токен из письма: удаляется при первом же использовании */
  function consumeToken(token, purpose) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const row = db.prepare("DELETE FROM auth_tokens WHERE token_hash = ? AND purpose = ? RETURNING account_sub, email, expires_at")
      .get(sha256(token), purpose);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { account_sub: String(row.account_sub), email: String(row.email) };
  }

  function sendInBackground(letter, event) {
    mailer.send(letter).catch((err) => log("error", "mail failed", { event, error: err.message }));
  }

  function sendVerification(account) {
    if (!mailer.enabled) return;
    const link = `${config.issuer}/verify-email?token=${issueToken(account.sub, "verify_email", account.email, VERIFY_TTL_MS)}`;
    sendInBackground({
      to: account.email,
      subject: "Подтвердите почту для Endemion ID",
      text: `Здравствуйте, ${account.display_name}!\n\nПодтвердите почту для Endemion ID: ${link}\nСсылка действует 24 часа. Если вы не создавали аккаунт, просто удалите письмо.`,
      html: `<p>Здравствуйте, ${views.escapeHtml(account.display_name)}!</p><p><a href="${views.escapeHtml(link)}">Подтвердить почту для Endemion ID</a></p><p>Ссылка действует 24 часа. Если вы не создавали аккаунт, просто удалите письмо.</p>`
    }, "verify_email");
  }

  function sendReset(account) {
    const link = `${config.issuer}/reset-password?token=${issueToken(account.sub, "reset_password", account.email, RESET_TTL_MS)}`;
    sendInBackground({
      to: account.email,
      subject: "Новый пароль для Endemion ID",
      text: `Чтобы задать новый пароль для Endemion ID, откройте ссылку: ${link}\nСсылка действует 1 час. Если вы не просили новый пароль, ничего не делайте: старый продолжит работать.`,
      html: `<p><a href="${views.escapeHtml(link)}">Задать новый пароль для Endemion ID</a></p><p>Ссылка действует 1 час. Если вы не просили новый пароль, ничего не делайте: старый продолжит работать.</p>`
    }, "reset_password");
  }

  // ---------- сессии и отзыв ----------

  const now = () => Math.floor(Date.now() / 1000);

  function listSessions(sub, currentId) {
    return db.prepare("SELECT id, payload, user_agent, ip FROM oidc_models WHERE model = 'Session' AND account_id = ? AND (expires_at IS NULL OR expires_at > ?)")
      .all(sub, now())
      .map((row) => {
        const payload = JSON.parse(String(row.payload));
        return {
          id: row.id,
          current: row.id === currentId,
          loginTs: payload.loginTs,
          userAgent: row.user_agent,
          ip: row.ip,
          grants: Object.values(payload.authorizations || {}).map((item) => item.grantId).filter(Boolean),
          platforms: Object.keys(payload.authorizations || {}).map((clientId) => platformByClient.get(clientId)).filter(Boolean)
        };
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || b.loginTs - a.loginTs);
  }

  function revokeGrants(grantIds) {
    const byGrant = db.prepare("DELETE FROM oidc_models WHERE grant_id = ? OR (model = 'Grant' AND id = ?)");
    for (const grantId of grantIds) byGrant.run(grantId, grantId);
  }

  /** Завершить все сессии и отозвать все токены аккаунта, кроме сессии keepSessionId и её grant'ов */
  function revokeAll(sub, keepSessionId = null) {
    const keep = keepSessionId ? listSessions(sub, keepSessionId).find((item) => item.current) : null;
    const keepGrants = new Set(keep?.grants || []);
    const rows = db.prepare("SELECT model, id, grant_id FROM oidc_models WHERE account_id = ?").all(sub);
    const remove = db.prepare("DELETE FROM oidc_models WHERE model = ? AND id = ?");
    for (const row of rows) {
      if (row.model === "Session" && row.id === keepSessionId) continue;
      if (row.model === "Grant" && keepGrants.has(row.id)) continue;
      if (row.grant_id && keepGrants.has(row.grant_id)) continue;
      remove.run(row.model, row.id);
    }
  }

  // ---------- вход через Google, VK ID, GitHub ----------

  /** Вход в эту сессию был недавно: привязка провайдеров и пароль без старого пароля */
  const recentLogin = (session) => Boolean(session.loginTs) && now() - session.loginTs <= REAUTH_SECONDS;

  function reauthPage(ctx) {
    html(ctx, views.noticePage({
      title: "Подтвердите вход",
      kind: "error",
      text: "Для этого действия войдите ещё раз: последний вход был больше 10 минут назад.",
      link: { href: "/account/reauth", text: "Войти ещё раз" }
    }), 200);
  }

  /**
   * Уйти к провайдеру. verifier и nonce остаются в базе, state — в подписанной cookie этого браузера.
   * Ответ провайдера примется только в том же браузере и только один раз
   */
  async function beginSocial(ctx, id, { purpose, interactionUid = null, accountSub = null }) {
    const start = await social.begin(id);
    db.prepare("INSERT INTO social_logins (state_hash, provider, purpose, interaction_uid, account_sub, code_verifier, nonce, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(start.state), id, purpose, interactionUid, accountSub, start.verifier, start.nonce, Date.now() + SOCIAL_LOGIN_TTL_MS);
    ctx.cookies.set(SOCIAL_COOKIE, start.state, {
      httpOnly: true, sameSite: "lax", signed: true, secure: ctx.secure, path: "/social/callback", maxAge: SOCIAL_LOGIN_TTL_MS, overwrite: true
    });
    ctx.status = 303;
    ctx.redirect(start.url.href);
  }

  /**
   * Начатый вход по state из cookie. Запись удаляется сразу: второй раз тот же ответ не примется.
   * Ответ с ошибкой без state (некоторые провайдеры так отвечают на отмену) только закрывает вход этого браузера:
   * он ничего не выдаёт и не привязывает, поэтому подделать его безопасно
   */
  function takeSocialLogin(ctx, id) {
    const state = ctx.cookies.get(SOCIAL_COOKIE, { signed: true });
    ctx.cookies.set(SOCIAL_COOKIE, null, { path: "/social/callback", signed: true, overwrite: true });
    const query = new URLSearchParams(ctx.querystring);
    const fromUrl = query.getAll("state");
    const errorOnly = fromUrl.length === 0 && query.has("error");
    if (!state || !TOKEN_RE.test(state) || !(errorOnly || (fromUrl.length === 1 && fromUrl[0] === state))) return null;
    const row = db.prepare("DELETE FROM social_logins WHERE state_hash = ? RETURNING provider, purpose, interaction_uid, account_sub, code_verifier, nonce, expires_at")
      .get(sha256(state));
    if (!row || Number(row.expires_at) < Date.now() || row.provider !== id) return null;
    return {
      state,
      purpose: String(row.purpose),
      interaction_uid: row.interaction_uid === null ? null : String(row.interaction_uid),
      account_sub: row.account_sub === null ? null : String(row.account_sub),
      code_verifier: String(row.code_verifier),
      nonce: row.nonce === null ? null : String(row.nonce)
    };
  }

  /** Личность провайдера, которая ждёт завершения входа в interaction uid */
  function findPending(token, uid) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    return db.prepare("SELECT * FROM social_pending WHERE token_hash = ? AND interaction_uid = ? AND expires_at > ?").get(sha256(token), uid, Date.now()) || null;
  }

  const deletePending = (token) => db.prepare("DELETE FROM social_pending WHERE token_hash = ?").run(sha256(token));

  function socialFailed(ctx, row, id, err) {
    const code = err instanceof SocialError ? err.code : "provider";
    const cancelled = code === "cancelled";
    audit(cancelled ? "social.cancel" : "social.login_failed", { sub: row.account_sub, ip: ctx.ip, detail: `${id}: ${err.message}` });
    if (!cancelled) log("warn", "social login failed", { provider: id, code, error: err.message });
    const name = PROVIDER_NAMES[id];
    if (row.purpose === "link") {
      return backToAccount(ctx, { error: cancelled ? `Привязка ${name} отменена.` : `Не удалось привязать ${name}. Попробуйте ещё раз.` });
    }
    ctx.status = 303;
    ctx.redirect(`/interaction/${encodeURIComponent(row.interaction_uid)}?${new URLSearchParams({ social: cancelled ? "cancelled" : "failed", provider: id })}`);
  }

  /** Вход в существующий аккаунт через привязанного провайдера */
  async function socialSignIn(ctx, account, provider, providerUserId, clientId) {
    if (account.status !== "active") {
      audit("social.blocked", { sub: account.sub, ip: ctx.ip, detail: provider });
      return html(ctx, views.errorPage({ text: "Аккаунт заблокирован. Напишите в поддержку Endemion." }), 403);
    }
    accounts.touchIdentity(provider, providerUserId);
    audit("social.login", { sub: account.sub, ip: ctx.ip, detail: `${provider} ${clientId}` });
    await finishInteraction(ctx, { login: { accountId: account.sub, remember: true, amr: ["fed"] } }, false);
  }

  function socialNotice(query) {
    const name = PROVIDER_NAMES[query.provider];
    if (!name) return {};
    if (query.social === "cancelled") return { notice: `Вход через ${name} отменён.` };
    if (query.social === "failed") return { error: `Не удалось войти через ${name}. Попробуйте ещё раз или войдите другим способом.` };
    return {};
  }

  // ---------- маршруты ----------

  async function startAccountLogin(ctx, screen, { reauth = false } = {}) {
    const url = new URL("/auth", config.issuer);
    url.search = new URLSearchParams({
      client_id: ACCOUNT_CLIENT,
      redirect_uri: `${config.issuer}/account/callback`,
      response_type: "code",
      scope: "openid",
      // Ответ этому клиенту никто не обменивает, state только подсказывает странице аккаунта, что вход был повторным
      state: `${reauth ? "reauth." : ""}${newToken()}`,
      // Код этого клиента никто не обменивает: verifier не сохраняется, PKCE нужен только по правилам провайдера
      code_challenge: createHash("sha256").update(newToken()).digest("base64url"),
      code_challenge_method: "S256",
      ...(screen ? { screen } : {}),
      ...(reauth ? { prompt: "login" } : {})
    }).toString();
    ctx.status = 303;
    ctx.redirect(url.href);
  }

  async function interactionDetails(ctx) {
    try {
      return await provider.interactionDetails(ctx.req, ctx.res);
    } catch {
      return null;
    }
  }

  function expiredInteraction(ctx) {
    html(ctx, views.errorPage({ title: "Вход устарел", text: "Страница входа устарела. Вернитесь на сайт и нажмите «Войти» ещё раз." }), 400);
  }

  async function finishInteraction(ctx, result, merge) {
    const returnTo = await provider.interactionResult(ctx.req, ctx.res, result, { mergeWithLastSubmission: merge });
    ctx.redirect(returnTo);
    ctx.status = 303;
  }

  /** Сайты экосистемы — свои, согласие на передачу данных даётся при регистрации, отдельный экран не нужен */
  async function autoConsent(ctx, details) {
    const { prompt: { details: missing }, params, session } = details;
    const grant = details.grantId
      ? await provider.Grant.find(details.grantId)
      : new provider.Grant({ accountId: session.accountId, clientId: params.client_id });
    if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(" "));
    if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
    if (missing.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(missing.missingResourceScopes)) grant.addResourceScope(indicator, scopes.join(" "));
    }
    const grantId = await grant.save();
    await finishInteraction(ctx, { consent: details.grantId ? {} : { grantId } }, true);
  }

  /** @type {Record<string, (ctx: any, params?: Record<string, string>) => Promise<any>>} */
  const routes = {
    "GET /healthz": async (ctx) => {
      db.prepare("SELECT 1").get();
      ctx.set("Cache-Control", "no-store");
      ctx.body = { status: "ok" };
    },

    "GET /": async (ctx) => ctx.redirect("/account"),

    "GET /login": async (ctx) => {
      if (await currentSession(ctx)) return ctx.redirect("/account");
      await startAccountLogin(ctx, null);
    },

    "GET /register": async (ctx) => {
      if (await currentSession(ctx)) return ctx.redirect("/account");
      await startAccountLogin(ctx, "register");
    },

    "GET /account/callback": async (ctx) => {
      if (ctx.query.error) return html(ctx, views.errorPage({ text: "Вход не завершён. Попробуйте ещё раз." }), 400);
      ctx.redirect(String(ctx.query.state || "").startsWith("reauth.") ? "/account?done=reauth" : "/account");
    },

    // Повторный вход перед привязкой провайдера или паролем без старого пароля
    "GET /account/reauth": async (ctx) => startAccountLogin(ctx, null, { reauth: true }),

    "GET /interaction/:uid": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx);
      if (details.prompt.name === "consent") return autoConsent(ctx, details);
      const clientPlatform = platformByClient.get(details.params.client_id);
      const providers = socialButtons();
      // После отмены или ошибки у провайдера — форма входа с сообщением, даже если вход начинался с регистрации
      if (details.params.screen === "register" && !ctx.query.social) {
        return html(ctx, views.registerPage({ uid, clientPlatform, privacyUrl: config.links.privacy, providers }));
      }
      html(ctx, views.loginPage({ uid, clientPlatform, mailEnabled: mailer.enabled, login: details.params.login_hint || "", providers, ...socialNotice(ctx.query) }));
    },

    "GET /interaction/:uid/register": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx);
      html(ctx, views.registerPage({ uid, clientPlatform: platformByClient.get(details.params.client_id), privacyUrl: config.links.privacy, providers: socialButtons() }));
    },

    // Кнопка «Войти через …»: форма POST, общий обработчик уже проверил Origin
    "POST /interaction/:uid/social/:provider": async (ctx, { uid, provider }) => {
      if (!social.enabled.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const ipKey = `social-ip:${ctx.ip}`;
      if (limiter.exceeded(ipKey, LIMITS.socialIp)) {
        return html(ctx, views.loginPage({ uid, clientPlatform: platformByClient.get(details.params.client_id), mailEnabled: mailer.enabled, providers: socialButtons(), error: "Слишком много попыток входа. Подождите 15 минут." }), 429);
      }
      limiter.record(ipKey);
      try {
        await beginSocial(ctx, provider, { purpose: "login", interactionUid: uid });
      } catch (err) {
        // Не открылись настройки провайдера (discovery Google): пользователь остаётся на форме входа
        log("warn", "social start failed", { provider, error: err.message });
        ctx.status = 303;
        ctx.redirect(`/interaction/${encodeURIComponent(uid)}?${new URLSearchParams({ social: "failed", provider })}`);
      }
    },

    // Ответ провайдера. Здесь нет cookie входа сайта (у неё путь /interaction/<uid>), поэтому найденная
    // личность провайдера сохраняется, и браузер уходит завершать вход на /interaction/<uid>/social
    "GET /social/callback/:provider": async (ctx, { provider }) => {
      if (!social.enabled.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      const row = takeSocialLogin(ctx, provider);
      if (!row) {
        audit("social.state_mismatch", { ip: ctx.ip, detail: provider });
        return html(ctx, views.errorPage({ title: "Вход не завершён", text: `Ответ ${PROVIDER_NAMES[provider]} не подходит к этому входу или устарел. Вернитесь на сайт и начните вход заново.` }), 400);
      }
      const query = new URLSearchParams(ctx.querystring);
      if (!query.has("state")) {
        const error = String(query.get("error"));
        return socialFailed(ctx, row, provider, new SocialError(error === "access_denied" ? "cancelled" : "provider", `${error} (без state)`));
      }
      let identity;
      try {
        identity = await social.finish(provider, query, { state: row.state, verifier: row.code_verifier, nonce: row.nonce });
      } catch (err) {
        return socialFailed(ctx, row, provider, err);
      }

      if (row.purpose === "link") {
        const current = await currentSession(ctx);
        // Привязка только к тому аккаунту, который её начал: вышли или вошли в другой — ничего не привязывается
        if (!current || current.account.sub !== row.account_sub) {
          audit("social.link_session_changed", { sub: row.account_sub, ip: ctx.ip, detail: provider });
          return html(ctx, views.errorPage({ text: "Привязка не завершена: за это время вы вышли или вошли в другой аккаунт." }), 403);
        }
        const result = accounts.linkIdentity(current.account.sub, { provider, ...identity });
        const name = PROVIDER_NAMES[provider];
        if (result.error) {
          audit("social.link_rejected", { sub: current.account.sub, ip: ctx.ip, detail: `${provider}: ${result.error}` });
          const text = {
            taken: `Этот аккаунт ${name} уже привязан к другому Endemion ID. Войдите в тот Endemion ID и отвяжите его там.`,
            already: `Этот аккаунт ${name} уже привязан.`,
            provider_linked: `К Endemion ID уже привязан другой аккаунт ${name}. Сначала отвяжите его.`
          }[result.error];
          return backToAccount(ctx, { error: text });
        }
        audit("social.link", { sub: current.account.sub, ip: ctx.ip, detail: provider });
        return backToAccount(ctx, { done: "linked" });
      }

      const token = newToken();
      db.prepare("INSERT INTO social_pending (token_hash, interaction_uid, provider, provider_user_id, email, name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(sha256(token), row.interaction_uid, provider, identity.id, identity.email, identity.name, Date.now() + SOCIAL_PENDING_TTL_MS);
      ctx.status = 303;
      ctx.redirect(`/interaction/${encodeURIComponent(row.interaction_uid)}/social?t=${token}`);
    },

    // Завершение входа через провайдера: привязанный аккаунт — сразу на сайт, иначе форма регистрации.
    // Токен из адреса бесполезен в другом браузере: без cookie этого входа interactionDetails вернёт null
    "GET /interaction/:uid/social": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const token = String(ctx.query.t || "");
      const pending = findPending(token, uid);
      if (!pending) return expiredInteraction(ctx);
      const account = accounts.findByIdentity(pending.provider, pending.provider_user_id);
      if (account) {
        deletePending(token);
        return socialSignIn(ctx, account, pending.provider, pending.provider_user_id, details.params.client_id);
      }
      html(ctx, views.socialCompletePage({
        uid, token,
        providerName: PROVIDER_NAMES[pending.provider],
        clientPlatform: platformByClient.get(details.params.client_id),
        values: { email: pending.email || "", displayName: pending.name || "" },
        privacyUrl: config.links.privacy
      }));
    },

    "POST /interaction/:uid/social": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const form = await readForm(ctx);
      const pending = findPending(form.token, uid);
      if (!pending) return expiredInteraction(ctx);
      const providerName = PROVIDER_NAMES[pending.provider];
      const clientPlatform = platformByClient.get(details.params.client_id);
      const values = { email: form.email, username: form.username, displayName: form.displayName, consent: form.consent === "1" };
      const page = (errors, error, status) => html(ctx, views.socialCompletePage({ uid, token: form.token, providerName, clientPlatform, values, errors, error, privacyUrl: config.links.privacy }), status);

      // Та же личность могла зарегистрироваться в другой вкладке
      const existing = accounts.findByIdentity(pending.provider, pending.provider_user_id);
      if (existing) {
        deletePending(form.token);
        return socialSignIn(ctx, existing, pending.provider, pending.provider_user_id, details.params.client_id);
      }
      const ipKey = `register-ip:${ctx.ip}`;
      if (limiter.exceeded(ipKey, LIMITS.registerIp)) return page({}, "Слишком много регистраций с вашего адреса. Подождите 15 минут.", 429);
      if (!values.consent) return page({ consent: "Нужно согласие с политикой конфиденциальности." }, null, 400);
      limiter.record(ipKey);

      const result = accounts.registerExternal(values, { provider: pending.provider, id: pending.provider_user_id, email: pending.email, name: pending.name });
      if (result.conflict) {
        // Аккаунты не объединяются по совпавшей почте: владелец входит в свой аккаунт и привязывает провайдера сам
        audit("social.email_conflict", { ip: ctx.ip, detail: pending.provider });
        return page({ email: result.error }, `Аккаунт Endemion ID с этой почтой уже есть. Если он ваш, войдите в него паролем и привяжите ${providerName} на странице аккаунта. Или укажите другую почту.`, 409);
      }
      if (result.error) return page({ [result.field]: result.error }, null, 400);
      deletePending(form.token);
      accounts.touchIdentity(pending.provider, pending.provider_user_id);
      audit("social.signup", { sub: result.account.sub, ip: ctx.ip, detail: `${pending.provider} ${details.params.client_id}` });
      sendVerification(result.account);
      await finishInteraction(ctx, { login: { accountId: result.account.sub, remember: true, amr: ["fed"] } }, false);
    },

    "POST /interaction/:uid/login": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const form = await readForm(ctx);
      const clientPlatform = platformByClient.get(details.params.client_id);
      const login = String(form.login || "").trim().slice(0, 254);
      const page = (error, status) => html(ctx, views.loginPage({ uid, clientPlatform, login, error, mailEnabled: mailer.enabled }), status);

      if (!login || !form.password) return page("Введите почту или имя пользователя и пароль.", 400);
      const ipKey = `login-ip:${ctx.ip}`;
      const loginKey = `login:${login.toLowerCase()}`;
      if (limiter.exceeded(ipKey, LIMITS.loginIp) || limiter.exceeded(loginKey, LIMITS.loginAccount)) {
        audit("login.rate_limited", { ip: ctx.ip });
        return page("Слишком много попыток входа. Подождите 15 минут.", 429);
      }
      limiter.record(ipKey);

      const result = await accounts.authenticate(login, String(form.password).slice(0, 256));
      if (result.error) {
        limiter.record(loginKey);
        audit(`login.${result.error}`, { sub: result.account?.sub, ip: ctx.ip });
        if (result.error === "locked") return page("Слишком много неверных паролей. Вход в аккаунт закрыт на 15 минут, можно восстановить пароль.", 429);
        if (result.error === "blocked") return page("Аккаунт заблокирован. Напишите в поддержку Endemion.", 403);
        return page("Неверная почта, имя пользователя или пароль.", 401);
      }
      limiter.clear(loginKey);
      audit("login.success", { sub: result.account.sub, ip: ctx.ip, detail: details.params.client_id });
      await finishInteraction(ctx, { login: { accountId: result.account.sub, remember: true, amr: ["pwd"] } }, false);
    },

    "POST /interaction/:uid/register": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const form = await readForm(ctx);
      const clientPlatform = platformByClient.get(details.params.client_id);
      const values = { email: form.email, username: form.username, displayName: form.displayName, consent: form.consent === "1" };
      const page = (errors, error, status) => html(ctx, views.registerPage({ uid, clientPlatform, values, errors, error, privacyUrl: config.links.privacy }), status);

      const ipKey = `register-ip:${ctx.ip}`;
      if (limiter.exceeded(ipKey, LIMITS.registerIp)) return page({}, "Слишком много регистраций с вашего адреса. Подождите 15 минут.", 429);
      if (!values.consent) return page({ consent: "Нужно согласие с политикой конфиденциальности." }, null, 400);
      limiter.record(ipKey);

      const result = await accounts.register({ ...values, password: String(form.password || "") });
      if (result.error) return page({ [result.field]: result.error }, null, 400);
      audit("register", { sub: result.account.sub, ip: ctx.ip, detail: details.params.client_id });
      sendVerification(result.account);
      await finishInteraction(ctx, { login: { accountId: result.account.sub, remember: true, amr: ["pwd"] } }, false);
    },

    "GET /verify-email": async (ctx) => {
      const token = String(ctx.query.token || "");
      if (!TOKEN_RE.test(token)) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела." }), 400);
      // Подтверждение — отдельной кнопкой: почтовые сканеры открывают ссылки сами и не должны тратить токен
      html(ctx, views.verifyPage({ token }));
    },

    "POST /verify-email": async (ctx) => {
      const form = await readForm(ctx);
      const row = consumeToken(form.token, "verify_email");
      const account = row && accounts.find(row.account_sub);
      // Почта могла смениться после отправки письма: подтверждается только тот адрес, на который ушла ссылка
      if (!account || account.email !== row.email) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела. Отправьте письмо ещё раз со страницы аккаунта." }), 400);
      accounts.markEmailVerified(account.sub);
      audit("email.verified", { sub: account.sub, ip: ctx.ip });
      html(ctx, views.noticePage({ title: "Почта подтверждена", text: `Адрес ${account.email} подтверждён.`, link: { href: "/account", text: "К аккаунту" } }));
    },

    "GET /forgot-password": async (ctx) => {
      if (!mailer.enabled) return html(ctx, views.errorPage({ text: "Восстановление пароля временно недоступно: не настроена отправка писем." }), 503);
      html(ctx, views.forgotPage({}));
    },

    "POST /forgot-password": async (ctx) => {
      if (!mailer.enabled) return html(ctx, views.errorPage({ text: "Восстановление пароля временно недоступно." }), 503);
      const form = await readForm(ctx);
      const email = String(form.email || "").trim().toLowerCase().slice(0, 254);
      const mailKey = `mail:${email}`;
      const ipKey = `mail-ip:${ctx.ip}`;
      if (limiter.exceeded(ipKey, LIMITS.mailIp)) return html(ctx, views.forgotPage({ email, error: "Слишком много запросов. Подождите 15 минут." }), 429);
      limiter.record(ipKey);
      // Ответ одинаковый, есть такой аккаунт или нет: по нему нельзя узнать чужую почту
      if (!limiter.exceeded(mailKey, LIMITS.mailAddress)) {
        limiter.record(mailKey);
        const account = accounts.findByEmail(email);
        if (account && account.status === "active") {
          sendReset(account);
          audit("password.reset_requested", { sub: account.sub, ip: ctx.ip });
        }
      }
      html(ctx, views.forgotPage({ sent: true }));
    },

    "GET /reset-password": async (ctx) => {
      const token = String(ctx.query.token || "");
      if (!TOKEN_RE.test(token)) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела. Запросите новую." }), 400);
      html(ctx, views.resetPage({ token }));
    },

    "POST /reset-password": async (ctx) => {
      const form = await readForm(ctx);
      const password = String(form.password || "");
      const error = validatePassword(password);
      if (error) return html(ctx, views.resetPage({ token: form.token, error }), 400);
      const row = consumeToken(form.token, "reset_password");
      const account = row && accounts.find(row.account_sub);
      if (!account) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела. Запросите новую." }), 400);
      await accounts.setPassword(account.sub, password);
      // Владелец почты подтвердил её этой ссылкой
      if (account.email === row.email) accounts.markEmailVerified(account.sub);
      revokeAll(account.sub);
      db.prepare("DELETE FROM auth_tokens WHERE account_sub = ? AND purpose = 'reset_password'").run(account.sub);
      audit("password.reset", { sub: account.sub, ip: ctx.ip });
      html(ctx, views.noticePage({ title: "Пароль изменён", text: "Новый пароль сохранён. На всех устройствах и сайтах нужно войти заново.", link: { href: "/login", text: "Войти" } }));
    },

    "GET /account": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const notice = {
        saved: "Изменения сохранены.",
        password: "Пароль сохранён. Остальные сессии завершены.",
        email: "Почта изменена. Мы отправили письмо для подтверждения.",
        sent: "Письмо отправлено.",
        avatar: "Аватар обновлён.",
        linked: "Способ входа привязан.",
        unlinked: "Способ входа отвязан.",
        reauth: "Вход подтверждён. Теперь можно изменить способы входа."
      }[ctx.query.done];
      const linked = new Map(accounts.identities(current.account.sub).map((item) => [item.provider, item]));
      html(ctx, views.accountPage({
        account: current.account,
        avatarUrl: accounts.avatarUrl(current.account),
        csrf: csrfFor(current.session),
        notice,
        error: ctx.query.error ? String(ctx.query.error).slice(0, 300) : null,
        links: config.links,
        mailEnabled: mailer.enabled,
        hasPassword: accounts.hasPassword(current.account),
        // Отключённый в настройках, но привязанный раньше провайдер показывается: его можно отвязать
        loginMethods: PROVIDERS.filter((id) => social.enabled.includes(id) || linked.has(id))
          .map((id) => ({ id, name: PROVIDER_NAMES[id], enabled: social.enabled.includes(id), identity: linked.get(id) || null }))
      }));
    },

    "POST /account/profile": accountAction(async (ctx, { account }, form) => {
      const result = accounts.updateProfile(account.sub, { username: form.username, displayName: form.displayName });
      if (result.error) return backToAccount(ctx, { error: result.error });
      audit("profile.update", { sub: account.sub, ip: ctx.ip, detail: `${account.username} -> ${result.account.username}` });
      backToAccount(ctx, { done: "saved" });
    }),

    "POST /account/email": accountAction(async (ctx, { account, session }, form) => {
      // У аккаунта без пароля (вход через провайдера) вместо пароля — недавний вход
      if (!accounts.hasPassword(account)) {
        if (!recentLogin(session)) return reauthPage(ctx);
      } else if (!(await accounts.checkPassword(account.sub, form.password))) return backToAccount(ctx, { error: "Неверный текущий пароль." });
      const result = accounts.changeEmail(account.sub, form.email);
      if (result.error) return backToAccount(ctx, { error: result.error });
      audit("email.change", { sub: account.sub, ip: ctx.ip });
      sendVerification(result.account);
      backToAccount(ctx, { done: "email" });
    }),

    "POST /account/verify-email": accountAction(async (ctx, { account }) => {
      const key = `mail:${account.email}`;
      if (limiter.exceeded(key, LIMITS.mailAddress)) return backToAccount(ctx, { error: "Письмо уже отправлено. Следующее можно запросить через 15 минут." });
      limiter.record(key);
      sendVerification(account);
      backToAccount(ctx, { done: "sent" });
    }),

    "POST /account/password": accountAction(async (ctx, { account, session }, form) => {
      const firstPassword = !accounts.hasPassword(account);
      if (firstPassword) {
        if (!recentLogin(session)) return reauthPage(ctx);
      } else if (!(await accounts.checkPassword(account.sub, form.currentPassword))) return backToAccount(ctx, { error: "Неверный текущий пароль." });
      const result = await accounts.setPassword(account.sub, String(form.newPassword || ""));
      if (result.error) return backToAccount(ctx, { error: result.error });
      revokeAll(account.sub, session.jti);
      audit(firstPassword ? "password.set" : "password.change", { sub: account.sub, ip: ctx.ip });
      backToAccount(ctx, { done: "password" });
    }),

    // Привязка провайдера: форма на странице аккаунта (CSRF), вход не старше 10 минут
    "POST /account/social/:provider/link": accountAction(async (ctx, { account, session }, _form, { provider }) => {
      if (!social.enabled.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      if (!recentLogin(session)) return reauthPage(ctx);
      if (accounts.identities(account.sub).some((item) => item.provider === provider)) {
        return backToAccount(ctx, { error: `${PROVIDER_NAMES[provider]} уже привязан. Чтобы привязать другой аккаунт, сначала отвяжите этот.` });
      }
      try {
        await beginSocial(ctx, provider, { purpose: "link", accountSub: account.sub });
      } catch (err) {
        log("warn", "social start failed", { provider, error: err.message });
        backToAccount(ctx, { error: `${PROVIDER_NAMES[provider]} сейчас недоступен. Попробуйте позже.` });
      }
    }),

    "POST /account/social/:provider/unlink": accountAction(async (ctx, { account, session }, _form, { provider }) => {
      if (!PROVIDERS.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      if (!recentLogin(session)) return reauthPage(ctx);
      const linked = accounts.identities(account.sub);
      if (!linked.some((item) => item.provider === provider)) return backToAccount(ctx, { done: "unlinked" });
      // Последний способ входа не отвязывается: без него в аккаунт будет не попасть
      if (!accounts.hasPassword(account) && linked.length <= 1) {
        return backToAccount(ctx, { error: `Это единственный способ входа. Сначала задайте пароль или привяжите другой способ, потом отвяжите ${PROVIDER_NAMES[provider]}.` });
      }
      accounts.unlinkIdentity(account.sub, provider);
      audit("social.unlink", { sub: account.sub, ip: ctx.ip, detail: provider });
      backToAccount(ctx, { done: "unlinked" });
    }),

    "POST /account/avatar": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current || !sameOrigin(ctx) || !checkCsrf(current.session, ctx.get("x-csrf-token"))) ctx.throw(403, "Запрос отклонён.");
      const bytes = await readBody(ctx, AVATAR_MAX_BYTES);
      if (!imageType(bytes)) ctx.throw(415, "Нужна картинка PNG, JPEG или WebP.");
      mkdirSync(config.avatarsDir, { recursive: true });
      writeFileSync(path.join(config.avatarsDir, current.account.sub), bytes);
      const version = Date.now();
      accounts.setAvatarVersion(current.account.sub, version);
      audit("avatar.update", { sub: current.account.sub, ip: ctx.ip });
      ctx.set("Cache-Control", "no-store");
      ctx.body = { avatar: accounts.avatarUrl(accounts.find(current.account.sub)) };
    },

    "GET /avatars/:sub": async (ctx, { sub }) => {
      const file = path.join(config.avatarsDir, sub);
      if (!UUID_RE.test(sub) || !existsSync(file)) ctx.throw(404, "Нет такого аватара.");
      const bytes = readFileSync(file);
      ctx.type = imageType(bytes) || "application/octet-stream";
      // Адрес меняется с каждой новой версией (?v=), поэтому картинку можно кешировать надолго
      ctx.set("Cache-Control", "public, max-age=31536000, immutable");
      ctx.set("Cross-Origin-Resource-Policy", "cross-origin");
      ctx.body = bytes;
    },

    "GET /sessions": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const notice = { revoked: "Сессия завершена.", others: "Все остальные сессии завершены." }[ctx.query.done];
      html(ctx, views.sessionsPage({ sessions: listSessions(current.account.sub, current.session.jti), csrf: csrfFor(current.session), notice }));
    },

    "POST /sessions/revoke": accountAction(async (ctx, { account, session }, form) => {
      const target = listSessions(account.sub, session.jti).find((item) => item.id === form.id && !item.current);
      if (target) {
        revokeGrants(target.grants);
        db.prepare("DELETE FROM oidc_models WHERE model = 'Session' AND id = ? AND account_id = ?").run(target.id, account.sub);
        audit("session.revoke", { sub: account.sub, ip: ctx.ip });
      }
      ctx.redirect("/sessions?done=revoked");
    }),

    "POST /sessions/revoke-others": accountAction(async (ctx, { account, session }) => {
      for (const item of listSessions(account.sub, session.jti)) {
        if (item.current) continue;
        revokeGrants(item.grants);
        db.prepare("DELETE FROM oidc_models WHERE model = 'Session' AND id = ? AND account_id = ?").run(item.id, account.sub);
      }
      audit("session.revoke_others", { sub: account.sub, ip: ctx.ip });
      ctx.redirect("/sessions?done=others");
    }),

    // Выход: страница подтверждения провайдера (end_session), там же выход со всех сайтов
    "GET /logout": async (ctx) => ctx.redirect("/session/end")
  };

  /** Кнопки входа: только провайдеры, для которых заданы ключи */
  function socialButtons() {
    return social.enabled.map((id) => ({ id, name: PROVIDER_NAMES[id] }));
  }

  function backToAccount(ctx, params) {
    ctx.status = 303;
    ctx.redirect(`/account?${new URLSearchParams(params)}`);
  }

  /** Форма на странице аккаунта: нужен вход, запрос со своего сайта и токен CSRF из формы */
  function accountAction(handler) {
    return async (ctx, params) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const form = await readForm(ctx);
      if (!checkCsrf(current.session, form.csrf)) ctx.throw(403, "Запрос отклонён. Обновите страницу и попробуйте ещё раз.");
      ctx.status = 303;
      await handler(ctx, current, form, params);
    };
  }

  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ");
    return { method, parts: pattern.split("/").filter(Boolean), handler };
  });

  function match(method, pathname) {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of compiled) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params = {};
      if (route.parts.every((part, i) => (part.startsWith(":") ? ((params[part.slice(1)] = parts[i]), true) : part === parts[i]))) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  function serveStatic(ctx) {
    const own = ctx.path.match(/^\/assets\/([a-z-]+\.(?:css|js))$/);
    const font = ctx.path.match(/^\/assets\/fonts\/([a-z0-9-]+\.woff2)$/);
    const file = own ? path.join(ownDir, "assets", own[1])
      : font ? path.join(sharedDir, "assets", "fonts", font[1])
        : SHARED_ICONS.has(ctx.path) ? path.join(sharedDir, SHARED_ICONS.get(ctx.path)) : null;
    if (!file || !existsSync(file)) return false;
    ctx.type = STATIC_TYPES[path.extname(file)];
    ctx.set("Cache-Control", font ? "public, max-age=31536000, immutable" : "public, max-age=300");
    ctx.body = readFileSync(file);
    return true;
  }

  provider.use(async (ctx, next) => {
    securityHeaders(ctx);
    const started = Date.now();
    try {
      if ((ctx.method === "GET" || ctx.method === "HEAD") && serveStatic(ctx)) return;
      const found = match(ctx.method === "HEAD" ? "GET" : ctx.method, ctx.path);
      if (!found) return await next();
      if (ctx.method === "POST" && !sameOrigin(ctx)) ctx.throw(403, "Запрос отклонён.");
      await found.handler(ctx, found.params);
    } catch (err) {
      const status = err.status && err.status < 500 ? err.status : 500;
      if (status === 500) log("error", "request failed", { path: ctx.path, error: err.message, stack: err.stack });
      const text = status === 500 ? "Ошибка сервера. Попробуйте позже." : err.expose ? err.message : "Запрос отклонён.";
      if (ctx.path === "/account/avatar") {
        ctx.status = status;
        ctx.body = { error: text };
      } else {
        html(ctx, views.errorPage({ text, status }), status);
      }
    } finally {
      if (config.production && ctx.path !== "/healthz") {
        log("info", "request", { method: ctx.method, path: ctx.path, status: ctx.status, ms: Date.now() - started });
      }
    }
  });

  function cleanup() {
    cleanupExpired(db);
    limiter.cleanup();
    db.prepare("DELETE FROM auth_tokens WHERE expires_at < ?").run(Date.now());
    db.prepare("DELETE FROM social_logins WHERE expires_at < ?").run(Date.now());
    db.prepare("DELETE FROM social_pending WHERE expires_at < ?").run(Date.now());
  }

  return { provider, db, accounts, mailer, audit, cleanup, revokeAll, close: () => db.close() };
}
