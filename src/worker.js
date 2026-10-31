// Точка входа Worker: маршруты API и страниц, которые собираются на сервере. Всё остальное — статика из public/.
// Обработчики в functions/ написаны в формате Pages Functions (onRequestGet и т. д.), поэтому здесь простой маршрутизатор

import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";
import * as login from "../functions/api/auth/login.js";
import * as register from "../functions/api/auth/register.js";
import * as logout from "../functions/api/auth/logout.js";
import * as forgot from "../functions/api/auth/forgot.js";
import * as reset from "../functions/api/auth/reset.js";
import * as me from "../functions/api/me/index.js";
import * as mePassword from "../functions/api/me/password.js";
import * as titleList from "../functions/api/titles/index.js";
import * as titleOne from "../functions/api/titles/[id].js";
import * as libraryList from "../functions/api/library/index.js";
import * as libraryOne from "../functions/api/library/[id].js";
import * as updates from "../functions/api/updates.js";
import * as positionOne from "../functions/api/positions/[id].js";
import * as config from "../functions/api/config.js";
import * as titlePage from "../functions/title/[id].js";
import * as readerPage from "../functions/read/[id]/[chapter].js";
import * as pageImage from "../functions/pages/[id]/[chapter]/[page].js";
import * as adminTitles from "../functions/api/admin/titles/index.js";
import * as adminTitle from "../functions/api/admin/titles/[id].js";
import * as adminChapters from "../functions/api/admin/titles/[id]/chapters/index.js";
import * as adminChapter from "../functions/api/admin/titles/[id]/chapters/[number].js";
import * as adminPublish from "../functions/api/admin/titles/[id]/chapters/[number]/publish.js";
import * as adminPages from "../functions/api/admin/titles/[id]/chapters/[number]/pages/index.js";
import * as adminPage from "../functions/api/admin/titles/[id]/chapters/[number]/pages/[page].js";
import * as adminCover from "../functions/api/admin/titles/[id]/cover.js";
import * as adminComplaints from "../functions/api/admin/complaints/index.js";
import * as adminComplaint from "../functions/api/admin/complaints/[id].js";
import * as complaints from "../functions/api/complaints/index.js";
import * as adminStats from "../functions/api/admin/stats.js";
import * as adminUsers from "../functions/api/admin/users/index.js";
import * as adminUser from "../functions/api/admin/users/[id].js";
import * as adminAudit from "../functions/api/admin/audit.js";
import * as coverImage from "../functions/covers/[id].js";
import * as robots from "../functions/robots.txt.js";
import * as sitemap from "../functions/sitemap.xml.js";
import { error } from "../functions/_lib/http.js";

// Эти же пути перечислены в run_worker_first в wrangler.toml
const ROUTES = [
  ["/api/auth/login", login],
  ["/api/auth/register", register],
  ["/api/auth/logout", logout],
  ["/api/auth/forgot", forgot],
  ["/api/auth/reset", reset],
  ["/api/me", me],
  ["/api/me/password", mePassword],
  ["/api/titles", titleList],
  ["/api/titles/:id", titleOne],
  ["/api/library", libraryList],
  ["/api/library/:id", libraryOne],
  ["/api/updates", updates],
  ["/api/positions/:id", positionOne],
  ["/api/config", config],
  ["/api/complaints", complaints],
  ["/api/admin/complaints", adminComplaints],
  ["/api/admin/complaints/:id", adminComplaint],
  ["/api/admin/stats", adminStats],
  ["/api/admin/users", adminUsers],
  ["/api/admin/users/:id", adminUser],
  ["/api/admin/audit", adminAudit],
  ["/api/admin/titles", adminTitles],
  ["/api/admin/titles/:id", adminTitle],
  ["/api/admin/titles/:id/cover", adminCover],
  ["/api/admin/titles/:id/chapters", adminChapters],
  ["/api/admin/titles/:id/chapters/:number", adminChapter],
  ["/api/admin/titles/:id/chapters/:number/publish", adminPublish],
  ["/api/admin/titles/:id/chapters/:number/pages", adminPages],
  ["/api/admin/titles/:id/chapters/:number/pages/:page", adminPage],
  ["/title/:id", titlePage],
  ["/read/:id/:chapter", readerPage],
  ["/pages/:id/:chapter/:page", pageImage],
  ["/covers/:id", coverImage],
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
