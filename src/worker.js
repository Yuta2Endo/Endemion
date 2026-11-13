// Точка входа Worker: маршруты API и страниц, которые собираются на сервере. Всё остальное — статика из public/.
// Обработчики в functions/ написаны в формате Pages Functions (onRequestGet и т. д.), поэтому здесь простой маршрутизатор

import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";
import * as login from "../functions/api/auth/login.js";
import * as register from "../functions/api/auth/register.js";
import * as logout from "../functions/api/auth/logout.js";
import * as forgot from "../functions/api/auth/forgot.js";
import * as reset from "../functions/api/auth/reset.js";
import * as endemionId from "../functions/api/auth/oidc.js";
import * as me from "../functions/api/me/index.js";
import * as mePassword from "../functions/api/me/password.js";
import * as meSessions from "../functions/api/me/sessions.js";
import * as config from "../functions/api/config.js";
import * as adminComplaints from "../functions/api/admin/complaints/index.js";
import * as adminComplaint from "../functions/api/admin/complaints/[id].js";
import * as complaints from "../functions/api/complaints/index.js";
import * as adminStats from "../functions/api/admin/stats.js";
import * as adminUsers from "../functions/api/admin/users/index.js";
import * as adminUser from "../functions/api/admin/users/[id].js";
import * as adminAudit from "../functions/api/admin/audit.js";
import * as adminAccounts from "../functions/api/admin/accounts.js";
import * as robokassaResult from "../functions/api/robokassa/result.js";
import * as robokassaCreate from "../functions/api/robokassa/create.js";
import * as robots from "../functions/robots.txt.js";
import * as sitemap from "../functions/sitemap.xml.js";
import * as profile from "../functions/api/profile.js";
import * as library from "../functions/api/users/library.js";
import * as gameReviews from "../functions/api/games/reviews.js";
import * as pulse from "../functions/api/pulse.js";
import * as community from "../functions/api/community.js";
import * as searchApi from "../functions/api/search.js";
import * as moderation from "../functions/api/moderation.js";
import * as adminPlatform from "../functions/api/adminPlatform.js";
import * as site from "../functions/site.js";
import * as adminStudio from "../functions/api/adminStudio.js";
import * as studioPages from "../functions/studio.js";
import * as legal from "../functions/legal.js";
import * as media from "../functions/media.js";
import * as jwks from "../functions/jwks.js";
import { error } from "../functions/_lib/http.js";

// Эти же пути перечислены в run_worker_first в wrangler.toml
/** @type {Array<[string, any]>} */
const ROUTE_LIST = [
  ["/api/auth/login", login],
  ["/api/auth/register", register],
  ["/api/auth/logout", logout],
  ["/api/auth/forgot", forgot],
  ["/api/auth/reset", reset],
  // Endemion ID (auth.endemion.online): вход, ответ провайдера и старые страницы входа
  ["/auth/login", endemionId.login],
  ["/auth/callback", endemionId.callback],
  ["/auth", endemionId.legacyPage],
  ["/reset", endemionId.legacyPage],
  ["/api/me", me],
  ["/api/me/password", mePassword],
  ["/api/me/sessions", meSessions],
  ["/api/config", config],
  ["/api/robokassa/result", robokassaResult],
  ["/api/robokassa/create", robokassaCreate],
  ["/api/complaints", complaints],
  ["/api/admin/complaints", adminComplaints],
  ["/api/admin/complaints/:id", adminComplaint],
  ["/api/admin/stats", adminStats],
  ["/api/admin/users", adminUsers],
  ["/api/admin/users/:id", adminUser],
  ["/api/admin/audit", adminAudit],
  ["/api/admin/accounts", adminAccounts],
  // Профили ENDEMION ID
  ["/api/me/profile", profile.meProfile],
  ["/api/me/avatar", profile.meAvatar],
  ["/api/me/achievements", profile.meAchievements],
  ["/api/users", profile.userSearch],
  ["/api/users/:username", profile.userProfile],
  ["/api/users/:username/follows", profile.userFollows],
  ["/api/users/:username/follow", profile.userFollow],
  ["/api/users/:username/forum", profile.userForum],
  // Избранные игры пользователя
  ["/api/users/:username/library", library.userLibrary],
  ["/api/users/:username/library/add", library.userLibraryAdd],
  ["/api/users/:username/library/:game_id", library.userLibraryRemove],
  // Отзывы к играм
  ["/api/games/:slug/reviews", gameReviews.gameReviews],
  ["/api/games/:slug/reviews/add", gameReviews.gameReviewAdd],
  ["/api/games/:slug/reviews/:review_id", gameReviews.gameReviewUpdateDelete],
  // Уведомления
  ["/api/notifications", pulse.notifications],
  ["/api/notifications/count", pulse.notificationCount],
  // COMMUNITY
  ["/api/comments", community.comments],
  ["/api/comments/:id", community.comment],
  ["/api/comments/:id/reactions", community.commentReactions],
  ["/api/search", searchApi.search],
  ["/api/threads", community.threads],
  ["/api/threads/:id", community.thread],
  ["/api/threads/:id/moderation", community.threadModeration],
  ["/api/threads/:id/subscription", community.threadSubscription],
  ["/api/threads/:id/revisions", community.threadRevisions],
  ["/api/reports", community.reports],
  // Модерация (модератор и администратор)
  ["/api/moderation/reports", moderation.moderationReports],
  ["/api/moderation/actions", moderation.moderationActions],
  ["/api/moderation/users/:id/unmute", moderation.moderationUnmute],
  ["/api/moderation/log", moderation.moderationLog],
  ["/api/moderation/comments", moderation.moderationComments],
  // Админка платформы
  ["/api/admin/games", adminStudio.adminGames],
  ["/api/admin/games/:id", adminStudio.adminGame],
  ["/api/admin/games/:id/cover", adminStudio.adminGameCover],
  ["/api/admin/games/:id/media", adminStudio.adminGameMedia],
  ["/api/admin/games/:id/media/:mediaId", adminStudio.adminGameMediaItem],
  ["/api/admin/studio-posts", adminStudio.adminPosts],
  ["/api/admin/studio-posts/:id", adminStudio.adminPost],
  ["/api/admin/studio-posts/:id/image", adminStudio.adminPostImage],
  ["/api/admin/telegram/pending", adminStudio.adminTelegramPending],
  ["/api/admin/studio-posts/:id/telegram-preview", adminStudio.adminPostTelegramPreview],
  ["/api/admin/studio-posts/:id/telegram-publish", adminStudio.adminPostTelegramPublish],
  ["/api/admin/forum-categories", adminStudio.adminCategories],
  ["/api/admin/forum-categories/:id", adminStudio.adminCategory],
  ["/api/admin/site-settings", adminStudio.adminSiteSettings],
  ["/api/admin/users/:id/role", adminPlatform.adminUserRole],
  ["/api/admin/platform-stats", adminPlatform.adminPlatformStats],
  ["/avatars/:id", profile.avatarImage],
  // Страницы разделов: каркас с сервера, данные подгружает скрипт раздела
  // Портал Endemion Studio (functions/studio.js): главная, игры, разработка, о студии
  ["/", studioPages.home],
  ["/games", studioPages.gamesPage],
  ["/games/:slug", studioPages.gamePage],
  ["/studio", studioPages.studioPage],
  ["/studio/:slug", studioPages.postPage],
  ["/about", studioPages.aboutPage],
  ["/terms", studioPages.termsPage],
  // Legal Center: документы игр, тексты в functions/_lib/legal/
  ["/legal", legal.center],
  ["/legal/:game", legal.gameIndex],
  ["/legal/:game/:document", legal.documentPage],
  ["/media/games/:id/cover", media.gameCover],
  ["/media/games/:id/shots/:mediaId", media.gameShot],
  ["/media/posts/:id", media.postImage],
  ["/profile", site.profile],
  ["/account", site.account],
  ["/notifications", site.notificationsPage],
  ["/search", site.searchPage],
  ["/community", site.community],
  ["/community/c/:slug", studioPages.categoryPage],
  ["/community/thread/:id", site.threadPage],
  ["/users/:username", site.userPage],
  ["/u/:username", site.userRedirect],
  ["/robots.txt", robots],
  ["/sitemap.xml", sitemap],
  // Stage 11.2: публичные ключи портала для проверки утверждений Endemion Life
  ["/.well-known/jwks.json", jwks]
];

// Разделы, удалённые при переходе на портал студии (2026-11-04): энциклопедия, читалка манги, Nexus, Oracle, Pulse, Арена, подборки.
// Старые адреса и закладки ведут на главную. Данные этих разделов остались в базе
const RETIRED = new Set([
  "encyclopedia", "anime", "manga", "characters", "people", "studios", "seasons", "rankings", "mylist",
  "reading", "catalog", "title", "read", "pages", "covers", "nexus", "oracle", "pulse", "arena", "collection"
]);

function retired(pathname) {
  if (!RETIRED.has(pathname.split("/")[1])) return null;
  // 410, а не 301: раздел закрыт насовсем, замены у этих адресов нет.
  // Редирект на главную поисковики считают «мягкой 404» и держат адрес в индексе.
  return new Response("Этот раздел закрыт и больше не открывается.", {
    status: 410,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" }
  });
}

const ROUTES = ROUTE_LIST.map(([pattern, module]) => ({ parts: pattern.split("/").filter(Boolean), module }));

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

// Service worker, который браузеры получают со старого адреса: он удаляет сам себя, чтобы не мешать переезду
const RETIRED_SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.registration.unregister()));
`;

/** Старый адрес workers.dev: постоянное перенаправление на тот же путь на новом домене */
function redirectToNewSite(request, url, target) {
  if (url.pathname === "/sw.js") {
    return new Response(RETIRED_SERVICE_WORKER, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" }
    });
  }
  const location = new URL(url.pathname + url.search, target);
  // 308 сохраняет метод запроса. Изменяющие запросы на новом сайте всё равно отклонит проверка Origin
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { Location: location.href, "Cache-Control": "public, max-age=3600" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Сайт переехал на свой сервер. На своём сервере REDIRECT_TO не задаётся, а в wrangler dev адрес не workers.dev
    if (env.REDIRECT_TO && url.hostname.endsWith(".workers.dev")) return redirectToNewSite(request, url, env.REDIRECT_TO);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (!isApi) {
      const moved = retired(url.pathname);
      if (moved) return moved;
    }
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
