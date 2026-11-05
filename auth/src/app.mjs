// Endemion ID: OpenID Connect провайдер (oidc-provider) и свои страницы — вход, регистрация, письма, аккаунт, сессии.
// Provider сам является приложением Koa, свои маршруты подключаются через provider.use до его обработчиков

import Provider from "oidc-provider";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "./db.mjs";
import { createAdapter, cleanupExpired } from "./adapter.mjs";
import { createAccounts, validatePassword } from "./accounts.mjs";
import { createMailer } from "./mail.mjs";
import { createLimiter, createAudit, LIMITS } from "./limits.mjs";
import { createSocial, PROVIDERS, PROVIDER_NAMES, SocialError } from "./social.mjs";
import * as views from "./views.mjs";
import { useLegal } from "./views.mjs";
import { decryptSecret, encryptSecret, generateBackupCodes, generateSecret, hashBackup, normalizeCode, otpauthUrl, verifyTotp } from "./totp.mjs";
import { authenticationOptions, newChallenge, registrationOptions, verifyAuthentication, verifyRegistration } from "./webauthn.mjs";
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
/** JPEG без APP1/COM, PNG без текстовых и EXIF-чанков: в аватар не попадают координаты */
function stripMetadata(bytes, type) {
  if (type === "image/jpeg") return stripJpeg(bytes);
  if (type === "image/png") return stripPng(bytes);
  if (type === "image/webp") return stripWebp(bytes);
  return bytes;
}

function stripWebp(bytes) {
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return bytes;
  if (!bytes.includes(Buffer.from("VP8"))) return bytes;
  const dropped = new Set(["EXIF", "XMP "]);
  const chunks = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const kind = bytes.toString("latin1", i, i + 4);
    const length = bytes.readUInt32LE(i + 4);
    let end = i + 8 + length;
    if (length % 2 && end < bytes.length) end += 1;
    if (end > bytes.length) return bytes;
    if (!dropped.has(kind)) chunks.push(bytes.subarray(i, end));
    i = end;
  }
  const body = Buffer.concat(chunks);
  const out = Buffer.alloc(12 + body.length);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(4 + body.length, 4);
  out.write("WEBP", 8, "latin1");
  body.copy(out, 12);
  return out;
}

function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      out.push(bytes.subarray(i));
      return Buffer.concat(out);
    }
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return bytes;
    if (marker !== 0xe1 && marker !== 0xfe) out.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return bytes;
}

function stripPng(bytes) {
  const dropped = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
  const out = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(i);
    const kind = bytes.toString("latin1", i + 4, i + 8);
    const end = i + 12 + length;
    if (end > bytes.length) return bytes;
    if (!dropped.has(kind)) out.push(bytes.subarray(i, end));
    if (kind === "IEND") break;
    i = end;
  }
  return Buffer.concat(out);
}

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
  useLegal(config.links);
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
      ctx.body = views.errorPage({
        text: out.error_description || "Запрос входа не прошёл проверку. Начните вход заново.",
        status: out.error,
        retry: true
      });
    }
  });
  provider.proxy = config.trustProxy;

  // На каких сайтах бывал аккаунт: каждая выдача токенов сайту (вход и сверка сессии) обновляет последний вход
  const touchActivity = db.prepare(
    `INSERT INTO client_activity (account_sub, client_id) VALUES (?, ?)
     ON CONFLICT (account_sub, client_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
  );
  provider.on("grant.success", (ctx) => {
    const sub = ctx.oidc?.entities?.Grant?.accountId;
    const clientId = ctx.oidc?.client?.clientId;
    if (!sub || !clientId || !platformByClient.has(clientId)) return;
    try {
      touchActivity.run(sub, clientId);
    } catch (err) {
      log("error", "client activity failed", { error: err.message });
    }
  });

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

  async function readJson(ctx) {
    if (!ctx.is("application/json")) ctx.throw(415, "Неверный формат.");
    return JSON.parse((await readBody(ctx, 16 * 1024)).toString("utf8"));
  }

  async function readForm(ctx) {
    if (!ctx.is("application/x-www-form-urlencoded")) ctx.throw(415, "Неверный формат формы.");
    return Object.fromEntries(new URLSearchParams((await readBody(ctx, 16 * 1024)).toString("utf8")));
  }

  const rpId = () => new URL(config.issuer).hostname;

  function saveWebauthn(id, purpose, challenge, { sub = null, uid = null } = {}) {
    db.prepare("DELETE FROM webauthn_challenges WHERE id = ?").run(id);
    db.prepare("INSERT INTO webauthn_challenges (id, purpose, account_sub, interaction_uid, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, purpose, sub, uid, challenge, Date.now() + 5 * 60 * 1000);
  }

  function takeWebauthn(id, purpose) {
    const row = db.prepare("DELETE FROM webauthn_challenges WHERE id = ? AND purpose = ? RETURNING challenge, account_sub, interaction_uid, expires_at").get(id, purpose);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return row;
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
  function sameAsIdentity(password, account) {
    const lower = String(password || "").toLowerCase();
    return lower === account.username.toLowerCase() || lower === account.email.toLowerCase();
  }

  function peekToken(token, purpose) {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const row = db.prepare("SELECT account_sub, email, expires_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?").get(sha256(token), purpose);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { account_sub: String(row.account_sub), email: String(row.email) };
  }

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

  function notifyDeleted(account) {
    if (!mailer.enabled) return;
    sendInBackground({
      to: account.email,
      subject: "Endemion ID удалён",
      text: `Аккаунт ${account.username} удалён. Если это были не вы, напишите в поддержку Endemion.`,
      html: `<p>Аккаунт <strong>${views.escapeHtml(account.username)}</strong> удалён.</p><p>Если это были не вы, напишите в поддержку Endemion.</p>`
    }, "account_deleted");
  }

  function recoveryLink(account, restoreEmail = null) {
    const token = newToken();
    db.prepare("INSERT INTO login_alerts (token_hash, account_sub, restore_email, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), account.sub, restoreEmail, Date.now() + 24 * 60 * 60 * 1000);
    return `${config.issuer}/login-alert?token=${token}`;
  }

  function notifyAccountChange(account, subject, what) {
    if (!mailer.enabled) return;
    const link = recoveryLink(account);
    sendInBackground({
      to: account.email,
      subject,
      text: `${what} Если это были не вы, задайте новый пароль: ${link}\nСсылка действует 24 часа и завершит все сессии.`,
      html: `<p>${views.escapeHtml(what)}</p><p>Если это были не вы, <a href="${views.escapeHtml(link)}">задайте новый пароль</a>. Ссылка действует 24 часа и завершит все сессии.</p>`
    }, "account_changed");
  }

  function notifyEmailChange(account, nextEmail) {
    if (!mailer.enabled || account.email === nextEmail) return;
    const link = recoveryLink(account, account.email);
    sendInBackground({
      to: account.email,
      subject: "Почта Endemion ID изменена",
      text: `Почта аккаунта ${account.username} изменена на ${nextEmail}. Если это были не вы, задайте новый пароль: ${link}\nСсылка действует 24 часа и не зависит от нового адреса.`,
      html: `<p>Почта аккаунта <strong>${views.escapeHtml(account.username)}</strong> изменена на ${views.escapeHtml(nextEmail)}.</p><p>Если это были не вы, <a href="${views.escapeHtml(link)}">задайте новый пароль</a>. Ссылка действует 24 часа и не зависит от нового адреса.</p>`
    }, "email_changed");
  }

  function notifyNewLogin(account, ip) {
    if (!mailer.enabled || !ip) return;
    const created = Date.parse(account.created_at);
    if (Number.isFinite(created) && Date.now() - created < 15 * 60 * 1000) return;
    const seen = db.prepare("SELECT 1 FROM audit_log WHERE account_sub = ? AND ip = ? AND event IN ('login.success', 'social.login', 'passkey.login') AND created_at > datetime('now', '-1 day')").get(account.sub, ip);
    if (seen) return;
    const link = recoveryLink(account);
    sendInBackground({
      to: account.email,
      subject: "Новый вход в Endemion ID",
      text: `В аккаунт ${account.username} только что вошли с адреса ${ip}. Если это были не вы, задайте новый пароль: ${link}\nСсылка действует 24 часа и завершит все сессии.`,
      html: `<p>В аккаунт <strong>${views.escapeHtml(account.username)}</strong> только что вошли с адреса ${views.escapeHtml(ip)}.</p><p>Если это были не вы, <a href="${views.escapeHtml(link)}">задайте новый пароль</a>. Ссылка действует 24 часа и завершит все сессии.</p>`
    }, "login_notice");
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

  const SCOPE_ORDER = ["openid", "email", "profile", "offline_access"];

  /** Приложения, которым аккаунт выдал доступ. Грант страницы самого Endemion ID не показывается */
  function listApps(sub) {
    const byClient = new Map();
    for (const row of db.prepare("SELECT id, payload FROM oidc_models WHERE model = 'Grant' AND account_id = ? AND (expires_at IS NULL OR expires_at > ?)").all(sub, now())) {
      const payload = JSON.parse(String(row.payload));
      if (!payload.clientId || payload.clientId === ACCOUNT_CLIENT) continue;
      const scopes = String(payload.openid?.scope || "").split(" ").filter(Boolean);
      const seen = db.prepare("SELECT last_seen_at FROM client_activity WHERE account_sub = ? AND client_id = ?").get(sub, payload.clientId);
      const current = byClient.get(payload.clientId) || { id: payload.clientId, name: views.platformName(platformByClient.get(payload.clientId)), scopes: new Set(), grants: [], lastSeen: seen?.last_seen_at || null };
      for (const scope of scopes) current.scopes.add(scope);
      current.grants.push(row.id);
      byClient.set(payload.clientId, current);
    }
    return [...byClient.values()].map((app) => ({
      ...app,
      scopes: [...app.scopes].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b))
    }));
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

  // ---------- внутренний API для админки сайта ----------

  function checkAdminToken(header) {
    const expected = Buffer.from(`Bearer ${config.adminToken}`);
    const actual = Buffer.from(String(header || ""));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  const clientsOf = (platform) => [...platformByClient].filter(([, value]) => value === platform).map(([id]) => id);
  const activityOf = db.prepare("SELECT client_id, first_seen_at, last_seen_at FROM client_activity WHERE account_sub = ?");

  /** Аккаунты с сайтами, где они бывали. platform: all, endemion, endemion_life или none (ни на одном сайте) */
  function listAccounts({ query, platform, limit, offset }) {
    const where = [];
    const binds = [];
    if (query) {
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(a.email LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\' OR a.sub = ?)");
      binds.push(pattern, pattern, pattern, query.toLowerCase());
    }
    if (platform === "none") {
      where.push("NOT EXISTS (SELECT 1 FROM client_activity c WHERE c.account_sub = a.sub)");
    } else if (platform !== "all") {
      const ids = clientsOf(platform);
      where.push(ids.length ? `EXISTS (SELECT 1 FROM client_activity c WHERE c.account_sub = a.sub AND c.client_id IN (${ids.map(() => "?").join(", ")}))` : "0");
      binds.push(...ids);
    }
    const condition = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(
      `SELECT a.sub, a.email, a.email_verified_at, a.username, a.display_name, a.avatar_version, a.status, a.created_at
       FROM accounts a${condition} ORDER BY a.created_at DESC, a.sub LIMIT ? OFFSET ?`
    ).all(...binds, limit, offset);
    const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM accounts a${condition}`).get(...binds).n);
    return {
      total,
      accounts: rows.map((row) => {
        // У сайта может быть несколько client_id: даты сводятся по сайту
        const platforms = new Map();
        for (const item of activityOf.all(row.sub)) {
          const name = platformByClient.get(String(item.client_id));
          if (!name) continue;
          const seen = platforms.get(name);
          const first = String(item.first_seen_at);
          const last = String(item.last_seen_at);
          platforms.set(name, seen
            ? { platform: name, firstSeenAt: first < seen.firstSeenAt ? first : seen.firstSeenAt, lastSeenAt: last > seen.lastSeenAt ? last : seen.lastSeenAt }
            : { platform: name, firstSeenAt: first, lastSeenAt: last });
        }
        return {
          sub: String(row.sub),
          email: String(row.email),
          emailVerified: Boolean(row.email_verified_at),
          username: String(row.username),
          displayName: String(row.display_name),
          avatarUrl: accounts.avatarUrl(row),
          status: String(row.status),
          createdAt: String(row.created_at),
          platforms: [...platforms.values()]
        };
      })
    };
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

  const totpOf = db.prepare("SELECT secret, last_step FROM totp WHERE account_sub = ?");
  const backupLeft = db.prepare("SELECT COUNT(*) AS n FROM totp_backup WHERE account_sub = ? AND used_at IS NULL");

  function totpStatus(sub) {
    const row = totpOf.get(sub);
    if (!row) return null;
    return { enabled: true, backups: backupLeft.get(sub).n };
  }

  function saveChallenge(uid, sub, amr) {
    db.prepare("INSERT INTO login_challenges (interaction_uid, account_sub, amr, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (interaction_uid) DO UPDATE SET account_sub = excluded.account_sub, amr = excluded.amr, expires_at = excluded.expires_at")
      .run(uid, sub, amr, Date.now() + 10 * 60 * 1000);
  }

  function takeChallenge(uid) {
    const row = db.prepare("SELECT account_sub, amr, expires_at FROM login_challenges WHERE interaction_uid = ?").get(uid);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { sub: String(row.account_sub), amr: String(row.amr).split(" ").filter(Boolean) };
  }

  /** Код или запасной код. Запасной тратится сразу, шаг TOTP запоминается, чтобы тот же код не прошёл второй раз */
  function secondFactorOk(account, raw) {
    if (!totpOf.get(account.sub)) return { ok: true };
    const key = `totp-action:${account.sub}`;
    if (limiter.exceeded(key, LIMITS.loginAccount)) return { ok: false, error: "Слишком много попыток. Подождите 15 минут." };
    if (!acceptSecondFactor(account.sub, raw)) {
      limiter.record(key);
      return { ok: false, error: "Нужен код из приложения." };
    }
    limiter.clear(key);
    return { ok: true };
  }

  function acceptSecondFactor(sub, raw) {
    const code = normalizeCode(raw);
    const row = totpOf.get(sub);
    if (!row || !code) return false;
    const secret = decryptSecret(row.secret, config.cookieKeys[0]);
    const step = secret && verifyTotp(secret, code, { lastStep: Number(row.last_step) });
    if (step) {
      db.prepare("UPDATE totp SET last_step = ? WHERE account_sub = ?").run(step, sub);
      return true;
    }
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return false;
    return db.prepare("UPDATE totp_backup SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE account_sub = ? AND code_hash = ? AND used_at IS NULL").run(sub, hashBackup(code)).changes > 0;
  }

  async function beginLogin(ctx, account, amr, uid = null) {
    const details = await interactionDetails(ctx);
    const interactionUid = uid || details?.uid;
    if (totpOf.get(account.sub)) {
      if (!interactionUid) return html(ctx, views.errorPage({ text: "Вход не завершён. Начните заново.", retry: true }), 400);
      saveChallenge(interactionUid, account.sub, amr.join(" "));
      return html(ctx, views.totpLoginPage({ uid: interactionUid }));
    }
    await finishInteraction(ctx, { login: { accountId: account.sub, remember: true, amr } }, false);
  }

  function socialFailed(ctx, row, id, err) {
    const code = err instanceof SocialError ? err.code : "provider";
    const cancelled = code === "cancelled";
    audit(cancelled ? "social.cancel" : "social.login_failed", { sub: row.account_sub, ip: ctx.ip, detail: `${id}: ${err.message}` });
    if (!cancelled) log("warn", "social login failed", { provider: id, code, error: err.message });
    const name = PROVIDER_NAMES[id];
    if (row.purpose === "link") {
      return backToSecurity(ctx, { error: cancelled ? `Привязка ${name} отменена.` : `Не удалось привязать ${name}. Попробуйте ещё раз.` });
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
    notifyNewLogin(account, ctx.ip);
    audit("social.login", { sub: account.sub, ip: ctx.ip, detail: `${provider} ${clientId}` });
    await beginLogin(ctx, account, ["fed"]);
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

  // Протухшая страница входа не должна оставлять тупик: без сессии сразу новый вход, с сессией — в кабинет.
  // Чужой запрос (GET с токеном, POST) отказ получает как есть: иначе украденная ссылка молча начинала бы чужой вход
  async function expiredInteraction(ctx, { restart = false } = {}) {
    if (restart && ctx.method === "GET" && !(await currentSession(ctx))) return startAccountLogin(ctx, null);
    if (restart && await currentSession(ctx)) return ctx.redirect("/account");
    html(ctx, views.errorPage({
      title: "Вход устарел",
      text: "Страница входа устарела. Начните вход заново — возвращаться на сайт не нужно.",
      retry: true
    }), 400);
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
    "GET /robots.txt": async (ctx) => {
      ctx.type = "text/plain; charset=utf-8";
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.body = "User-agent: *\nDisallow: /\n";
    },

    "GET /healthz": async (ctx) => {
      db.prepare("SELECT 1").get();
      ctx.set("Cache-Control", "no-store");
      ctx.body = { status: "ok" };
    },

    // Аккаунты для админки endemion.online: поиск, фильтр по сайту, постраничная выдача.
    // Только из сети Docker (через Caddy запрос приходит с X-Forwarded-For) и только с секретом AUTH_ADMIN_TOKEN
    "GET /internal/accounts": async (ctx) => {
      ctx.set("Cache-Control", "no-store");
      if (!config.adminToken || ctx.get("x-forwarded-for") || !checkAdminToken(ctx.get("authorization"))) {
        ctx.status = 404;
        ctx.body = { error: "not_found" };
        return;
      }
      const query = String(ctx.query.q || "").trim().slice(0, 100);
      const platform = String(ctx.query.platform || "all");
      const limit = Number(ctx.query.limit || 50);
      const offset = Number(ctx.query.offset || 0);
      if (!["all", "endemion", "endemion_life", "none"].includes(platform)
        || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
        ctx.status = 400;
        ctx.body = { error: "bad_request" };
        return;
      }
      ctx.body = listAccounts({ query, platform, limit, offset });
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
      if (ctx.query.error) return html(ctx, views.errorPage({ text: "Вход не завершён. Попробуйте ещё раз.", retry: true }), 400);
      ctx.redirect(String(ctx.query.state || "").startsWith("reauth.") ? "/account/security?done=reauth" : "/account");
    },

    // Повторный вход перед привязкой провайдера или паролем без старого пароля
    "GET /account/reauth": async (ctx) => startAccountLogin(ctx, null, { reauth: true }),

    "GET /interaction/:uid": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx, { restart: true });
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
      if (!details || details.uid !== uid) return expiredInteraction(ctx, { restart: true });
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
        return html(ctx, views.errorPage({ title: "Вход не завершён", text: `Ответ ${PROVIDER_NAMES[provider]} не подходит к этому входу или устарел. Начните вход заново.`, retry: true }), 400);
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
          return backToSecurity(ctx, { error: text });
        }
        notifyAccountChange(current.account, "Новый способ входа", `К аккаунту ${current.account.username} привязан ${PROVIDER_NAMES[provider]}.`);
      audit("social.link", { sub: current.account.sub, ip: ctx.ip, detail: provider });
        return backToSecurity(ctx, { done: "linked" });
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
      notifyNewLogin(result.account, ctx.ip);
      audit("login.success", { sub: result.account.sub, ip: ctx.ip, detail: details.params.client_id });
      await beginLogin(ctx, result.account, ["pwd"], uid);
    },

    "GET /interaction/:uid/passkey/options": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid) return expiredInteraction(ctx);
      const challenge = newChallenge();
      saveWebauthn(uid, "login", challenge, { uid });
      ctx.body = authenticationOptions(rpId(), challenge);
    },

    "POST /interaction/:uid/passkey": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const body = await readJson(ctx);
      const pending = takeWebauthn(uid, "login");
      const key = db.prepare("SELECT id, account_sub, public_key, sign_count FROM passkeys WHERE id = ?").get(String(body.id || ""));
      const next = pending && key && verifyAuthentication(body, {
        challenge: pending.challenge, origin: config.issuer, rpId: rpId(), publicKey: key.public_key, signCount: Number(key.sign_count)
      });
      if (next === false || !key) return html(ctx, views.loginPage({ uid, clientPlatform: platformByClient.get(details.params.client_id), mailEnabled: mailer.enabled, providers: socialButtons(), error: "Ключ доступа не подошёл. Войдите паролем." }), 401);
      const account = accounts.find(key.account_sub);
      if (!account || account.status !== "active") return html(ctx, views.errorPage({ text: "Аккаунт заблокирован. Напишите в поддержку Endemion." }), 403);
      db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(next, key.id);
      notifyNewLogin(account, ctx.ip);
      audit("passkey.login", { sub: account.sub, ip: ctx.ip });
      await beginLogin(ctx, account, ["passkey"], uid);
    },

    "POST /interaction/:uid/totp": async (ctx, { uid }) => {
      const details = await interactionDetails(ctx);
      if (!details || details.uid !== uid || details.prompt.name !== "login") return expiredInteraction(ctx);
      const challenge = takeChallenge(uid);
      const form = await readForm(ctx);
      const page = (error, status) => html(ctx, views.totpLoginPage({ uid, error }), status);
      if (!challenge) return page("Код больше не действует. Войдите заново.", 400);
      const key = `totp:${challenge.sub}`;
      if (limiter.exceeded(key, LIMITS.loginAccount)) return page("Слишком много попыток. Подождите 15 минут.", 429);
      if (!acceptSecondFactor(challenge.sub, form.code)) {
        limiter.record(key);
        audit("totp.failed", { sub: challenge.sub, ip: ctx.ip });
        return page("Неверный код.", 401);
      }
      limiter.clear(key);
      db.prepare("DELETE FROM login_challenges WHERE interaction_uid = ?").run(uid);
      audit("totp.success", { sub: challenge.sub, ip: ctx.ip });
      await finishInteraction(ctx, { login: { accountId: challenge.sub, remember: true, amr: [...challenge.amr, "otp"] } }, false);
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
      const password = String(form.password || "");
      if (password !== String(form.confirmPassword || "")) return page({ confirmPassword: "Пароли не совпали." }, null, 400);
      const lower = password.toLowerCase();
      if (lower && (lower === String(form.username || "").trim().toLowerCase() || lower === String(form.email || "").trim().toLowerCase())) {
        return page({ password: "Пароль не должен совпадать с именем или почтой." }, null, 400);
      }
      limiter.record(ipKey);
      const result = await accounts.register({ ...values, password });
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

    "GET /login-alert": async (ctx) => {
      const token = String(ctx.query.token || "");
      if (!TOKEN_RE.test(token)) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела.", retry: true }), 400);
      html(ctx, views.unrecognizedPage({ token }));
    },

    "POST /login-alert": async (ctx) => {
      const form = await readForm(ctx);
      const password = String(form.password || "");
      if (password !== String(form.confirmPassword || "")) return html(ctx, views.unrecognizedPage({ token: form.token, error: "Пароли не совпали." }), 400);
      const error = validatePassword(password);
      if (error) return html(ctx, views.unrecognizedPage({ token: form.token, error }), 400);
      if (!TOKEN_RE.test(String(form.token || ""))) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела.", retry: true }), 400);
      const preview = db.prepare("SELECT account_sub, expires_at FROM login_alerts WHERE token_hash = ?").get(sha256(form.token));
      const known = preview && Number(preview.expires_at) >= Date.now() ? accounts.find(preview.account_sub) : null;
      if (known && sameAsIdentity(password, known)) return html(ctx, views.unrecognizedPage({ token: form.token, error: "Пароль не должен совпадать с именем или почтой." }), 400);
      const row = db.prepare("DELETE FROM login_alerts WHERE token_hash = ? RETURNING account_sub, restore_email, expires_at").get(sha256(form.token));
      const account = row && Number(row.expires_at) >= Date.now() ? accounts.find(row.account_sub) : null;
      if (!account) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела.", retry: true }), 400);
      if (row.restore_email && row.restore_email !== account.email) {
        const restored = accounts.changeEmail(account.sub, row.restore_email);
        if (!restored.error) accounts.markEmailVerified(account.sub);
      }
      await accounts.setPassword(account.sub, password);
      db.prepare("DELETE FROM login_alerts WHERE account_sub = ?").run(account.sub);
      revokeAll(account.sub);
      audit("password.reset", { sub: account.sub, ip: ctx.ip, detail: "login-alert" });
      html(ctx, views.noticePage({ title: "Пароль изменён", text: "Все сессии завершены. Войдите новым паролем.", link: { href: "/login", text: "Войти" } }));
    },

    "GET /reset-password": async (ctx) => {
      const token = String(ctx.query.token || "");
      if (!TOKEN_RE.test(token)) return html(ctx, views.errorPage({ text: "Ссылка неверная или устарела. Запросите новую." }), 400);
      html(ctx, views.resetPage({ token }));
    },

    "POST /reset-password": async (ctx) => {
      const form = await readForm(ctx);
      const password = String(form.password || "");
      if (password !== String(form.confirmPassword || "")) return html(ctx, views.resetPage({ token: form.token, error: "Пароли не совпали." }), 400);
      const error = validatePassword(password);
      if (error) return html(ctx, views.resetPage({ token: form.token, error }), 400);
      const preview = peekToken(form.token, "reset_password");
      const known = preview && accounts.find(preview.account_sub);
      if (known && sameAsIdentity(password, known)) return html(ctx, views.resetPage({ token: form.token, error: "Пароль не должен совпадать с именем или почтой." }), 400);
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
        sent: "Письмо отправлено.",
        avatar: "Аватар обновлён."
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
        totp: Boolean(totpStatus(current.account.sub)),
        passkeys: db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE account_sub = ?").get(current.account.sub).n,
        loginMethods: loginMethodsOf(current.account.sub)
      }));
    },

    "GET /account/security": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const notice = {
        password: "Пароль сохранён. Остальные сессии завершены.",
        email: "Почта изменена. Мы отправили письмо для подтверждения.",
        linked: "Способ входа привязан.",
        unlinked: "Способ входа отвязан.",
        reauth: "Вход подтверждён. Теперь можно изменить способы входа.",
        totp: "Код из приложения выключен.",
        passkey: "Ключ доступа добавлен.",
        "passkey-deleted": "Ключ доступа удалён.",
        "passkey-renamed": "Название ключа сохранено."
      }[ctx.query.done];
      html(ctx, views.securityPage({
        csrf: csrfFor(current.session),
        notice,
        error: ctx.query.error ? String(ctx.query.error).slice(0, 300) : null,
        mailEnabled: mailer.enabled,
        hasPassword: accounts.hasPassword(current.account),
        verified: Boolean(current.account.email_verified_at),
        loginMethods: loginMethodsOf(current.account.sub),
        totp: totpStatus(current.account.sub),
        passkeys: db.prepare("SELECT id, name, created_at FROM passkeys WHERE account_sub = ? ORDER BY created_at").all(current.account.sub)
      }));
    },

    "POST /account/passkey/options": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current || !checkCsrf(current.session, ctx.get("x-csrf-token"))) ctx.throw(403, "Запрос отклонён.");
      if (!recentLogin(current.session)) return reauthPage(ctx);
      const challenge = newChallenge();
      saveWebauthn(current.session.uid, "register", challenge, { sub: current.account.sub });
      ctx.body = registrationOptions({ rpId: rpId(), rpName: "Endemion", userId: current.account.sub, userName: current.account.username, challenge });
    },

    "POST /account/passkey": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current || !checkCsrf(current.session, ctx.get("x-csrf-token"))) ctx.throw(403, "Запрос отклонён.");
      const body = await readJson(ctx);
      const pending = takeWebauthn(current.session.uid, "register");
      const saved = pending && pending.account_sub === current.account.sub && verifyRegistration(body, { challenge: pending.challenge, origin: config.issuer, rpId: rpId() });
      if (!saved) ctx.throw(400, "Ключ не подошёл. Попробуйте ещё раз.");
      const taken = new Set(db.prepare("SELECT name FROM passkeys WHERE account_sub = ?").all(current.account.sub).map((row) => row.name));
      const base = views.describeDevice(ctx.get("user-agent"));
      let name = taken.has(base) ? "" : base;
      for (let n = 2; !name; n += 1) if (!taken.has(`${base} ${n}`)) name = `${base} ${n}`;
      db.prepare("INSERT INTO passkeys (id, account_sub, public_key, sign_count, name) VALUES (?, ?, ?, ?, ?)")
        .run(saved.id, current.account.sub, saved.publicKey, saved.signCount, name);
      notifyAccountChange(current.account, "Новый ключ доступа", `К аккаунту ${current.account.username} добавлен ключ доступа.`);
      audit("passkey.add", { sub: current.account.sub, ip: ctx.ip });
      ctx.body = { ok: true };
    },

    "POST /account/passkey/rename": accountAction(async (ctx, { account }, form) => {
      const name = String(form.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (name.length < 1) return backToSecurity(ctx, { error: "Название ключа не может быть пустым." });
      db.prepare("UPDATE passkeys SET name = ? WHERE id = ? AND account_sub = ?").run(name, form.id, account.sub);
      backToSecurity(ctx, { done: "passkey-renamed" });
    }),

    "POST /account/passkey/delete": accountAction(async (ctx, { account, session }, form) => {
      if (!recentLogin(session)) return reauthPage(ctx);
      const factor = secondFactorOk(account, form.code);
      if (!factor.ok) return backToSecurity(ctx, { error: factor.error });
      const keys = db.prepare("SELECT id FROM passkeys WHERE account_sub = ?").all(account.sub);
      if (!accounts.hasPassword(account) && keys.length <= 1 && !accounts.identities(account.sub).length) {
        return backToSecurity(ctx, { error: "Это единственный способ входа. Сначала задайте пароль." });
      }
      db.prepare("DELETE FROM passkeys WHERE id = ? AND account_sub = ?").run(form.id, account.sub);
      audit("passkey.delete", { sub: account.sub, ip: ctx.ip });
      backToSecurity(ctx, { done: "passkey-deleted" });
    }),

    "POST /account/totp/start": accountAction(async (ctx, { account, session }) => {
      if (!recentLogin(session)) return reauthPage(ctx);
      if (totpOf.get(account.sub)) return backToSecurity(ctx, { error: "Код из приложения уже включён." });
      const secret = generateSecret();
      db.prepare("INSERT INTO totp_setup (account_sub, secret, expires_at) VALUES (?, ?, ?) ON CONFLICT (account_sub) DO UPDATE SET secret = excluded.secret, expires_at = excluded.expires_at")
        .run(account.sub, encryptSecret(secret, config.cookieKeys[0]), Date.now() + 15 * 60 * 1000);
      html(ctx, views.totpSetupPage({ csrf: csrfFor(session), secret, otpauth: otpauthUrl(secret, account.email) }));
    }),

    "POST /account/totp/confirm": accountAction(async (ctx, { account, session }, form) => {
      const row = db.prepare("SELECT secret, expires_at FROM totp_setup WHERE account_sub = ?").get(account.sub);
      const secret = row && Number(row.expires_at) > Date.now() ? decryptSecret(row.secret, config.cookieKeys[0]) : null;
      const step = secret && verifyTotp(secret, normalizeCode(form.code));
      if (!step) return html(ctx, views.totpSetupPage({ csrf: csrfFor(session), secret: secret || "", error: secret ? "Код не подошёл. Проверьте время на телефоне и введите новый." : "Настройка устарела. Начните заново." }), 400);
      db.prepare("DELETE FROM totp_setup WHERE account_sub = ?").run(account.sub);
      const codes = generateBackupCodes();
      db.prepare("INSERT INTO totp (account_sub, secret, last_step) VALUES (?, ?, ?)").run(account.sub, encryptSecret(secret, config.cookieKeys[0]), step);
      const insert = db.prepare("INSERT INTO totp_backup (account_sub, code_hash) VALUES (?, ?)");
      for (const code of codes) insert.run(account.sub, hashBackup(code));
      audit("totp.enabled", { sub: account.sub, ip: ctx.ip });
      html(ctx, views.backupCodesPage({ codes }));
    }),

    "POST /account/totp/backups": accountAction(async (ctx, { account }, form) => {
      if (!/^\d{6}$/.test(normalizeCode(form.code)) || !acceptSecondFactor(account.sub, form.code)) {
        return backToSecurity(ctx, { error: "Нужен текущий код из приложения. Запасные коды не изменились." });
      }
      const codes = generateBackupCodes();
      db.prepare("DELETE FROM totp_backup WHERE account_sub = ?").run(account.sub);
      const insert = db.prepare("INSERT INTO totp_backup (account_sub, code_hash) VALUES (?, ?)");
      for (const code of codes) insert.run(account.sub, hashBackup(code));
      audit("totp.backups", { sub: account.sub, ip: ctx.ip });
      html(ctx, views.backupCodesPage({ codes }));
    }),

    "POST /account/totp/disable": accountAction(async (ctx, { account }, form) => {
      if (!acceptSecondFactor(account.sub, form.code)) return backToSecurity(ctx, { error: "Неверный код. Двухфакторная защита осталась включена." });
      db.prepare("DELETE FROM totp WHERE account_sub = ?").run(account.sub);
      db.prepare("DELETE FROM totp_backup WHERE account_sub = ?").run(account.sub);
      notifyAccountChange(account, "Код из приложения выключен", `Для аккаунта ${account.username} выключен код из приложения.`);
      audit("totp.disabled", { sub: account.sub, ip: ctx.ip });
      backToSecurity(ctx, { done: "totp" });
    }),

    "GET /account/apps": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const notice = { revoked: "Доступ отозван. Приложение выйдет при следующей проверке." }[ctx.query.done];
      html(ctx, views.appsPage({ apps: listApps(current.account.sub), csrf: csrfFor(current.session), notice }));
    },

    "POST /account/apps/revoke": accountAction(async (ctx, { account }, form) => {
      const app = listApps(account.sub).find((item) => item.id === form.id);
      if (app) {
        revokeGrants(app.grants);
        audit("app.revoke", { sub: account.sub, ip: ctx.ip, detail: app.name });
      }
      ctx.redirect("/account/apps?done=revoked");
    }),

    "GET /account/data": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      html(ctx, views.dataPage({
        account: { ...current.account, hasPassword: accounts.hasPassword(current.account) },
        csrf: csrfFor(current.session),
        totp: Boolean(totpStatus(current.account.sub)),
        error: ctx.query.error ? String(ctx.query.error).slice(0, 300) : null
      }));
    },

    "GET /account/export": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current) return ctx.redirect("/login");
      const { account } = current;
      ctx.set("Cache-Control", "no-store");
      ctx.set("Content-Disposition", "attachment; filename=\"endemion-id.json\"");
      ctx.body = {
        sub: account.sub,
        email: account.email,
        email_verified: Boolean(account.email_verified_at),
        username: account.username,
        display_name: account.display_name,
        created_at: account.created_at,
        methods: accounts.identities(account.sub).map((item) => ({ provider: item.provider, linked_at: item.linked_at })),
        apps: listApps(account.sub).map((item) => ({ name: item.name, scopes: item.scopes, last_seen: item.lastSeen })),
        activity: db.prepare("SELECT event, ip, created_at FROM audit_log WHERE account_sub = ? ORDER BY id DESC LIMIT 100").all(account.sub)
      };
    },

    "POST /account/delete": accountAction(async (ctx, { account, session }, form) => {
      if (String(form.confirm || "").trim() !== account.username) return backToData(ctx, "Имя пользователя не совпало.");
      const factor = secondFactorOk(account, form.code);
      if (!factor.ok) return backToData(ctx, factor.error);
      if (!accounts.hasPassword(account)) {
        if (!recentLogin(session)) return reauthPage(ctx);
      } else if (!(await accounts.checkPassword(account.sub, form.password))) return backToData(ctx, "Неверный пароль.");
      notifyDeleted(account);
      revokeAll(account.sub);
      accounts.remove(account.sub);
      rmSync(path.join(config.avatarsDir, account.sub), { force: true });
      audit("account.delete", { sub: account.sub, ip: ctx.ip });
      html(ctx, views.noticePage({ title: "Аккаунт удалён", text: "Endemion ID удалён. На сайтах нужно будет выйти отдельно, если вход ещё открыт.", link: { href: "/login", text: "На страницу входа" } }));
    }),

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
      } else if (!(await accounts.checkPassword(account.sub, form.password))) return backToSecurity(ctx, { error: "Неверный текущий пароль." });
      const factor = secondFactorOk(account, form.code);
      if (!factor.ok) return backToSecurity(ctx, { error: factor.error });
      const previous = account.email;
      const result = accounts.changeEmail(account.sub, form.email);
      if (result.error) return backToSecurity(ctx, { error: result.error });
      notifyEmailChange({ ...account, email: previous }, result.account.email);
      audit("email.change", { sub: account.sub, ip: ctx.ip });
      sendVerification(result.account);
      backToSecurity(ctx, { done: "email" });
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
      } else if (!(await accounts.checkPassword(account.sub, form.currentPassword))) return backToSecurity(ctx, { error: "Неверный текущий пароль." });
      const factor = secondFactorOk(account, form.code);
      if (!factor.ok) return backToSecurity(ctx, { error: factor.error });
      const next = String(form.newPassword || "");
      if (next !== String(form.confirmPassword || "")) return backToSecurity(ctx, { error: "Пароли не совпали." });
      if (sameAsIdentity(next, account)) return backToSecurity(ctx, { error: "Пароль не должен совпадать с именем или почтой." });
      const result = await accounts.setPassword(account.sub, next);
      if (result.error) return backToSecurity(ctx, { error: result.error });
      if (!firstPassword) notifyAccountChange(account, "Пароль Endemion ID изменён", `Пароль аккаунта ${account.username} изменён.`);
      revokeAll(account.sub, session.jti);
      audit(firstPassword ? "password.set" : "password.change", { sub: account.sub, ip: ctx.ip });
      backToSecurity(ctx, { done: "password" });
    }),

    // Привязка провайдера: форма на странице аккаунта (CSRF), вход не старше 10 минут
    "POST /account/social/:provider/link": accountAction(async (ctx, { account, session }, _form, { provider }) => {
      if (!social.enabled.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      if (!recentLogin(session)) return reauthPage(ctx);
      if (accounts.identities(account.sub).some((item) => item.provider === provider)) {
        return backToSecurity(ctx, { error: `${PROVIDER_NAMES[provider]} уже привязан. Чтобы привязать другой аккаунт, сначала отвяжите этот.` });
      }
      try {
        await beginSocial(ctx, provider, { purpose: "link", accountSub: account.sub });
      } catch (err) {
        log("warn", "social start failed", { provider, error: err.message });
        backToSecurity(ctx, { error: `${PROVIDER_NAMES[provider]} сейчас недоступен. Попробуйте позже.` });
      }
    }),

    "POST /account/social/:provider/unlink": accountAction(async (ctx, { account, session }, form, { provider }) => {
      if (!PROVIDERS.includes(provider)) ctx.throw(404, "Такого способа входа нет.");
      if (!recentLogin(session)) return reauthPage(ctx);
      const factor = secondFactorOk(account, form.code);
      if (!factor.ok) return backToSecurity(ctx, { error: factor.error });
      const linked = accounts.identities(account.sub);
      if (!linked.some((item) => item.provider === provider)) return backToSecurity(ctx, { done: "unlinked" });
      // Последний способ входа не отвязывается: без него в аккаунт будет не попасть
      if (!accounts.hasPassword(account) && linked.length <= 1) {
        return backToSecurity(ctx, { error: `Это единственный способ входа. Сначала задайте пароль или привяжите другой способ, потом отвяжите ${PROVIDER_NAMES[provider]}.` });
      }
      accounts.unlinkIdentity(account.sub, provider);
      audit("social.unlink", { sub: account.sub, ip: ctx.ip, detail: provider });
      backToSecurity(ctx, { done: "unlinked" });
    }),

    "POST /account/avatar": async (ctx) => {
      const current = await currentSession(ctx);
      if (!current || !sameOrigin(ctx) || !checkCsrf(current.session, ctx.get("x-csrf-token"))) ctx.throw(403, "Запрос отклонён.");
      const bytes = await readBody(ctx, AVATAR_MAX_BYTES);
      const type = imageType(bytes);
      if (!type) ctx.throw(415, "Нужна картинка PNG, JPEG или WebP.");
      const clean = stripMetadata(bytes, type);
      if (type === "image/webp" && !clean.includes(Buffer.from("VP8"))) ctx.throw(415, "Нужна картинка PNG, JPEG или WebP.");
      mkdirSync(config.avatarsDir, { recursive: true });
      writeFileSync(path.join(config.avatarsDir, current.account.sub), clean);
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
      const shown = ["login.success", "login.invalid", "login.locked", "social.login", "passkey.login", "passkey.add", "passkey.delete", "totp.failed", "totp.success", "totp.enabled", "totp.disabled", "password.change", "password.set", "password.reset", "email.change", "email.verified", "social.link", "social.unlink", "session.revoke", "app.revoke"];
      const activity = db.prepare(`SELECT event, ip, created_at FROM audit_log WHERE account_sub = ? AND event IN (${shown.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 20`).all(current.account.sub, ...shown);
      html(ctx, views.sessionsPage({ sessions: listSessions(current.account.sub, current.session.jti), csrf: csrfFor(current.session), notice, activity }));
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

  function backToSecurity(ctx, params) {
    ctx.status = 303;
    ctx.redirect(`/account/security?${new URLSearchParams(params)}`);
  }

  function backToData(ctx, error) {
    ctx.status = 303;
    ctx.redirect(`/account/data?${new URLSearchParams({ error })}`);
  }

  function loginMethodsOf(sub) {
    const linked = new Map(accounts.identities(sub).map((item) => [item.provider, item]));
    return PROVIDERS.filter((id) => social.enabled.includes(id) || linked.has(id))
      .map((id) => ({ id, name: PROVIDER_NAMES[id], enabled: social.enabled.includes(id), identity: linked.get(id) || null }));
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
    db.prepare("DELETE FROM login_challenges WHERE expires_at < ?").run(Date.now());
    db.prepare("DELETE FROM totp_setup WHERE expires_at < ?").run(Date.now());
    db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").run(Date.now());
    db.prepare("DELETE FROM login_alerts WHERE expires_at < ?").run(Date.now());
  }

  return { provider, db, accounts, mailer, audit, cleanup, revokeAll, close: () => db.close() };
}
