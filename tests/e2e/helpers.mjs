// Общее для браузерных тестов: адрес локального сервера и запросы к API от имени тестового администратора

import { execFileSync } from "node:child_process";

export const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";

/** Клиент API с cookie сессии. Изменяющие запросы требуют Origin своего сайта */
export function apiClient(cookie = "") {
  return {
    get cookie() {
      return cookie;
    },
    async call(method, path, body) {
      const headers = { Origin: BASE };
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
      "--command", `UPDATE users SET is_admin = 1 WHERE email = '${email}'`];
  execFileSync(process.execPath, args, { stdio: "ignore" });
}

/** Данные, которые global-setup передаёт тестам через переменную окружения */
export function state() {
  return JSON.parse(process.env.E2E_STATE);
}
