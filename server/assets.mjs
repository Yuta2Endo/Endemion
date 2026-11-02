// Статические файлы из public/ так же, как их отдаёт Cloudflare (настройки [assets] в wrangler.toml):
// /auth → auth.html, /auth.html → редирект на /auth, неизвестный адрес → 404.html с кодом 404,
// заголовки из public/_headers

import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

/** Правила public/_headers: адрес (звёздочка — любые символы) и заголовки под ним с отступом */
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
      current = { pattern: new RegExp(`^${pattern}$`), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = line.indexOf(":");
    if (current && colon > 0) current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

export function createAssets(publicDir) {
  const root = path.resolve(publicDir);
  let rules = [];
  try {
    rules = parseHeaders(readFileSync(path.join(root, "_headers"), "utf8"));
  } catch {}

  /** Файл внутри public/. Служебные (_headers) и скрытые файлы не отдаются, выйти за пределы папки нельзя */
  function file(urlPath) {
    const segments = urlPath.split("/").filter(Boolean);
    if (segments.some((part) => part.startsWith(".") || part.startsWith("_") || /[\\\0:]/.test(part))) return null;
    const full = path.join(root, ...segments);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    try {
      const stat = statSync(full);
      return stat.isFile() ? { full, stat } : null;
    } catch {
      return null;
    }
  }

  /** Что отдать по адресу: файл или редирект на адрес без .html */
  function resolve(urlPath) {
    if (urlPath.endsWith(".html") && file(urlPath)) {
      const target = urlPath.slice(0, -5);
      return { redirect: target.endsWith("/index") ? target.slice(0, -5) || "/" : target };
    }
    if (urlPath.endsWith("/index") && file(`${urlPath}.html`)) return { redirect: urlPath.slice(0, -5) };
    if (urlPath.endsWith("/")) {
      const index = file(`${urlPath}index.html`);
      if (index) return { found: index };
      if (urlPath !== "/" && file(`${urlPath.slice(0, -1)}.html`)) return { redirect: urlPath.slice(0, -1) };
      return null;
    }
    const exact = file(urlPath);
    if (exact) return { found: exact };
    const html = file(`${urlPath}.html`);
    if (html) return { found: html };
    if (file(`${urlPath}/index.html`)) return { redirect: `${urlPath}/` };
    return null;
  }

  function headersFor(urlPath, full) {
    const headers = new Headers({ "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream" });
    for (const rule of rules) {
      if (rule.pattern.test(urlPath)) for (const [name, value] of rule.headers) headers.set(name, value);
    }
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return headers;
  }

  function serve({ full, stat }, urlPath, request, status = 200) {
    const headers = headersFor(urlPath, full);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    headers.set("ETag", etag);
    if (status === 200 && request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(stat.size));
    // Поток node:stream/web и глобальный ReadableStream — один и тот же класс, но типы у них описаны отдельно
    const body = request.method === "HEAD" ? null : /** @type {any} */ (Readable.toWeb(createReadStream(full)));
    return new Response(body, { status, headers });
  }

  return {
    async fetch(input) {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const url = new URL(request.url);
      let urlPath = null;
      try {
        // Повторяющиеся косые черты схлопываются: иначе редирект на «//сайт» увёл бы на чужой домен
        const decoded = decodeURIComponent(url.pathname);
        urlPath = `/${decoded.split("/").filter(Boolean).join("/")}${decoded.endsWith("/") && decoded !== "/" ? "/" : ""}`;
      } catch {}

      const result = urlPath ? resolve(urlPath) : null;
      if (result?.redirect) return new Response(null, { status: 307, headers: { Location: encodeURI(result.redirect) + url.search } });
      if (result?.found) return serve(result.found, urlPath, request);

      const page = file("/404.html");
      return page ? serve(page, url.pathname, request, 404) : new Response("Not Found", { status: 404 });
    }
  };
}
