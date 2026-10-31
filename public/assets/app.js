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

/**
 * Cloudflare Web Analytics: скрипт подключается, только если на сайте указан WEB_ANALYTICS_TOKEN.
 * Статистика без cookie, адреса скрипта и отправки уже разрешены в CSP
 */
async function initAnalytics() {
  const { webAnalyticsToken } = await getConfig();
  if (!webAnalyticsToken || document.querySelector("script[data-cf-beacon]")) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token: webAnalyticsToken });
  document.head.append(script);
}

initAnalytics();

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
