// Выпуск короткоживущих утверждений (JWT) для Endemion Life. Stage 11.2.
//
// Подписываем ES256 (P-256) ключом портала. Приватный ключ живёт только в окружении сервера,
// в Git и браузер не попадает. Life проверяет подпись по публичному JWKS:
//   GET /.well-known/jwks.json
//
// Конфигурация (переменные окружения):
//   ENDEMION_LIFE_ASSERTION=1                 — включает интеграцию (по умолчанию выключена)
//   ENDEMION_LIFE_JWT_KID=<kid>               — идентификатор активного ключа (1..64, [A-Za-z0-9._-])
//   ENDEMION_LIFE_JWT_PRIVATE_KEY=<base64>    — PKCS#8 DER ключа P-256 в base64 или PEM
//   ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS=[] — JSON-массив публичных JWK прошлых ключей (ротация)
//
// Ключ проверяется при первом использовании. Любая ошибка конфигурации — отказ (fail closed):
// утверждение не выпускается, JWKS не отдаётся.

import { sha256 } from "./crypto.js";
import { lifeAuditEvent, LIFE_AUDIT_EVENTS } from "./lifeAudit.js";

// Production defaults used when no explicit staging issuer/audience is configured.
// Staging environments must set ENDEMION_LIFE_JWT_ISSUER and ENDEMION_LIFE_JWT_AUDIENCE
// to their staging-specific values; production behavior is unchanged when omitted.
export const LIFE_ASSERTION_ISSUER_DEFAULT = "https://endemion.online";
export const LIFE_ASSERTION_AUDIENCE_DEFAULT = "https://life.endemion.online";

// Backward-compatible aliases resolving to the production defaults.
// Tests and existing imports that reference these names continue to receive production values.
export const LIFE_ASSERTION_ISSUER = LIFE_ASSERTION_ISSUER_DEFAULT;
export const LIFE_ASSERTION_AUDIENCE = LIFE_ASSERTION_AUDIENCE_DEFAULT;
export const LIFE_ASSERTION_SCOPE = "portal:read";
export const LIFE_ASSERTION_LIFETIME_SECONDS = 120;
export const LIFE_ASSERTION_MAX_PREVIOUS_KEYS = 8;

/** Valid HTTPS URL origin, or the production default when not configured. */
function resolveIssuer(env) {
  const value = String(env?.ENDEMION_LIFE_JWT_ISSUER ?? "").trim();
  if (!value) return LIFE_ASSERTION_ISSUER_DEFAULT;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("issuer must use https:");
    return url.origin;
  } catch {
    throw new LifeAssertionError(
      "INVALID_CONFIG",
      "ENDEMION_LIFE_JWT_ISSUER must be a valid HTTPS URL"
    );
  }
}

/** Valid HTTPS URL origin, or the production default when not configured. */
function resolveAudience(env) {
  const value = String(env?.ENDEMION_LIFE_JWT_AUDIENCE ?? "").trim();
  if (!value) return LIFE_ASSERTION_AUDIENCE_DEFAULT;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("audience must use https:");
    return url.origin;
  } catch {
    throw new LifeAssertionError(
      "INVALID_CONFIG",
      "ENDEMION_LIFE_JWT_AUDIENCE must be a valid HTTPS URL"
    );
  }
}

// Endemion ID выдаёт sub через randomUUID(): канонический UUID. Принимаем каноническую форму
// (8-4-4-4-12), чтобы не сломаться при смене версии генератора; сравнение в PostgreSQL идёт по uuid.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

const signingCache = new WeakMap();

/** Ошибка конфигурации или отсутствия идентичности. Код нужен тестам и вызывающему коду. */
export class LifeAssertionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LifeAssertionError";
    this.code = code;
  }
}

/** Включена ли интеграция. По умолчанию выключена. */
export function lifeAssertionEnabled(env) {
  return env?.ENDEMION_LIFE_ASSERTION === "1";
}

export function isLifeSubject(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function base64UrlToBytes(text) {
  let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toBase64UrlJson(value) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** PEM или base64 (обычный/base64url) → байты PKCS#8 DER */
function privateKeyBytes(text) {
  const value = String(text ?? "").trim();
  if (!value) throw new LifeAssertionError("INVALID_CONFIG", "Не задан ключ подписи.");
  const pem = value.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
  const body = (pem ? pem[1] : value).replace(/\s+/g, "");
  if (!body || !BASE64_PATTERN.test(body)) {
    throw new LifeAssertionError("INVALID_CONFIG", "Ключ подписи должен быть PKCS#8 в base64 или PEM.");
  }
  return base64UrlToBytes(body);
}

function readKid(value) {
  const kid = typeof value === "string" ? value.trim() : "";
  if (!KID_PATTERN.test(kid)) {
    throw new LifeAssertionError("INVALID_CONFIG", "ENDEMION_LIFE_JWT_KID должен состоять из [A-Za-z0-9._-], 1..64 символа.");
  }
  return kid;
}

/** Публичный JWK из приватного: убираем d и служебные поля, оставляем только то, что можно публиковать. */
function publicJwkFrom(jwk, kid) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new LifeAssertionError("INVALID_CONFIG", "Ключ подписи должен быть P-256 (ES256).");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" };
}

function normalizePreviousJwk(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LifeAssertionError("INVALID_CONFIG", "ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS должен быть JSON-массивом публичных JWK.");
  }
  const kid = readKid(value.kid);
  if (value.kty !== "EC" || value.crv !== "P-256") {
    throw new LifeAssertionError("INVALID_CONFIG", "Прошлый ключ должен быть EC P-256.");
  }
  if (typeof value.x !== "string" || typeof value.y !== "string" || base64UrlToBytes(value.x).length !== 32 || base64UrlToBytes(value.y).length !== 32) {
    throw new LifeAssertionError("INVALID_CONFIG", "У прошлого ключа некорректные координаты x/y.");
  }
  if (value.alg !== undefined && value.alg !== "ES256") {
    throw new LifeAssertionError("INVALID_CONFIG", "Прошлый ключ должен использовать alg=ES256.");
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, kid, alg: "ES256", use: "sig" };
}

function readPreviousKeys(env) {
  const raw = String(env?.ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS ?? "").trim();
  if (!raw || raw === "[]") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LifeAssertionError("INVALID_CONFIG", "ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS — некорректный JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new LifeAssertionError("INVALID_CONFIG", "ENDEMION_LIFE_JWT_PREVIOUS_PUBLIC_JWKS должен быть массивом.");
  }
  if (parsed.length > LIFE_ASSERTION_MAX_PREVIOUS_KEYS) {
    throw new LifeAssertionError("INVALID_CONFIG", `Не больше ${LIFE_ASSERTION_MAX_PREVIOUS_KEYS} прошлых ключей.`);
  }
  return parsed.map(normalizePreviousJwk);
}

async function buildSigningConfig(env) {
  if (!lifeAssertionEnabled(env)) {
    throw new LifeAssertionError("DISABLED", "Интеграция с Endemion Life выключена.");
  }
  const kid = readKid(env.ENDEMION_LIFE_JWT_KID);
  let privateKey;
  try {
    privateKey = await crypto.subtle.importKey("pkcs8", privateKeyBytes(env.ENDEMION_LIFE_JWT_PRIVATE_KEY), SIGNING_ALGORITHM, true, ["sign"]);
  } catch (err) {
    if (err instanceof LifeAssertionError) throw err;
    throw new LifeAssertionError("INVALID_CONFIG", "Не удалось прочитать приватный ключ: нужен PKCS#8 P-256.");
  }
  const exported = await crypto.subtle.exportKey("jwk", privateKey);
  const current = publicJwkFrom(exported, kid);
  const previous = readPreviousKeys(env).filter((key) => key.kid !== kid);
  return { kid, privateKey, current, previous };
}

/** Конфигурация подписи (кэшируется на объект env после успешной проверки). */
export function loadSigningConfig(env) {
  const cached = signingCache.get(env);
  if (cached) return cached;
  const pending = buildSigningConfig(env).catch((err) => {
    // Неудачную конфигурацию не кэшируем: после исправления окружения следующий вызов снова проверит ключ
    signingCache.delete(env);
    throw err;
  });
  signingCache.set(env, pending);
  return pending;
}

/** Публичный JWKS: только текущий и прошлые ключи, без приватных полей. */
export async function getPublicJwks(env) {
  const config = await loadSigningConfig(env);
  return { keys: [config.current, ...config.previous] };
}

/** SHA-256 от sub в hex: только он попадает в журнал. */
export function lifeSubjectHash(sub) {
  return sha256(String(sub));
}

/**
 * Выпустить утверждение для уже проверенного серверного пользователя портала.
 * sub всегда читается из users.endemion_sub по user.id; поля пользователя из браузера не используются.
 * @returns {Promise<{ token: string, jti: string, subHash: string }>}
 */
export async function issuePortalAssertionDetailed(env, user, { endpoint = "life.api" } = {}) {
  const userId = user?.id;
  if (userId === undefined || userId === null) {
    throw new LifeAssertionError("UNAUTHENTICATED", "Нет проверенной сессии портала.");
  }
  const row = await env.DB.prepare("SELECT endemion_sub FROM users WHERE id = ? AND blocked_at IS NULL").bind(userId).first();
  const subject = typeof row?.endemion_sub === "string" ? row.endemion_sub.trim().toLowerCase() : "";
  // Никаких запасных вариантов по почте или имени: без endemion_sub утверждение не выпускается
  if (!isLifeSubject(subject)) {
    throw new LifeAssertionError("NO_SUBJECT", "У пользователя нет корректного Endemion ID (endemion_sub).");
  }

  const config = await loadSigningConfig(env);
  // Resolve issuer/audience from environment with production defaults.
  // Invalid configuration is rejected here (fail closed) before any token is issued.
  const issuer = resolveIssuer(env);
  const audience = resolveAudience(env);
  const issuedAt = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const header = { alg: "ES256", typ: "JWT", kid: config.kid };
  const payload = {
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: issuedAt,
    exp: issuedAt + LIFE_ASSERTION_LIFETIME_SECONDS,
    jti,
    scope: LIFE_ASSERTION_SCOPE
  };
  const signingInput = `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, config.privateKey, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
  const subHash = await lifeSubjectHash(subject);

  lifeAuditEvent(LIFE_AUDIT_EVENTS.assertionIssued, {
    subHash,
    jti,
    endpoint,
    result: "issued"
  });

  return { token, jti, subHash };
}

/** Строка JWT для доверенного серверного кода. */
export async function issuePortalAssertion(env, user, options) {
  const { token } = await issuePortalAssertionDetailed(env, user, options);
  return token;
}

/**
 * Выпустить утверждение по текущей cookie-сессии. Единственный вход для серверных обработчиков:
 * сессия проверяется существующим currentUser, браузер не может передать sub.
 */
export async function issueAssertionForRequest(env, request, options) {
  const { currentUser } = await import("./session.js");
  const user = await currentUser(env, request);
  if (!user) throw new LifeAssertionError("UNAUTHENTICATED", "Нет проверенной сессии портала.");
  return issuePortalAssertionDetailed(env, user, options);
}

/** Базовый URL Life. Аудитория при этом всегда фиксирована контрактом. */
export function lifeBaseUrl(env) {
  const value = String(env?.ENDEMION_LIFE_URL ?? "").trim().replace(/\/+$/, "");
  return value || "https://life.endemion.online";
}
