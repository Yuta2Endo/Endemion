// Общие части тестов: Endemion ID на свободном порту с временной папкой данных и браузер с cookie

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { createApp } from "../src/app.mjs";

export const SITE = { id: "endemion-web", secret: "site-secret-0123456789-0123456789-abcd", redirect: "http://site.test/auth/callback", logout: "http://site.test/" };
export const LIFE = { id: "endemion-life-web", secret: "life-secret-0123456789-0123456789-abcd", redirect: "http://life.test/api/auth/oidc/callback", logout: "http://life.test/" };

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

export async function startAuth(extraEnv = {}) {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "endemion-auth-"));
  const issuer = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_ISSUER: issuer,
    AUTH_DATA_DIR: dataDir,
    AUTH_COOKIE_KEYS: "test-cookie-key-0123456789-0123456789",
    MAIL_DRIVER: "memory",
    OIDC_CLIENTS: JSON.stringify([
      { client_id: SITE.id, client_secret: SITE.secret, platform: "endemion", redirect_uris: [SITE.redirect], post_logout_redirect_uris: [SITE.logout] },
      { client_id: LIFE.id, client_secret: LIFE.secret, platform: "endemion_life", redirect_uris: [LIFE.redirect], post_logout_redirect_uris: [LIFE.logout] }
    ]),
    ...extraEnv
  });
  const app = createApp(config, { log: () => {} });
  const server = await new Promise((resolve) => {
    const listening = app.provider.listen(port, "127.0.0.1", () => resolve(listening));
  });
  return {
    ...app,
    config,
    issuer,
    dataDir,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

/** Браузер: хранит cookie по имени, не следует за перенаправлениями сам, ставит Origin у POST как настоящий браузер */
export function browser(issuer) {
  const jar = new Map();

  function store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attrs.some((attr) => /expires=Thu, 01 Jan 1970/i.test(attr)) || value === "";
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function request(url, { method = "GET", form, headers = {}, body, origin } = {}) {
    const target = new URL(url, issuer);
    const sendHeaders = { ...headers };
    if (jar.size && target.origin === issuer) sendHeaders.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (method !== "GET") sendHeaders.origin = origin ?? issuer;
    if (form) {
      sendHeaders["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const response = await fetch(target, { method, headers: sendHeaders, body, redirect: "manual" });
    if (target.origin === issuer) store(response);
    const text = await response.text();
    return { status: response.status, location: response.headers.get("location"), headers: response.headers, text };
  }

  /** Идти по перенаправлениям внутри Endemion ID, пока ответ не страница или не уход на другой сайт */
  async function follow(url, options) {
    let response = await request(url, options);
    let hops = 0;
    while ([302, 303].includes(response.status) && hops++ < 15) {
      const next = new URL(response.location, issuer);
      if (next.origin !== issuer) return { ...response, final: next };
      response = await request(next.href);
    }
    return response;
  }

  return { jar, request, follow };
}

/** uid из адреса /interaction/<uid> на странице входа */
export function interactionUid(html) {
  const match = html.match(/action="\/interaction\/([^/"]+)\/(?:login|register)"/);
  if (!match) throw new Error("на странице нет формы входа");
  return match[1];
}

export function csrfFrom(html) {
  const match = html.match(/name="csrf" value="([^"]+)"/);
  if (!match) throw new Error("на странице нет токена CSRF");
  return match[1];
}
