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
import * as views from "./views.mjs";
import { AUTH_ROOT, REPO_ROOT } from "./config.mjs";

// Внутренний клиент для страниц самого Endemion ID (/login, /register → /account)
const ACCOUNT_CLIENT = "endemion-id";
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const STATIC_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

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
  const clients = config.clients.map(({ "urn:endemion:platform": _platform, "urn:endemion:profile_update_uri": _update, ...client }) => client);
  clients.push({
    client_id: ACCOUNT_CLIENT,
    token_endpoint_auth_method: "none",
    redirect_uris: [`${config.issuer}/account/callback`],
    grant_types: ["authorization_code"],
    response_types: ["code"]
  });
  // Куда браузер может уйти после отправки формы входа: CSP form-action проверяет и перенаправления
  const redirectOrigins = [...new Set(config.clients.flatMap((client) => [...client.redirect_uris, ...client.post_logout_redirect_uris]).map((uri) => new URL(uri).origin))];

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
    ctx.set("Referrer-Policy", "no-referrer");
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

  // ---------- маршруты ----------

  async function startAccountLogin(ctx, screen) {
    const url = new URL("/auth", config.issuer);
    url.search = new URLSearchParams({
      client_id: ACCOUNT_CLIENT,
      redirect_uri: `${config.issuer}/account/callback`,
      response_type: "code",
      scope: "openid",
      state: newToken(),
      // Код этого клиента никто не обменивает: verifier не сохраняется, PKCE нужен только по правилам провайдера
      code_challenge: createHash("sha256").update(newToken()).digest("base64url"),
      code_challenge_method: "S256",
      ...(screen ? { screen } : {})
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
      ctx.redirect("/account");
    },

    "GET /interaction/:uid": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx);
      if (details.prompt.name === "consent") return autoConsent(ctx, details);
      const clientPlatform = platformByClient.get(details.params.client_id);
      if (details.params.screen === "register") {
        return html(ctx, views.registerPage({ uid, clientPlatform, privacyUrl: config.links.privacy }));
      }
      html(ctx, views.loginPage({ uid, clientPlatform, mailEnabled: mailer.enabled, login: details.params.login_hint || "" }));
    },

    "GET /interaction/:uid/register": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx);
      html(ctx, views.registerPage({ uid, clientPlatform: platformByClient.get(details.params.client_id), privacyUrl: config.links.privacy }));
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
      const notice = { saved: "Изменения сохранены.", password: "Пароль изменён. Остальные сессии завершены.", email: "Почта изменена. Мы отправили письмо для подтверждения.", sent: "Письмо отправлено.", avatar: "Аватар обновлён." }[ctx.query.done];
      html(ctx, views.accountPage({
        account: current.account,
        avatarUrl: accounts.avatarUrl(current.account),
        csrf: csrfFor(current.session),
        notice,
        error: ctx.query.error ? String(ctx.query.error).slice(0, 200) : null,
        links: config.links,
        mailEnabled: mailer.enabled
      }));
    },

    "POST /account/profile": accountAction(async (ctx, { account }, form) => {
      const result = accounts.updateProfile(account.sub, { username: form.username, displayName: form.displayName });
      if (result.error) return backToAccount(ctx, { error: result.error });
      audit("profile.update", { sub: account.sub, ip: ctx.ip, detail: `${account.username} -> ${result.account.username}` });
      backToAccount(ctx, { done: "saved" });
    }),

    "POST /account/email": accountAction(async (ctx, { account }, form) => {
      if (!(await accounts.checkPassword(account.sub, form.password))) return backToAccount(ctx, { error: "Неверный текущий пароль." });
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
      if (!(await accounts.checkPassword(account.sub, form.currentPassword))) return backToAccount(ctx, { error: "Неверный текущий пароль." });
      const result = await accounts.setPassword(account.sub, String(form.newPassword || ""));
      if (result.error) return backToAccount(ctx, { error: result.error });
      revokeAll(account.sub, session.jti);
      audit("password.change", { sub: account.sub, ip: ctx.ip });
      backToAccount(ctx, { done: "password" });
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
        : ctx.path === "/favicon.svg" ? path.join(sharedDir, "favicon.svg") : null;
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
  }

  return { provider, db, accounts, mailer, audit, cleanup, revokeAll, close: () => db.close() };
}
