// Общее для браузерных тестов: адрес локального сервера и запросы к API от имени тестового администратора

import { execFileSync } from "node:child_process";

export const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";

// Каждый браузерный проект получает свой IP: лимиты попыток входа (30 за 15 минут на IP)
// не должны смешивать параллельные проекты. Cloudflare в бою сам задаёт CF-Connecting-IP,
// поэтому подмена работает только на локальном сервере и не ослабляет продакшен.
export const PROJECT_IPS = {
  chromium: "10.10.0.1",
  firefox: "10.10.0.2",
  webkit: "10.10.0.3",
  android: "10.10.0.4",
  iphone: "10.10.0.5"
};
export const SETUP_IP = "10.10.0.254";

/** IP проекта для запросов из браузера и из Node: неизвестный проект получает IP настройки. */
export function clientIpFor(projectName) {
  return PROJECT_IPS[projectName] || SETUP_IP;
}

/** Клиент API с cookie сессии. Изменяющие запросы требуют Origin своего сайта */
export function apiClient(cookie = "", ip = SETUP_IP) {
  return {
    get cookie() {
      return cookie;
    },
    async call(method, path, body) {
      const headers = { Origin: BASE, "CF-Connecting-IP": ip };
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data?.error || ""}`);
      return data;
    }
  };
}

/**
 * Права администратора в локальной базе. Почту генерирует тест: в ней только буквы, цифры, дефис, @ и точки.
 * TEST_TARGET=node — сайт запущен своим сервером (npm start), база в DATA_DIR; иначе это wrangler dev
 */
export function grantAdmin(email) {
  const args = process.env.TEST_TARGET === "node"
    ? ["server/grant-admin.mjs", email]
    : ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "endemion", "--local",
      "--command", `UPDATE users SET role = 'admin' WHERE email = '${email}'`];
  execFileSync(process.execPath, args, { stdio: "ignore" });
}

/**
 * Сброс счётчиков лимитов в локальной базе перед запуском и после него.
 * Это тестовые данные, а не настройка продакшена: сами лимиты остаются прежними.
 */
export function clearRateLimits() {
  if (process.env.TEST_TARGET === "node") return;
  const args = ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "endemion", "--local",
    "--command", "DELETE FROM auth_attempts; DELETE FROM rate_events;"];
  execFileSync(process.execPath, args, { stdio: "ignore" });
}

/** Данные, которые global-setup передаёт тестам через переменную окружения */
export function state() {
  return JSON.parse(process.env.E2E_STATE);
}

/** Данные администратора проекта: у каждого браузера свой пользователь и свои лимиты действий. */
export function adminFor(projectName) {
  return state().admins[projectName];
}

/** Уникальный суффикс для тестовых данных: не совпадает между проектами и повторными запусками. */
export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
