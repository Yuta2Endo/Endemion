// Общий код страниц: запросы к API, шапка, уведомления, экранирование

/** Запрос к API. Возвращает { ok, status, data } и не бросает исключение при ошибке сети */
export async function api(path, { method = "GET", body } = {}) {
  const options = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, options);
    let data = null;
    try {
      data = await response.json();
    } catch {}
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Нет связи с сервером. Проверьте интернет." } };
  }
}

let configPromise = null;

/** Публичные настройки сайта (/api/config). Запрос делается один раз на страницу */
export function getConfig() {
  if (!configPromise) configPromise = api("/api/config").then((r) => (r.ok && r.data ? r.data : {}));
  return configPromise;
}

// ==================== СТАТИСТИКА ====================

// Выбор посетителя про Яндекс Метрику: "granted" или "denied". Пока выбора нет, Метрика не загружается
const CONSENT_KEY = "endemion:analytics";
// Страницы без статистики: в адресе /reset бывает ссылка для нового пароля, админка — служебная
const NO_ANALYTICS = /^\/(admin|reset)(\/|$)/;

function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function writeConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {}
}

/** Cloudflare Web Analytics: без cookie, поэтому согласие не нужно. Только если на сайте указан WEB_ANALYTICS_TOKEN */
function loadCloudflareAnalytics(token) {
  if (document.querySelector("script[data-cf-beacon]")) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(script);
}

/**
 * Яндекс Метрика: то же, что официальный код счётчика, но из файла, а не встроенным скриптом (его запрещает CSP).
 * Вебвизор выключен: он записывает действия на странице, включая то, что вводят в формы
 */
function loadMetrika(id) {
  if (window.ym) return;
  window.ym = function () {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = Date.now();
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.append(script);
  window.ym(Number(id), "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}

/** Cookie Метрики (_ym_uid и другие) на этом сайте. Удаляются, если посетитель передумал */
function removeMetrikaCookies() {
  const names = document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter((name) => name.startsWith("_ym"));
  const domain = location.hostname.split(".").slice(-2).join(".");
  for (const name of names) {
    for (const suffix of ["", `; domain=${location.hostname}`, `; domain=.${domain}`]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${suffix}`;
    }
  }
}

/** Плашка с вопросом про cookie. Показывается, пока посетитель не выбрал, и по ссылке «Настройки cookie» */
function showConsent(id) {
  document.querySelector(".consent-banner")?.remove();
  const banner = document.createElement("section");
  banner.className = "consent-banner";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-labelledby", "consentTitle");

  const title = document.createElement("strong");
  title.id = "consentTitle";
  title.textContent = "Cookie и статистика";
  const text = document.createElement("p");
  const link = document.createElement("a");
  link.href = "/privacy#cookie";
  link.textContent = "политике конфиденциальности";
  text.append(
    "Мы хотим считать посещения через Яндекс Метрику, чтобы понимать, что читают и что работает плохо. Метрика ставит cookie. ",
    "Подробнее — в ",
    link,
    "."
  );

  const actions = document.createElement("div");
  actions.className = "consent-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary-btn";
  accept.textContent = "Разрешить";
  const decline = document.createElement("button");
  decline.type = "button";
  decline.className = "ghost-btn";
  decline.textContent = "Отказаться";
  actions.append(accept, decline);

  accept.addEventListener("click", () => {
    writeConsent("granted");
    banner.remove();
    loadMetrika(id);
  });
  decline.addEventListener("click", () => {
    const wasLoaded = Boolean(window.ym);
    writeConsent("denied");
    banner.remove();
    removeMetrikaCookies();
    // Загруженный счётчик сам не остановится: страница открывается заново уже без него
    if (wasLoaded) location.reload();
  });

  banner.append(title, text, actions);
  document.body.append(banner);
}

async function initAnalytics() {
  const { webAnalyticsToken, yandexMetrikaId } = await getConfig();
  // Ссылка «Настройки cookie» в подвале видна, только если Метрика включена
  document.querySelectorAll("[data-cookie-settings]").forEach((node) => (node.hidden = !yandexMetrikaId));
  if (NO_ANALYTICS.test(location.pathname)) return;

  if (webAnalyticsToken) loadCloudflareAnalytics(webAnalyticsToken);
  if (!yandexMetrikaId) return;
  const consent = readConsent();
  if (consent === "granted") loadMetrika(yandexMetrikaId);
  else if (consent !== "denied") showConsent(yandexMetrikaId);
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-cookie-settings]");
  if (!link) return;
  event.preventDefault();
  const { yandexMetrikaId } = await getConfig();
  if (yandexMetrikaId) showConsent(yandexMetrikaId);
});

initAnalytics();

// Service worker: установка сайта как приложения и страница «Нет связи» без интернета (public/sw.js)
function registerServiceWorker() {
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker не зарегистрирован:", err.message));
}

if ("serviceWorker" in navigator) {
  if (document.readyState === "complete") registerServiceWorker();
  else window.addEventListener("load", registerServiceWorker, { once: true });
}

let mePromise = null;

/** Текущий пользователь или null. Запрос делается один раз на страницу */
export function getMe() {
  if (!mePromise) mePromise = api("/api/me").then((r) => (r.ok && r.data ? r.data : { user: null }));
  return mePromise;
}

/** Экранирование для вставки текста в HTML */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let toastTimer = null;

/** Всплывающее уведомление внизу экрана. html = true позволяет вставить ссылку из своего кода */
export function toast(message, { html = false, duration = 3500 } = {}) {
  let element = document.querySelector(".toast");
  if (!element) {
    element = document.createElement("div");
    element.className = "toast";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.append(element);
  }
  if (html) element.innerHTML = message;
  else element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), duration);
}

/** Ссылка на вход с возвратом на текущую страницу */
export function loginUrl() {
  return `/auth?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Только свои адреса: иначе ссылка вида ?next=https://evil.example увела бы пользователя на чужой сайт */
export function safeNext(value, fallback = "/profile") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

/**
 * Шапка: кнопка профиля («Войти» или имя пользователя) и меню на телефоне
 */
export async function initHeader() {
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "✕" : "☰";
    });
    links.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "☰";
      }
    });
  }

  const account = document.querySelector("#accountButton");
  const { user } = await getMe();
  if (account) {
    if (user) {
      account.textContent = user.name;
      account.href = "/profile";
    } else {
      account.textContent = "Войти";
      account.href = loginUrl();
    }
  }
  return user;
}

export const STATUS_LABELS = {
  planned: "Буду читать",
  reading: "Читаю",
  completed: "Прочитано",
  dropped: "Брошено"
};

export const TYPE_LABELS = {
  manga: "Манга",
  manhwa: "Манхва",
  manhua: "Маньхуа"
};

/** Фон обложки для CSS: картинка поверх градиента или только градиент. Такая же функция есть в functions/_lib/titles.js */
export function posterBackground(title) {
  return title.cover ? `url("${title.cover}") center / cover no-repeat, ${title.poster}` : title.poster;
}

/** 1 глава, 3 главы, 5 глав */
export function chaptersText(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "глава"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "главы" : "глав";
  return `${n} ${word}`;
}
