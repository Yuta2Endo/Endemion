// Точка входа Worker: маршруты API и страниц, которые собираются на сервере. Всё остальное — статика из public/.
// Обработчики в functions/ написаны в формате Pages Functions (onRequestGet и т. д.), поэтому здесь простой маршрутизатор

import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";
import * as login from "../functions/api/auth/login.js";
import * as register from "../functions/api/auth/register.js";
import * as logout from "../functions/api/auth/logout.js";
import * as me from "../functions/api/me/index.js";
import * as mePassword from "../functions/api/me/password.js";
import * as titleList from "../functions/api/titles/index.js";
import * as titleOne from "../functions/api/titles/[id].js";
import * as libraryList from "../functions/api/library/index.js";
import * as libraryOne from "../functions/api/library/[id].js";
import * as updates from "../functions/api/updates.js";
import * as config from "../functions/api/config.js";
import * as titlePage from "../functions/title/[id].js";
import * as readerPage from "../functions/read/[id]/[chapter].js";
import * as pageImage from "../functions/pages/[id]/[chapter]/[page].js";
import * as robots from "../functions/robots.txt.js";
import * as sitemap from "../functions/sitemap.xml.js";
import { error } from "../functions/_lib/http.js";

// Эти же пути перечислены в run_worker_first в wrangler.toml
const ROUTES = [
  ["/api/auth/login", login],
  ["/api/auth/register", register],
  ["/api/auth/logout", logout],
  ["/api/me", me],
  ["/api/me/password", mePassword],
  ["/api/titles", titleList],
  ["/api/titles/:id", titleOne],
  ["/api/library", libraryList],
  ["/api/library/:id", libraryOne],
  ["/api/updates", updates],
  ["/api/config", config],
  ["/title/:id", titlePage],
  ["/read/:id/:chapter", readerPage],
  ["/pages/:id/:chapter/:page", pageImage],
  ["/robots.txt", robots],
  ["/sitemap.xml", sitemap]
].map(([pattern, module]) => ({ parts: pattern.split("/").filter(Boolean), module }));

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

function match(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  for (const route of ROUTES) {
    if (route.parts.length !== parts.length) continue;
    const params = {};
    const ok = route.parts.every((part, i) => {
      if (!part.startsWith(":")) return part === parts[i];
      try {
        params[part.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      } catch {
        return false;
      }
    });
    if (ok) return { module: route.module, params };
  }
  return null;
}

function handlerName(method) {
  return "onRequest" + method.charAt(0) + method.slice(1).toLowerCase();
}

function handlerFor(module, method) {
  return module[handlerName(method)] || module.onRequest || (method === "HEAD" ? module.onRequestGet : null);
}

function allowed(module) {
  return METHODS.filter((method) => handlerFor(module, method)).join(", ");
}

async function run(found, context) {
  if (!found) return error("Не найдено.", 404);
  const { method } = context.request;
  const handler = handlerFor(found.module, method);
  if (!handler) return error("Метод не поддерживается.", 405, { Allow: allowed(found.module) });

  const response = await handler(context);
  // HEAD обслуживает GET-обработчик: заголовки те же, тело не нужно
  return method === "HEAD" ? new Response(null, response) : response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const found = match(url.pathname);

    // Не наш маршрут: статический файл или страница 404 (not_found_handling в wrangler.toml)
    if (!found && !isApi) return env.ASSETS.fetch(request);

    const context = {
      request,
      env,
      params: found ? found.params : {},
      data: {},
      waitUntil: (promise) => ctx.waitUntil(promise)
    };

    if (isApi) {
      // Middleware проверяет Origin и базу, ловит ошибки и вызывает обработчик через next()
      context.next = () => run(found, context);
      return apiMiddleware(context);
    }

    try {
      return await run(found, context);
    } catch (err) {
      console.error(err);
      return new Response("Ошибка сервера. Попробуйте позже.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};
