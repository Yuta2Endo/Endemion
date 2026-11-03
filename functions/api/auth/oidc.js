// Вход через Endemion ID: /auth/login уводит на auth.endemion.online, /auth/callback принимает код.
// Старые страницы /auth и /reset при ENDEMION_ID=1 перенаправляют на вход через Endemion ID

import {
  accountUrl, applyClaims, clearStateCookie, endemionIdEnabled, exchangeCode, resolveUser, safeNext, startLogin, takeLogin
} from "../../_lib/endemionId.js";
import { escapeHtml as e } from "../../_lib/html.js";
import { renderPage } from "../../_lib/layout.js";
import { createOidcSession, destroySession } from "../../_lib/session.js";

function problemPage(request, text, { link = { href: "/auth/login", label: "Войти снова" }, extraLink = null, status = 400 } = {}) {
  const links = [link, extraLink].filter(Boolean)
    .map((item) => `<a class="primary-btn" href="${e(item.href)}">${e(item.label)}</a>`).join(" ");
  const body = `<div class="container page"><section class="panel stack">
      <h1>Вход не завершён</h1>
      <p>${e(text)}</p>
      <p>${links}</p>
    </section></div>`;
  return renderPage(request, { title: "Вход", body, noindex: true, status, cache: "no-store" });
}

/** GET /auth/login?next=/путь&screen=register — начать вход или регистрацию в Endemion ID */
export const login = {
  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const next = safeNext(url.searchParams.get("next"));
    if (!endemionIdEnabled(env)) return Response.redirect(new URL(`/auth?next=${encodeURIComponent(next)}`, url), 302);
    return startLogin(env, request, {
      next,
      screen: url.searchParams.get("screen") === "register" ? "register" : null,
      reauth: url.searchParams.get("reauth") === "1"
    });
  }
};

/** GET /auth/callback — ответ Endemion ID: код меняется на токены, создаётся сессия сайта */
export const callback = {
  async onRequestGet({ request, env }) {
    if (!endemionIdEnabled(env)) return problemPage(request, "Вход через Endemion ID выключен.", { status: 404 });
    const url = new URL(request.url);
    const clear = { "Set-Cookie": clearStateCookie(request) };

    const login = await takeLogin(env, request);
    if (!login) return withHeaders(problemPage(request, "Страница входа устарела или открыта в другом браузере. Начните вход заново."), clear);
    if (url.searchParams.get("error")) {
      return withHeaders(problemPage(request, "Endemion ID не подтвердил вход. Попробуйте ещё раз."), clear);
    }

    let result;
    try {
      result = await exchangeCode(env, request, login);
    } catch (err) {
      console.error("Endemion ID: обмен кода не удался", err.message);
      return withHeaders(problemPage(request, "Не получилось проверить ответ Endemion ID. Попробуйте ещё раз."), clear);
    }

    const { claims, refreshToken } = result;
    const found = await resolveUser(env, claims);
    if (found.error === "blocked") return withHeaders(problemPage(request, "Аккаунт на Endemion заблокирован.", { link: { href: "/", label: "На главную" }, status: 403 }), clear);
    if (found.error === "email_linked") {
      return withHeaders(problemPage(request, "Эта почта на Endemion уже связана с другим аккаунтом Endemion ID.", { link: { href: "/", label: "На главную" }, status: 409 }), clear);
    }
    if (found.error === "email_unverified") {
      return withHeaders(problemPage(request,
        "На Endemion уже есть аккаунт с этой почтой. Подтвердите почту в Endemion ID по ссылке из письма, и при следующем входе аккаунты свяжутся, полка и прогресс сохранятся.",
        { link: { href: accountUrl(env), label: "Открыть Endemion ID" }, extraLink: { href: "/auth/login", label: "Войти снова" }, status: 409 }), clear);
    }

    await applyClaims(env, found.userId, claims);
    // Старая сессия этого браузера удаляется, cookie получает новый токен: заранее подсунутая cookie не сработает (session fixation).
    // Заголовок от destroySession не нужен — его заменяет cookie новой сессии
    await destroySession(env, request);
    // Без auth_time вход не считается свежим: опасные действия попросят ввести пароль ещё раз
    const setCookie = await createOidcSession(env, request, found.userId, refreshToken, Number(claims.auth_time) || 0);
    const headers = new Headers({ Location: new URL(login.next, url).href, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", setCookie);
    headers.append("Set-Cookie", clear["Set-Cookie"]);
    return new Response(null, { status: 302, headers });
  }
};

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) headers.append(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** /auth и /reset: при Endemion ID — перенаправление на вход, иначе старые страницы из public/ */
export const legacyPage = {
  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    if (!endemionIdEnabled(env)) return env.ASSETS.fetch(request);
    if (url.pathname === "/reset") return Response.redirect(`${String(env.ENDEMION_ID_ISSUER).replace(/\/+$/, "")}/forgot-password`, 302);
    const next = safeNext(url.searchParams.get("next"));
    const screen = url.searchParams.get("mode") === "register" ? "&screen=register" : "";
    return Response.redirect(new URL(`/auth/login?next=${encodeURIComponent(next)}${screen}`, url), 302);
  }
};
