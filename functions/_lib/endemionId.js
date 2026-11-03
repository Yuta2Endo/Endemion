// Вход через Endemion ID (auth.endemion.online) по OpenID Connect: Authorization Code + PKCE S256.
// Сайт остаётся со своей сессией в cookie endemion_session. С ней связан refresh token Endemion ID:
// раз в REFRESH_MS сайт обновляет его и так узнаёт о выходе, блокировке, новом имени, почте или аватаре.
// Включается настройкой ENDEMION_ID=1. Без неё сайт работает со своими паролями, как раньше

import * as oidc from "openid-client";
import { fromBase64, newToken, randomBytes, sha256, toBase64 } from "./crypto.js";

export const OIDC_COOKIE = "endemion_oidc";
const LOGIN_TTL_MS = 10 * 60 * 1000;
// Как часто сессия сверяется с Endemion ID. Столько же, не больше, проходит от выхода или блокировки до выхода здесь
export const REFRESH_MS = 5 * 60 * 1000;
// Если Endemion ID недоступен, сессия работает без сверки не дольше часа, потом нужен новый вход
const OFFLINE_GRACE_MS = 60 * 60 * 1000;
const LEGACY_CLAIM = "https://endemion.online/legacy_user_id";
const USERNAME = /^[a-zA-Z0-9_]{3,24}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function endemionIdEnabled(env) {
  return env.ENDEMION_ID === "1";
}

/**
 * Старый вход паролем сайта (/api/auth/login, register, forgot, reset) при ENDEMION_ID=1 закрыт:
 * пароль проверяется только в Endemion ID. Ответ 410 с адресом нового входа или null, если старый вход разрешён
 */
export function legacyAuthClosed(env) {
  if (!endemionIdEnabled(env)) return null;
  return new Response(JSON.stringify({ error: "Вход теперь через Endemion ID.", login: "/auth/login" }), {
    status: 410,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function issuerOrigin(env) {
  return env.ENDEMION_ID_ISSUER ? new URL(env.ENDEMION_ID_ISSUER).origin : "";
}

/** Адрес страницы аккаунта Endemion ID: там меняют имя, почту, пароль и аватар */
export function accountUrl(env) {
  return `${issuerOrigin(env)}/account`;
}

// Сколько секунд после ввода пароля в Endemion ID разрешены опасные действия (удаление аккаунта, выдача ролей)
export const REAUTH_SECONDS = 10 * 60;

/** Вводил ли пользователь пароль в Endemion ID за последние REAUTH_SECONDS (claim auth_time сохранён в сессии) */
export function recentlyAuthenticated(user) {
  return Boolean(user?.viaEndemionId && user.authTime && Date.now() / 1000 - user.authTime <= REAUTH_SECONDS);
}

/** Адрес повторного входа: Endemion ID спросит пароль даже при живой сессии и вернёт на страницу next */
export function reauthUrl(next) {
  return `/auth/login?reauth=1&next=${encodeURIComponent(safeNext(next))}`;
}

/** Адрес восстановления пароля в Endemion ID */
export function forgotPasswordUrl(env) {
  return `${issuerOrigin(env)}/forgot-password`;
}

const configs = new Map();

/** Настройки провайдера из /.well-known/openid-configuration. Запрос один раз на процесс */
async function getConfig(env) {
  const issuer = env.ENDEMION_ID_ISSUER;
  if (!issuer || !env.ENDEMION_ID_CLIENT_ID || !env.ENDEMION_ID_CLIENT_SECRET) {
    throw new Error("Endemion ID: задайте ENDEMION_ID_ISSUER, ENDEMION_ID_CLIENT_ID и ENDEMION_ID_CLIENT_SECRET");
  }
  const key = `${issuer}|${env.ENDEMION_ID_CLIENT_ID}`;
  if (!configs.has(key)) {
    const url = new URL(issuer);
    // http разрешён только для провайдера на этом же компьютере (разработка и тесты)
    const execute = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? [oidc.allowInsecureRequests] : [];
    const pending = oidc.discovery(url, env.ENDEMION_ID_CLIENT_ID, undefined, oidc.ClientSecretBasic(env.ENDEMION_ID_CLIENT_SECRET), { execute, timeout: 10 });
    configs.set(key, pending);
    pending.catch(() => configs.delete(key));
  }
  return configs.get(key);
}

// ==================== ШИФРОВАНИЕ REFRESH TOKEN ====================

async function tokenKey(env) {
  const raw = env.ENDEMION_ID_TOKEN_KEY ? fromBase64(env.ENDEMION_ID_TOKEN_KEY) : null;
  if (!raw || raw.length !== 32) throw new Error("Endemion ID: ENDEMION_ID_TOKEN_KEY — 32 случайных байта в base64 (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Refresh token хранится в базе зашифрованным: копия базы без ключа не даёт войти от имени пользователя */
async function encrypt(env, text) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(text));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(data))}`;
}

async function decrypt(env, value) {
  const [iv, data] = String(value).split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await tokenKey(env), fromBase64(data));
  return new TextDecoder().decode(plain);
}

// ==================== ВХОД ====================

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function stateCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${OIDC_COOKIE}=${value}; Path=/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Только свои пути: ?next=https://evil.example не уводит пользователя после входа на чужой сайт */
export function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value.slice(0, 500) : "/";
}

/**
 * Начать вход: verifier, nonce и страница возврата остаются на сервере сайта, в браузер уходит только state в cookie.
 * screen=register открывает сразу регистрацию, reauth=true просит ввести пароль заново
 */
export async function startLogin(env, request, { next = "/", screen = null, reauth = false } = {}) {
  const config = await getConfig(env);
  const origin = new URL(request.url).origin;
  const state = newToken();
  const verifier = oidc.randomPKCECodeVerifier();
  const nonce = oidc.randomNonce();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oidc_logins WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO oidc_logins (state_hash, code_verifier, nonce, next_path, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(state), verifier, nonce, safeNext(next), now + LOGIN_TTL_MS)
  ]);
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin}/auth/callback`,
    // Без offline_access: refresh token живёт не дольше центральной сессии Endemion ID и умирает при выходе там
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ...(screen === "register" ? { screen: "register" } : {}),
    ...(reauth ? { prompt: "login" } : {})
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Set-Cookie": stateCookie(request, state, LOGIN_TTL_MS / 1000), "Cache-Control": "no-store" }
  });
}

/** Начатый вход по state из cookie. Запись удаляется сразу: второй раз тот же ответ провайдера не примется */
export async function takeLogin(env, request) {
  const state = readCookie(request, OIDC_COOKIE);
  if (!state || !/^[0-9a-f]{64}$/.test(state)) return null;
  const row = await env.DB.prepare("DELETE FROM oidc_logins WHERE state_hash = ? RETURNING code_verifier, nonce, next_path, expires_at")
    .bind(await sha256(state)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { state, verifier: row.code_verifier, nonce: row.nonce, next: row.next_path };
}

export function clearStateCookie(request) {
  return stateCookie(request, "", 0);
}

/**
 * Обмен кода на токены. openid-client проверяет подпись ID token, iss, aud, exp, nonce, state и PKCE.
 * Возвращает { claims, refreshToken }
 */
export async function exchangeCode(env, request, login) {
  const config = await getConfig(env);
  const tokens = await oidc.authorizationCodeGrant(config, new URL(request.url), {
    pkceCodeVerifier: login.verifier,
    expectedState: login.state,
    expectedNonce: login.nonce,
    idTokenExpected: true
  });
  const claims = tokens.claims();
  if (!tokens.refresh_token) throw new Error("Endemion ID не выдал refresh token");
  return { claims, refreshToken: await encrypt(env, tokens.refresh_token) };
}

// ==================== ПОЛЬЗОВАТЕЛЬ САЙТА ====================

/** Имя, почта, username и аватар из Endemion ID. Занятые на сайте почта или username не перезаписываются */
export async function applyClaims(env, userId, claims) {
  const statements = [];
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 40) : null;
  if (name) statements.push(env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, userId));
  if (typeof claims.email === "string" && claims.email) {
    statements.push(env.DB.prepare("UPDATE users SET email = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE email = ? AND id <> ?)")
      .bind(claims.email.toLowerCase(), userId, claims.email.toLowerCase(), userId));
  }
  // Аватар из Endemion ID. Номер версии берётся из ?v= адреса: по нему строятся ссылки /avatars/:id?v=...,
  // и браузер скачивает новую картинку после смены. Картинку отдаёт /avatars/:id, забирая её у Endemion ID
  const picture = typeof claims.picture === "string" && claims.picture.startsWith(issuerOrigin(env) + "/avatars/") ? claims.picture : null;
  const version = picture ? Number(new URL(picture).searchParams.get("v")) : NaN;
  if (picture && Number.isSafeInteger(version) && version > 0) {
    statements.push(env.DB.prepare("UPDATE user_profiles SET avatar_url = ?, avatar_version = ? WHERE user_id = ?").bind(picture, version, userId));
  } else {
    // Аватар убрали в Endemion ID. Загруженный раньше на сайт (avatar_url пустой) не трогается
    statements.push(env.DB.prepare("UPDATE user_profiles SET avatar_url = NULL, avatar_version = NULL WHERE user_id = ? AND avatar_url IS NOT NULL").bind(userId));
  }
  if (typeof claims.preferred_username === "string" && USERNAME.test(claims.preferred_username)) {
    statements.push(env.DB.prepare(
      "UPDATE user_profiles SET username = ? WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE username = ? AND user_id <> ?)"
    ).bind(claims.preferred_username, userId, claims.preferred_username, userId));
  }
  await env.DB.batch(statements);
}

/**
 * Пользователь сайта для Endemion ID. Порядок поиска:
 * 1. уже связан по sub;
 * 2. перенесённый аккаунт: номер старого пользователя в claim legacy_user_id (его выдаёт только Endemion ID);
 * 3. тот же адрес почты, если Endemion ID подтвердил почту (как восстановление пароля по письму);
 * 4. иначе новый пользователь.
 * Неподтверждённая почта, совпавшая со старым аккаунтом, не связывается: { error: "email_unverified" }
 */
export async function resolveUser(env, claims) {
  const sub = claims.sub;
  const linked = await env.DB.prepare("SELECT id, blocked_at FROM users WHERE endemion_sub = ?").bind(sub).first();
  if (linked) return linked.blocked_at ? { error: "blocked" } : { userId: linked.id, created: false };

  const legacyId = Number(claims[LEGACY_CLAIM]);
  if (Number.isSafeInteger(legacyId) && legacyId > 0) {
    const result = await env.DB.prepare("UPDATE users SET endemion_sub = ? WHERE id = ? AND endemion_sub IS NULL").bind(sub, legacyId).run();
    if (result.meta.changes) return resolveUser(env, claims);
  }

  const email = String(claims.email || "").toLowerCase();
  const sameEmail = email ? await env.DB.prepare("SELECT id, endemion_sub FROM users WHERE email = ?").bind(email).first() : null;
  if (sameEmail) {
    if (sameEmail.endemion_sub) return { error: "email_linked" };
    if (claims.email_verified !== true) return { error: "email_unverified" };
    await env.DB.prepare("UPDATE users SET endemion_sub = ? WHERE id = ? AND endemion_sub IS NULL").bind(sub, sameEmail.id).run();
    return resolveUser(env, claims);
  }

  // Новый пользователь. Пароля на сайте нет: строка "!" не подходит ни к одному паролю (verifyPassword вернёт false).
  // Согласие с политикой дано при регистрации в Endemion ID
  const name = String(claims.name || claims.preferred_username || "Читатель").slice(0, 40);
  let userId;
  try {
    const row = await env.DB.prepare(
      "INSERT INTO users (name, email, password_hash, consent_at, endemion_sub) VALUES (?, ?, '!', datetime('now'), ?) RETURNING id"
    ).bind(name, email || `${sub}@id.endemion.invalid`, sub).first();
    userId = row.id;
  } catch (err) {
    // Тот же sub пришёл одновременно с другого устройства: пользователь уже создан
    if (String(err).includes("UNIQUE")) return resolveUser(env, claims);
    throw err;
  }
  const preferred = USERNAME.test(claims.preferred_username || "") ? claims.preferred_username : null;
  for (const candidate of [preferred, `user${userId}`].filter(Boolean)) {
    const result = await env.DB.prepare("INSERT OR IGNORE INTO user_profiles (user_id, username) VALUES (?, ?)").bind(userId, candidate).run();
    if (result.meta.changes) break;
  }
  return { userId, created: true };
}

// ==================== СВЕРКА СЕССИИ ====================

/**
 * Сверить сессию с Endemion ID, если с прошлой сверки прошло REFRESH_MS. Возвращает false, если сессия больше не действует.
 * Обновляет только один запрос: остальные одновременные запросы этой сессии идут со старыми данными.
 * Иначе два запроса потратили бы один refresh token, и Endemion ID отозвал бы вход как украденный
 */
export async function refreshSession(env, session) {
  if (!session.refresh_token) return true;
  const now = Date.now();
  if (now - (session.refreshed_at || 0) < REFRESH_MS) return true;

  const claim = await env.DB.prepare("UPDATE sessions SET refreshed_at = ? WHERE token_hash = ? AND refreshed_at IS ?")
    .bind(now, session.token_hash, session.refreshed_at).run();
  if (!claim.meta.changes) return true;

  try {
    const config = await getConfig(env);
    const tokens = await oidc.refreshTokenGrant(config, await decrypt(env, session.refresh_token));
    const claims = tokens.claims();
    if (claims && claims.sub !== session.endemion_sub) throw new Error("Endemion ID вернул другого пользователя");
    await env.DB.prepare("UPDATE sessions SET refresh_token = ?, last_ok_at = ? WHERE token_hash = ?")
      .bind(await encrypt(env, tokens.refresh_token), now, session.token_hash).run();
    if (!claims) return true;
    await applyClaims(env, session.user_id, claims);
    // Имя, почта или аватар могли измениться: вызывающий код перечитает пользователя
    return "updated";
  } catch (err) {
    // Отказ провайдера (выход, отзыв, блокировка, повтор токена) — сессия заканчивается сразу
    if (err instanceof oidc.ResponseBodyError || String(err.message).includes("другого пользователя")) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.token_hash).run();
      return false;
    }
    // Провайдер недоступен: сессия работает, пока не кончится запас OFFLINE_GRACE_MS
    console.error("Endemion ID: сверка сессии не удалась", err.message);
    return now - (session.last_ok_at || session.created_at) < OFFLINE_GRACE_MS;
  }
}

/** Адрес выхода в Endemion ID. Там пользователь подтверждает выход и выбирает: только этот сайт или все */
export async function endSessionUrl(env, request) {
  const config = await getConfig(env);
  return oidc.buildEndSessionUrl(config, {
    client_id: env.ENDEMION_ID_CLIENT_ID,
    post_logout_redirect_uri: `${new URL(request.url).origin}/`
  }).href;
}
