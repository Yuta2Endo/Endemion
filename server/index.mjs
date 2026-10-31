// Свой сервер на Node.js для Docker + VPS. Запускает тот же код, что и Cloudflare Worker (src/worker.js),
// а вместо сервисов Cloudflare подставляет SQLite (D1), диск или S3 (R2) и раздачу public/ (ASSETS).
// Запуск: `npm start`. Переменные окружения описаны в .env.example

import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import worker from "../src/worker.js";
import { createAssets } from "./assets.mjs";
import { backupDatabase, startScheduledBackups } from "./backup.mjs";
import { DATA_DIR, DB_FILE, FILES_DIR, MIGRATIONS_DIR, PUBLIC_DIR } from "./config.mjs";
import { openDatabase } from "./d1.mjs";
import { applyMigrations, pendingMigrations } from "./migrate.mjs";
import { createStorage } from "./storage.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
// За обратным прокси (Caddy) IP посетителя берётся из X-Forwarded-For. Без прокси этот заголовок подделать может кто угодно
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
// Самая большая загрузка — страница главы до 15 МБ
const MAX_BODY_BYTES = 20 * 1024 * 1024;
// Переменные, которые видит код сайта. Секреты хранилища S3 сюда не попадают
const WORKER_VARS = ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "MAIL_FROM", "RESEND_API_KEY", "WEB_ANALYTICS_TOKEN", "MAIL_DEV_MODE"];

/**
 * Адрес сайта. Код сайта берёт его из адреса запроса: проверяет Origin, ставит Secure у cookie, строит ссылки в письмах.
 * На своём сервере заголовок Host может подделать любой, поэтому адрес задаётся настройкой
 */
function publicUrl() {
  const value = process.env.PUBLIC_URL || (process.env.NODE_ENV === "production" ? "" : `http://127.0.0.1:${PORT}`);
  if (!value) throw new Error("Задайте PUBLIC_URL — адрес сайта, например https://example.ru.");
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("PUBLIC_URL — только адрес сайта, без пути: https://example.ru");
  return url;
}

const PUBLIC_URL = publicUrl();

// ==================== БАЗА И ХРАНИЛИЩЕ ====================

mkdirSync(DATA_DIR, { recursive: true });
const db = openDatabase(DB_FILE);

const pending = pendingMigrations(db.raw, MIGRATIONS_DIR);
if (pending.length) {
  const applied = db.raw.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n;
  // Перед миграциями рабочей базы — резервная копия. Пустой новой базе копия не нужна
  if (applied > 0) console.log(`Резервная копия перед миграциями: ${await backupDatabase(db.raw)}`);
  applyMigrations(db.raw, MIGRATIONS_DIR, pending);
}

const env = {
  DB: db,
  PAGES: await createStorage(process.env, FILES_DIR),
  ASSETS: createAssets(PUBLIC_DIR),
  ...Object.fromEntries(WORKER_VARS.map((name) => [name, process.env[name] || ""]))
};

startScheduledBackups(db.raw, { hours: Number(process.env.BACKUP_HOURS ?? 24), keep: Number(process.env.BACKUP_KEEP || 14) });

// ==================== ЗАПРОСЫ ====================

// Отложенные задачи (waitUntil): удаление старых страниц, письма. При остановке сервер их дожидается
const background = new Set();

function waitUntil(promise) {
  const task = Promise.resolve(promise)
    .catch((err) => console.error("Фоновая задача не выполнена:", err))
    .finally(() => background.delete(task));
  background.add(task);
}

function clientIp(req) {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean) : [];
  // Caddy дописывает адрес посетителя последним, всё левее мог прислать сам посетитель
  const ip = forwarded.at(-1) || req.socket.remoteAddress || "local";
  return ip.replace(/^::ffff:/, "");
}

/** Тело запроса не больше MAX_BODY_BYTES, даже если размер не указан в Content-Length */
function limitedBody(req) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      done(size > MAX_BODY_BYTES ? new Error("Тело запроса слишком большое") : null, chunk);
    }
  });
  req.pipe(limiter);
  return Readable.toWeb(limiter);
}

function toRequest(req) {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    // IP посетителя ставит только сервер: заголовок от посетителя обошёл бы ограничение попыток входа
    if (name === "cf-connecting-ip" || name === "host") continue;
    headers.append(name, req.rawHeaders[i + 1]);
  }
  headers.set("host", PUBLIC_URL.host);
  headers.set("cf-connecting-ip", clientIp(req));

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url, PUBLIC_URL.origin), {
    method: req.method,
    headers,
    body: hasBody ? limitedBody(req) : undefined,
    duplex: hasBody ? "half" : undefined
  });
}

async function send(res, response, method) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  if (!response.body || method === "HEAD") {
    res.end();
    return;
  }
  await new Promise((resolve) => {
    const body = Readable.fromWeb(response.body);
    body.on("error", (err) => {
      console.error("Ответ прерван:", err.message);
      res.destroy(err);
      resolve();
    });
    res.on("close", resolve);
    body.pipe(res);
  });
}

function plain(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    // Только путь: адрес вида http://чужой-сайт/... в строке запроса подменил бы адрес сайта
    if (!req.url?.startsWith("/")) return plain(res, 400, "Bad Request");
    if (req.url === "/healthz") {
      db.raw.prepare("SELECT 1").get();
      return plain(res, 200, "ok");
    }
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) return plain(res, 413, "Payload Too Large");

    const response = await worker.fetch(toRequest(req), env, { waitUntil, passThroughOnException() {} });
    await send(res, response, req.method);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) plain(res, 500, "Ошибка сервера. Попробуйте позже.");
    else res.destroy();
  }
});

// Медленный клиент не держит соединение бесконечно, но загрузка большой страницы главы успевает пройти
server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 30 * 1000;

server.listen(PORT, HOST, () => {
  console.log(`Endemion: ${PUBLIC_URL.origin} (слушает ${HOST}:${PORT}), данные в ${DATA_DIR}`);
});

async function shutdown(signal) {
  console.log(`${signal}: остановка сервера`);
  server.close();
  await Promise.allSettled([...background]);
  db.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
