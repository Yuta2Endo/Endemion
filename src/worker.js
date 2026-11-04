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
import * as profile from "../functions/api/profile.js";
import * as pulse from "../functions/api/pulse.js";
import * as discover from "../functions/api/discover.js";
import * as community from "../functions/api/community.js";
import * as arena from "../functions/api/arena.js";
import * as moderation from "../functions/api/moderation.js";
import * as adminPlatform from "../functions/api/adminPlatform.js";
import * as site from "../functions/site.js";
import * as ency from "../functions/api/encyclopedia.js";
import * as encyPages from "../functions/encyclopedia.js";
import * as universe from "../functions/api/universe.js";
import * as adminUniverse from "../functions/api/adminUniverse.js";
import * as adminStudio from "../functions/api/adminStudio.js";
import * as studioPages from "../functions/studio.js";
import * as media from "../functions/media.js";
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
  // ENDEMION ID
  ["/api/me/profile", profile.meProfile],
  ["/api/me/genres", profile.meGenres],
  ["/api/me/avatar", profile.meAvatar],
  ["/api/me/history", profile.meHistory],
  ["/api/me/achievements", profile.meAchievements],
  ["/api/users", profile.userSearch],
  ["/api/users/:username", profile.userProfile],
  ["/api/users/:username/library", profile.userLibrary],
  ["/api/users/:username/follows", profile.userFollows],
  ["/api/users/:username/follow", profile.userFollow],
  ["/api/users/:username/forum", profile.userForum],
  // ENDEMION PULSE
  ["/api/notifications", pulse.notifications],
  ["/api/notifications/count", pulse.notificationCount],
  ["/api/calendar", pulse.calendar],
  ["/api/continue", pulse.continueReading],
  ["/api/titles/:id/view", pulse.titleView],
  // NEXUS, ORACLE, главная
  ["/api/home", discover.home],
  ["/api/random", discover.randomTitle],
  ["/api/taxonomy", discover.taxonomy],
  ["/api/nexus/:id", discover.nexusGraph],
  ["/api/titles/:id/related", discover.titleRelated],
  ["/api/titles/:id/details", discover.titleDetails],
  ["/api/oracle", discover.oracleMoods],
  ["/api/oracle/:mood", discover.oracleRecommend],
  // COMMUNITY
  ["/api/titles/:id/reviews", community.titleReviews],
  ["/api/reviews/:id", community.review],
  ["/api/comments", community.comments],
  ["/api/comments/:id", community.comment],
  ["/api/comments/:id/reactions", community.commentReactions],
  ["/api/threads", community.threads],
  ["/api/threads/:id", community.thread],
  ["/api/threads/:id/moderation", community.threadModeration],
  ["/api/collections", community.collections],
  ["/api/collections/:id", community.collection],
  ["/api/collections/:id/items", community.collectionItems],
  ["/api/reports", community.reports],
  // ARENA
  ["/api/polls", arena.polls],
  ["/api/polls/:id", arena.poll],
  ["/api/polls/:id/vote", arena.pollVote],
  ["/api/tournaments", arena.tournaments],
  ["/api/tournaments/:id", arena.tournament],
  ["/api/tournaments/:id/matches/:match/vote", arena.tournamentVote],
  ["/api/arena/leaderboards", arena.arenaLeaderboards],
  ["/api/characters", arena.characters],
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
  ["/api/admin/forum-categories", adminStudio.adminCategories],
  ["/api/admin/forum-categories/:id", adminStudio.adminCategory],
  ["/api/admin/site-settings", adminStudio.adminSiteSettings],
  ["/api/admin/genres", adminPlatform.adminGenres],
  ["/api/admin/genres/:id", adminPlatform.adminGenre],
  ["/api/admin/authors", adminPlatform.adminAuthors],
  ["/api/admin/authors/:id", adminPlatform.adminAuthor],
  ["/api/admin/tags", adminPlatform.adminTags],
  ["/api/admin/titles/:id/characters", adminPlatform.adminCharacters],
  ["/api/admin/characters/:id", adminPlatform.adminCharacter],
  ["/api/admin/titles/:id/relations", adminPlatform.adminRelations],
  ["/api/admin/users/:id/role", adminPlatform.adminUserRole],
  ["/api/admin/collections", adminPlatform.adminCollections],
  ["/api/admin/collections/:id", adminPlatform.adminCollection],
  ["/api/admin/platform-stats", adminPlatform.adminPlatformStats],
  // Энциклопедия: каталог из внешнего источника (functions/_lib/catalog), списки, избранное и отзывы пользователей
  ["/api/catalog/:kind", ency.catalogList],
  ["/api/catalog/:kind/genres", ency.catalogGenres],
  ["/api/catalog/:kind/:id/reviews", ency.entryReviews],
  ["/api/search", ency.search],
  ["/api/rankings", ency.rankings],
  ["/api/recommendations", ency.recommendationList],
  ["/api/mylist", ency.myList],
  ["/api/mylist/:kind/:id", ency.myListItem],
  ["/api/favorites", ency.favorites],
  ["/api/favorites/:type/:id", ency.favorite],
  ["/api/entry-reviews", ency.recentReviews],
  ["/api/entry-reviews/:id", ency.entryReview],
  ["/api/users/:username/encyclopedia", ency.userEncyclopedia],
  ["/api/users/:username/mylist", ency.userList],
  ["/api/admin/catalog", ency.adminCatalog],
  ["/api/admin/catalog/settings", ency.adminCatalogSettings],
  ["/api/admin/catalog/cache", ency.adminCatalogCache],
  ["/api/admin/catalog/errors", ency.adminCatalogErrors],
  ["/api/admin/entry-reviews", ency.adminReviews],
  // Universe Explorer: карта вселенной, хронология и режим спойлеров (functions/api/universe.js)
  ["/api/universe/:kind/:id", universe.graph],
  ["/api/universe/:kind/:id/timeline", universe.timeline],
  ["/api/universe/:kind/:id/settings", universe.settings],
  ["/api/admin/universe/entities/:entityId", adminUniverse.adminUniverseEntity],
  ["/api/admin/universe/relations/:relationId", adminUniverse.adminUniverseRelation],
  ["/api/admin/universe/:kind/:id", adminUniverse.adminUniverse],
  ["/api/admin/universe/:kind/:id/entities", adminUniverse.adminUniverseEntities],
  ["/api/admin/universe/:kind/:id/relations", adminUniverse.adminUniverseRelations],
  ["/title/:id", titlePage],
  ["/read/:id/:chapter", readerPage],
  ["/pages/:id/:chapter/:page", pageImage],
  ["/covers/:id", coverImage],
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
  ["/media/games/:id/cover", media.gameCover],
  ["/media/games/:id/shots/:mediaId", media.gameShot],
  ["/media/posts/:id", media.postImage],
  // Энциклопедия аниме и манги: в меню не входит (решение владельца 2026-11-04), адреса работают
  ["/encyclopedia", encyPages.home],
  ["/anime", encyPages.animeCatalog],
  ["/manga", encyPages.mangaCatalog],
  ["/anime/:slug", encyPages.animePage],
  ["/manga/:slug", encyPages.mangaPage],
  ["/characters", encyPages.characters],
  ["/characters/:slug", encyPages.characterPage],
  ["/people", encyPages.people],
  ["/people/:slug", encyPages.personPage],
  ["/studios", encyPages.studios],
  ["/studios/:slug", encyPages.studioPage],
  ["/seasons", encyPages.seasons],
  ["/seasons/:code", encyPages.seasons],
  ["/rankings", encyPages.rankingsPage],
  ["/mylist", encyPages.myListPage],
  ["/search", encyPages.searchPage],
  // Прежняя главная платформы чтения: подборки по настроению, полка, Nexus и Oracle
  ["/reading", site.home],
  ["/catalog", site.catalog],
  ["/nexus", site.nexus],
  ["/oracle", site.oracle],
  ["/pulse", site.pulse],
  ["/profile", site.profile],
  ["/community", site.community],
  ["/community/c/:slug", studioPages.categoryPage],
  ["/community/thread/:id", site.threadPage],
  ["/collection/:id", site.collectionPage],
  ["/arena", site.arena],
  ["/users/:username", site.userPage],
  ["/u/:username", site.userRedirect],
  ["/robots.txt", robots],
  ["/sitemap.xml", sitemap]
];

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
