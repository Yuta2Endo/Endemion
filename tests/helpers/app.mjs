// Приложение для интеграционных тестов: тот же src/worker.js, что на сайте, но база — временный файл SQLite
// с миграциями (игры и категории форума из 0020), картинки — временная папка. Сервер и сеть не нужны

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import worker from "../../src/worker.js";
import { createAssets } from "../../server/assets.mjs";
import { MIGRATIONS_DIR, PUBLIC_DIR } from "../../server/config.mjs";
import { openDatabase } from "../../server/d1.mjs";
import { applyMigrations, pendingMigrations } from "../../server/migrate.mjs";
import { seedAdmin } from "../../server/seed.mjs";
import { createStorage } from "../../server/storage.mjs";

export const BASE = "http://127.0.0.1:9999";
export const PASSWORD = "correct-horse-1";

let ipCounter = 0;

/** extraEnv — дополнительные настройки окружения сайта */
export async function createApp({ extraEnv = {} } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "endemion-test-"));
  const db = openDatabase(path.join(dir, "test.sqlite"));
  // Миграции пишут в консоль о каждом файле: в тестах это шум
  const log = console.log;
  console.log = () => {};
  try {
    applyMigrations(db.raw, MIGRATIONS_DIR, pendingMigrations(db.raw, MIGRATIONS_DIR));
  } finally {
    console.log = log;
  }
  const env = {
    DB: db,
    PAGES: await createStorage({}, path.join(dir, "files")),
    ASSETS: createAssets(PUBLIC_DIR),
    MAIL_DEV_MODE: "1",
    ...extraEnv
  };

  const background = [];
  const ctx = { waitUntil: (promise) => background.push(promise), passThroughOnException() {} };

  /** Клиент с собственной cookie сессии и своим IP: лимиты попыток входа у каждого свои */
  function client() {
    let cookie = "";
    const ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
    return {
      get cookie() {
        return cookie;
      },
      async call(method, url, body, { origin = BASE, headers = {} } = {}) {
        /** @type {{ method: string, headers: Record<string, string>, body?: any }} */
        const init = { method, headers: { "CF-Connecting-IP": ip, ...headers } };
        if (origin) init.headers.Origin = origin;
        if (cookie) init.headers.Cookie = cookie;
        if (body !== undefined) {
          if (body instanceof Uint8Array) {
            init.body = body;
          } else {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
          }
        }
        const response = await worker.fetch(new Request(BASE + url, init), env, ctx);
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0].endsWith("=") ? "" : setCookie.split(";")[0];
        const text = await response.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        return { status: response.status, data, text, headers: response.headers };
      }
    };
  }

  /** Новый пользователь, сразу вошедший. role — user, moderator или admin */
  async function user(name = "Читатель", role = "user") {
    const c = client();
    const email = `${name.replace(/\W/g, "") || "u"}-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const r = await c.call("POST", "/api/auth/register", { name, email, password: PASSWORD, consent: true });
    if (r.status !== 201) throw new Error(`Регистрация: ${r.status} ${r.text}`);
    if (role !== "user") await db.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, r.data.user.id).run();
    return Object.assign(c, { id: r.data.user.id, email, name });
  }

  return {
    env,
    db,
    client,
    user,
    seedAdmin: (email, password) => seedAdmin(env, email, password, { log: () => {} }),
    async close() {
      await Promise.allSettled(background);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
