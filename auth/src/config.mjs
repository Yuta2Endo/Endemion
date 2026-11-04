// Настройки Endemion Auth из переменных окружения. Описание переменных — в auth/.env.example

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, randomUUID } from "node:crypto";

export const AUTH_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Корень репозитория Endemion: оттуда берутся шрифты и стили сайта, чтобы вход выглядел так же
export const REPO_ROOT = path.resolve(AUTH_ROOT, "..");

function fail(message) {
  throw new Error(`Настройки Endemion Auth: ${message}`);
}

/** Ключ подписи токенов. В production — только из файла или переменной, в разработке создаётся сам */
function loadJwks(env, production, dataDir) {
  if (env.AUTH_JWKS) return JSON.parse(env.AUTH_JWKS);
  const file = path.resolve(env.AUTH_JWKS_FILE || path.join(dataDir, "auth-jwks.json"));
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  if (production) fail(`нет ключа подписи: задайте AUTH_JWKS_FILE (создаётся командой npm run keys) или AUTH_JWKS`);
  const jwks = generateJwks();
  writeFileSync(file, JSON.stringify(jwks, null, 2), { mode: 0o600 });
  console.warn(`Создан ключ подписи для разработки: ${file}`);
  return jwks;
}

export function generateJwks() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { keys: [{ ...privateKey.export({ format: "jwk" }), kid: randomUUID(), use: "sig", alg: "RS256" }] };
}

/**
 * Сайты, которые входят через Endemion ID. JSON-массив в OIDC_CLIENTS:
 * client_id, client_secret, platform (endemion | endemion_life), redirect_uris, post_logout_redirect_uris
 */
function loadClients(env, production) {
  let list;
  try {
    list = JSON.parse(env.OIDC_CLIENTS || "[]");
  } catch {
    fail("OIDC_CLIENTS должен быть JSON-массивом");
  }
  if (!Array.isArray(list)) fail("OIDC_CLIENTS должен быть JSON-массивом");
  return list.map((client) => {
    if (!client.client_id || !client.client_secret) fail("у клиента нет client_id или client_secret");
    if (production && client.client_secret.length < 32) fail(`секрет клиента ${client.client_id} короче 32 символов`);
    if (!["endemion", "endemion_life"].includes(client.platform)) fail(`у клиента ${client.client_id} неизвестный platform`);
    const uris = [...(client.redirect_uris || []), ...(client.post_logout_redirect_uris || [])];
    if (!client.redirect_uris?.length) fail(`у клиента ${client.client_id} нет redirect_uris`);
    for (const uri of uris) {
      const url = new URL(uri);
      if (uri.includes("*")) fail(`адрес с * не допускается: ${uri}`);
      if (production && url.protocol !== "https:") fail(`в production адреса только https: ${uri}`);
    }
    return {
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uris: client.redirect_uris,
      post_logout_redirect_uris: client.post_logout_redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      // auth_time всегда в ID token: по нему сайт решает, вводил ли пользователь пароль недавно (удаление аккаунта, роли)
      require_auth_time: true,
      // Не стандартное поле OIDC: по нему claims знают, какой сайт спрашивает (legacy_user_id)
      "urn:endemion:platform": client.platform
    };
  });
}

/**
 * Внешние провайдеры входа: Google, GitHub, VK ID. Провайдер включён, если заданы его ключи, у выключенного — null.
 * Адреса провайдеров подменяются только в тестах (NODE_ENV=test): там вместо Google, GitHub и VK — локальные заглушки
 */
function loadSocial(env) {
  const test = env.NODE_ENV === "test";
  const url = (name, fallback) => (test && env[name]) || fallback;
  const pair = (idName, secretName, label) => {
    const clientId = String(env[idName] || "").trim();
    const clientSecret = String(env[secretName] || "").trim();
    if (!clientId && !clientSecret) return null;
    if (!clientId || !clientSecret) fail(`${label}: задайте и ${idName}, и ${secretName}`);
    return { clientId, clientSecret };
  };
  const google = pair("AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET", "Google");
  const github = pair("AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "GitHub");
  const vkId = String(env.AUTH_VK_CLIENT_ID || "").trim();
  if (!vkId && env.AUTH_VK_SERVICE_TOKEN) fail("VK ID: AUTH_VK_SERVICE_TOKEN задан без AUTH_VK_CLIENT_ID");
  if (vkId && !/^\d+$/.test(vkId)) fail("AUTH_VK_CLIENT_ID — числовой ID приложения из кабинета VK ID");
  return {
    google: google && { ...google, issuer: url("AUTH_GOOGLE_ISSUER", "https://accounts.google.com") },
    github: github && {
      ...github,
      authorizeUrl: url("AUTH_GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
      tokenUrl: url("AUTH_GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
      apiUrl: url("AUTH_GITHUB_API_URL", "https://api.github.com")
    },
    vk: vkId ? { clientId: vkId, serviceToken: String(env.AUTH_VK_SERVICE_TOKEN || "").trim(), baseUrl: url("AUTH_VK_BASE_URL", "https://id.vk.ru") } : null
  };
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const issuer = env.AUTH_ISSUER || "http://localhost:3001";
  const issuerUrl = new URL(issuer);
  if (production && issuerUrl.protocol !== "https:") fail("AUTH_ISSUER в production должен начинаться с https://");
  if (issuerUrl.pathname !== "/") fail("AUTH_ISSUER должен быть адресом без пути, например https://auth.endemion.online");

  const cookieKeys = (env.AUTH_COOKIE_KEYS || "").split(",").map((key) => key.trim()).filter(Boolean);
  if (production && (cookieKeys.length === 0 || cookieKeys.some((key) => key.length < 32))) {
    fail("AUTH_COOKIE_KEYS: нужен хотя бы один ключ длиной от 32 символов");
  }

  const dataDir = path.resolve(env.AUTH_DATA_DIR || path.join(REPO_ROOT, "data", "auth"));
  return {
    production,
    issuer: issuerUrl.origin,
    port: Number(env.PORT) || 3001,
    host: env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
    // За Caddy адрес клиента и https берутся из X-Forwarded-*
    trustProxy: env.TRUST_PROXY === "1",
    dataDir,
    dbFile: env.AUTH_DB_FILE === ":memory:" ? ":memory:" : path.join(dataDir, "auth.sqlite"),
    avatarsDir: path.join(dataDir, "avatars"),
    migrationsDir: path.join(AUTH_ROOT, "migrations"),
    cookieKeys: cookieKeys.length ? cookieKeys : ["dev-only-cookie-key-not-for-production-use"],
    jwks: loadJwks(env, production, dataDir),
    clients: loadClients(env, production),
    social: loadSocial(env),
    // Сайты экосистемы для ссылок на страницах Auth
    links: {
      site: env.ENDEMION_URL || "https://endemion.online",
      life: env.ENDEMION_LIFE_URL || "https://life.endemion.online",
      privacy: (env.ENDEMION_URL || "https://endemion.online") + "/privacy"
    },
    mail: {
      // unisender | resend | outbox (файлы в data/auth/outbox, разработка) | memory (тесты) | none
      driver: env.MAIL_DRIVER || (env.UNISENDER_API_KEY ? "unisender" : env.RESEND_API_KEY ? "resend" : production ? "none" : "outbox"),
      from: env.MAIL_FROM || "",
      unisenderKey: env.UNISENDER_API_KEY || "",
      unisenderUrl: env.UNISENDER_API_URL || "https://goapi.unisender.ru/ru/transactional/api/v1",
      skipUnsubscribe: env.MAIL_SKIP_UNSUBSCRIBE === "1",
      resendKey: env.RESEND_API_KEY || "",
      outboxDir: path.join(dataDir, "outbox")
    }
  };
}
