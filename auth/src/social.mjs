// Вход через внешних провайдеров: Google (OpenID Connect), GitHub (OAuth 2.0), VK ID (OAuth 2.1), Discord (OAuth 2.0).
// У всех Authorization Code + PKCE S256 и одноразовый state, у Google ещё nonce и проверка подписи ID token.
// Секреты и токены провайдеров остаются на сервере: токен нужен только, чтобы узнать постоянный номер
// пользователя у провайдера, после этого он забывается

import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { normalizeEmail, normalizeName, validateEmail } from "./accounts.mjs";

// Порядок — порядок кнопок на странице входа
export const PROVIDERS = ["google", "vk", "github", "discord"];
export const PROVIDER_NAMES = { google: "Google", vk: "ВКонтакте", github: "GitHub", discord: "Discord" };

const TIMEOUT_S = 10;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
// Только то, что нужно для аккаунта: номер пользователя, имя и почта для подсказки в форме
const SCOPES = { google: "openid email profile", github: "user:email", vk: "vkid.personal_info email", discord: "identify email" };

/** code: cancelled — пользователь отказался у провайдера, state — ответ не к этому входу, остальное — сбой провайдера */
export class SocialError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// http разрешён только для провайдера на этом же компьютере (тесты)
const insecure = (url) => {
  const parsed = new URL(url);
  return parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
};

/** Данные провайдера, которым можно доверять: номер — строка, почта и имя — только для подсказки */
function profile(id, email, name) {
  const cleanId = String(id ?? "");
  if (!cleanId || cleanId.length > 255) throw new SocialError("profile", "провайдер не вернул номер пользователя");
  const cleanEmail = normalizeEmail(email);
  return { id: cleanId, email: cleanEmail && !validateEmail(cleanEmail) ? cleanEmail : null, name: normalizeName(name).slice(0, 40) || null };
}

/**
 * settings — config.social: { google, vk, github, discord }, у выключенного провайдера null.
 * redirectBase — адрес Endemion ID: ответ провайдера приходит на {redirectBase}/social/callback/{provider}
 */
export function createSocial(settings, { redirectBase }) {
  const enabled = PROVIDERS.filter((id) => settings[id]);
  const redirectUri = (id) => `${redirectBase}/social/callback/${id}`;

  // Настройки Google из discovery: один запрос на процесс, при ошибке — заново при следующем входе
  let google = null;
  function googleConfig() {
    if (!google) {
      const { issuer, clientId, clientSecret } = settings.google;
      const execute = insecure(issuer) ? [oidc.allowInsecureRequests] : [];
      google = oidc.discovery(new URL(issuer), clientId, undefined, oidc.ClientSecretPost(clientSecret), { execute, timeout: TIMEOUT_S })
        .then((config) => {
          // Подпись ID token проверяется ключами Google из jwks_uri, а не только по TLS
          oidc.enableNonRepudiationChecks(config);
          return config;
        });
      google.catch(() => {
        google = null;
      });
    }
    return google;
  }

  function githubConfig() {
    const { authorizeUrl, tokenUrl, clientId, clientSecret } = settings.github;
    const config = new oidc.Configuration(
      { issuer: new URL(authorizeUrl).origin, authorization_endpoint: authorizeUrl, token_endpoint: tokenUrl },
      clientId, undefined, oidc.ClientSecretPost(clientSecret)
    );
    if (insecure(tokenUrl)) oidc.allowInsecureRequests(config);
    config.timeout = TIMEOUT_S;
    return config;
  }

  function discordConfig() {
    const { authorizeUrl, tokenUrl, clientId, clientSecret } = settings.discord;
    const config = new oidc.Configuration(
      { issuer: new URL(authorizeUrl).origin, authorization_endpoint: authorizeUrl, token_endpoint: tokenUrl },
      clientId, undefined, oidc.ClientSecretPost(clientSecret)
    );
    if (insecure(tokenUrl)) oidc.allowInsecureRequests(config);
    config.timeout = TIMEOUT_S;
    return config;
  }

  /** Адреса, куда браузер уходит после кнопки входа: их разрешает CSP form-action */
  function formOrigins() {
    const origins = [];
    if (settings.google) origins.push(new URL(settings.google.issuer).origin);
    if (settings.github) origins.push(new URL(settings.github.authorizeUrl).origin);
    if (settings.discord) origins.push(new URL(settings.discord.authorizeUrl).origin);
    if (settings.vk) {
      origins.push(new URL(settings.vk.baseUrl).origin);
      // VK ID работает на двух доменах и может перенаправить на второй
      if (new URL(settings.vk.baseUrl).hostname === "id.vk.ru") origins.push("https://id.vk.com");
    }
    return origins;
  }

  /**
   * Начать вход: state, verifier и nonce создаются здесь и сохраняются вызывающим кодом на сервере.
   * Возвращает { url, state, verifier, nonce }
   */
  async function begin(id) {
    // 32 байта в base64url — 43 символа: VK ID требует state не короче 32
    const state = randomBytes(32).toString("base64url");
    const verifier = oidc.randomPKCECodeVerifier();
    const nonce = id === "google" ? oidc.randomNonce() : null;
    const params = {
      redirect_uri: redirectUri(id),
      scope: SCOPES[id],
      state,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256"
    };
    let url;
    if (id === "google") url = oidc.buildAuthorizationUrl(await googleConfig(), { ...params, nonce });
    else if (id === "github") url = oidc.buildAuthorizationUrl(githubConfig(), params);
    else if (id === "discord") url = oidc.buildAuthorizationUrl(discordConfig(), params);
    else {
      url = new URL(`${settings.vk.baseUrl}/authorize`);
      url.search = new URLSearchParams({ response_type: "code", client_id: settings.vk.clientId, ...params }).toString();
    }
    return { url, state, verifier, nonce };
  }

  async function githubApi(path, accessToken) {
    const response = await fetch(`${settings.github.apiUrl}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Endemion-ID" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_S * 1000)
    });
    if (!response.ok) throw new SocialError("provider", `GitHub ${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function discordApi(path, accessToken) {
    const response = await fetch(`${settings.discord.apiUrl}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, "user-agent": "Endemion-ID" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_S * 1000)
    });
    if (!response.ok) throw new SocialError("provider", `Discord ${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function vkPost(path, params) {
    const response = await fetch(`${settings.vk.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_S * 1000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      throw new SocialError("provider", `VK ID ${path}: HTTP ${response.status} ${data?.error || ""} ${data?.error_description || ""}`.trim());
    }
    return data;
  }

  /**
   * Ответ провайдера на redirect_uri. query — параметры адреса, login — начатый вход { state, verifier, nonce }.
   * Возвращает { id, email, name } или бросает SocialError
   */
  async function finish(id, query, login) {
    // Повторённый параметр — подделанный ответ: какой из двух state настоящий, не угадать
    if (query.getAll("state").length !== 1 || query.get("state") !== login.state) throw new SocialError("state", "state в ответе не совпал");
    const error = query.get("error");
    if (error) throw new SocialError(error === "access_denied" ? "cancelled" : "provider", `${error}: ${String(query.get("error_description") || "").slice(0, 200)}`);
    // Адрес ответа берётся из настроек, а не из запроса: за прокси Host и схема могли бы отличаться
    const callbackUrl = new URL(redirectUri(id));
    callbackUrl.search = query.toString();

    try {
      if (id === "google") {
        // openid-client: state, PKCE, подпись ID token, iss, aud, exp, nonce
        const tokens = await oidc.authorizationCodeGrant(await googleConfig(), callbackUrl, {
          pkceCodeVerifier: login.verifier,
          expectedState: login.state,
          expectedNonce: login.nonce,
          idTokenExpected: true
        });
        const claims = tokens.claims();
        return profile(claims.sub, claims.email_verified === true ? claims.email : null, claims.name);
      }

      if (id === "github") {
        // ID token у GitHub нет: пользователь — тот, чей access token выдан на этот код
        const tokens = await oidc.authorizationCodeGrant(githubConfig(), callbackUrl, { pkceCodeVerifier: login.verifier, expectedState: login.state });
        const user = await githubApi("/user", tokens.access_token);
        if (!Number.isSafeInteger(user?.id)) throw new SocialError("profile", "GitHub не вернул id пользователя");
        let email = null;
        try {
          const emails = await githubApi("/user/emails", tokens.access_token);
          email = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified)?.email ?? null : null;
        } catch {
          // Без почты вход работает: адрес пользователь введёт сам
        }
        return profile(user.id, email, user.name || user.login);
      }

      if (id === "discord") {
        // ID token у Discord нет: пользователь — тот, чей access token выдан на этот код
        const tokens = await oidc.authorizationCodeGrant(discordConfig(), callbackUrl, { pkceCodeVerifier: login.verifier, expectedState: login.state });
        const user = await discordApi("/users/@me", tokens.access_token);
        if (typeof user?.id !== "string" || !/^\d{15,20}$/.test(user.id)) throw new SocialError("profile", "Discord не вернул id пользователя");
        // Discord email может быть null, verified должен быть true
        const email = user.verified === true ? user.email : null;
        return profile(user.id, email, user.global_name || user.username);
      }

      // VK ID: device_id из ответа обязателен при обмене кода, state возвращается и в ответе токена
      const code = query.get("code");
      const deviceId = query.get("device_id");
      if (!code || !deviceId) throw new SocialError("provider", "VK ID не вернул code или device_id");
      const tokens = await vkPost("/oauth2/auth", {
        grant_type: "authorization_code",
        code,
        code_verifier: login.verifier,
        redirect_uri: redirectUri(id),
        client_id: settings.vk.clientId,
        device_id: deviceId,
        state: login.state,
        // Сервисный ключ нужен только приложению, отмеченному в кабинете VK ID как конфиденциальное
        ...(settings.vk.serviceToken ? { service_token: settings.vk.serviceToken } : {})
      });
      if (tokens.state !== login.state) throw new SocialError("state", "VK ID: state в ответе токена не совпал");
      if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new SocialError("provider", "VK ID не выдал access token");
      // Пользователь определяется по user_info с этим access token. ID token VK не используется:
      // ключи для проверки его подписи VK ID не публикует
      const info = await vkPost("/oauth2/user_info", { client_id: settings.vk.clientId, access_token: tokens.access_token });
      const user = info.user;
      const userId = String(user?.user_id ?? "");
      if (!/^\d{1,20}$/.test(userId)) throw new SocialError("profile", "VK ID не вернул user_id");
      if (tokens.user_id !== undefined && String(tokens.user_id) !== userId) throw new SocialError("profile", "VK ID вернул разных пользователей");
      return profile(userId, user.email, [user.first_name, user.last_name].filter(Boolean).join(" "));
    } catch (err) {
      if (err instanceof SocialError) throw err;
      // Ошибки openid-client (подпись, nonce, ответ token endpoint) и сети
      throw new SocialError("provider", `${err.code || err.name}: ${err.message}`);
    }
  }

  return { enabled, begin, finish, formOrigins };
}
