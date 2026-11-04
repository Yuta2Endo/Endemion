// Общий код страниц: запросы к API, шапка, карточки тайтлов, состояния загрузки, диалоги, полка и жалобы

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

// Ссылки на соцсети в подвале (Настройки сайта в админке). Адреса уже проверены сервером, здесь ещё раз — только https
async function initFooterSocial() {
  const list = document.getElementById("footerSocial");
  if (!list) return;
  const { socialLinks } = await getConfig();
  const links = (socialLinks || []).filter((item) => typeof item?.label === "string" && typeof item.url === "string" && item.url.startsWith("https://"));
  list.replaceChildren(...links.map((item) => {
    const node = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = item.label;
    a.rel = "noopener noreferrer";
    a.target = "_blank";
    node.append(a);
    return node;
  }));
  list.hidden = !links.length;
}

initFooterSocial();

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

/** Подсказка гостю: войти, чтобы действие сохранилось */
export function askLogin(text = "Чтобы сохранять это, войдите в профиль.") {
  toast(`${escapeHtml(text)} <a href="${escapeHtml(loginUrl())}">Войти</a>`, { html: true, duration: 5000 });
}

/**
 * Шапка: меню на телефоне, кнопка профиля (аватар и имя или «Войти»), колокольчик с числом непрочитанных уведомлений
 */
export async function initHeader() {
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    const hasIcons = Boolean(toggle.querySelector("svg"));
    const setOpen = (open) => {
      links.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (!hasIcons) toggle.textContent = open ? "✕" : "☰";
    };
    toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
    links.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && links.classList.contains("open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  const account = document.querySelector("#accountButton");
  const me = await getMe();
  const { user } = me;
  // «Регистрация» рядом с «Войти» только для гостя. /auth?mode=register ведёт на регистрацию в Endemion ID или на старую форму
  const register = document.querySelector("#registerButton");
  if (register instanceof HTMLElement) register.hidden = Boolean(user);
  if (account instanceof HTMLAnchorElement) {
    if (user) {
      const name = el("span", "account-name", user.name);
      account.replaceChildren(avatar(user, "account-avatar"), name);
      account.href = "/profile";
      account.setAttribute("aria-label", `Профиль: ${user.name}`);
    } else {
      account.textContent = "Войти";
      account.href = loginUrl();
    }
  }
  const bell = document.querySelector("#notifyButton");
  if (bell instanceof HTMLElement) {
    bell.hidden = !user;
    if (user) setUnread(me.unread || 0);
  }
  initSearch();
  return user;
}

// ==================== ПОИСК ПО ЭНЦИКЛОПЕДИИ ====================

const slugPart = (item) => `${item.id}${item.slug ? `-${item.slug}` : ""}`;
export const entryUrl = (entry) => `/${entry.kind}/${slugPart(entry)}`;
export const characterUrl = (item) => `/characters/${slugPart(item)}`;
export const personUrl = (item) => `/people/${slugPart(item)}`;
export const studioUrl = (item) => `/studios/${slugPart(item)}`;

/** Картинка из каталога (Shikimori) без отправки адреса страницы. Нет картинки — заглушка */
export function remoteImage(url, alt = "", className = "") {
  if (!url) {
    const empty = el("span", `poster-empty${className ? ` ${className}` : ""}`, "✦");
    empty.setAttribute("aria-hidden", "true");
    return empty;
  }
  const img = el("img", className || null);
  img.src = url;
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  return img;
}

const SEARCH_GROUPS = [
  ["anime", "Аниме", (item) => entryUrl(item), (item) => [item.year, item.titleEn].filter(Boolean).join(" · ")],
  ["manga", "Манга", (item) => entryUrl(item), (item) => [item.year, item.titleEn].filter(Boolean).join(" · ")],
  ["characters", "Персонажи", characterUrl, (item) => item.nameEn || ""],
  ["people", "Люди", personUrl, (item) => item.nameEn || ""],
  ["studios", "Студии", studioUrl, () => "Студия"]
];

/**
 * Поиск в шапке: кнопка с лупой открывает поле, подсказки появляются по мере ввода.
 * «/» открывает поиск с любого места страницы, Escape закрывает. Без скриптов лупа ведёт на страницу /search
 */
function initSearch() {
  const toggle = document.querySelector("#searchToggle");
  const panel = document.querySelector("#searchPanel");
  const input = document.querySelector("#globalSearch");
  const results = document.querySelector("#searchResults");
  if (!(toggle instanceof HTMLElement && panel instanceof HTMLElement && input instanceof HTMLInputElement && results)) return;
  toggle.setAttribute("aria-controls", "searchPanel");
  toggle.setAttribute("aria-expanded", "false");

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  };
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(panel.hidden);
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  let timer = null;
  // Ответ на устаревший запрос (пользователь продолжил печатать) отбрасывается
  let requestId = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });

  async function run() {
    const query = input.value.trim();
    const id = ++requestId;
    if ([...query].length < 2) {
      results.replaceChildren();
      return;
    }
    results.replaceChildren(el("p", "muted small", "Ищем…"));
    const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (id !== requestId) return;
    if (!result.ok) {
      results.replaceChildren(el("p", "muted small", result.data?.error || "Поиск не удался. Попробуйте ещё раз."));
      return;
    }
    const groups = [];
    for (const [key, label, url, note] of SEARCH_GROUPS) {
      const items = (result.data[key] || []).slice(0, 5);
      if (!items.length) continue;
      const group = el("section", "search-group");
      group.append(el("h3", null, label));
      for (const item of items) {
        const hit = el("a", "search-hit");
        hit.href = url(item);
        const text = el("span");
        text.append(el("strong", null, item.title || item.name), el("small", null, note(item)));
        hit.append(remoteImage(item.poster?.small || item.image?.small || item.image, ""), text);
        group.append(hit);
      }
      groups.push(group);
    }
    if (!groups.length) {
      results.replaceChildren(el("p", "muted small", "Ничего не найдено. Попробуйте другое написание или название на английском."));
      return;
    }
    results.replaceChildren(...groups, link(`/search?q=${encodeURIComponent(query)}`, "ghost-btn small-btn search-all", "Все результаты →"));
  }
}

/** Число непрочитанных уведомлений на колокольчике в шапке */
export function setUnread(count) {
  const badge = document.querySelector("#notifyCount");
  const bell = document.querySelector("#notifyButton");
  if (!(badge instanceof HTMLElement)) return;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  bell?.setAttribute("aria-label", count > 0 ? `Уведомления: ${count} новых` : "Уведомления");
}

// ==================== СПРАВОЧНИКИ ====================

export const STATUS_LABELS = {
  reading: "Читаю",
  planned: "В планах",
  completed: "Прочитано",
  on_hold: "Отложено",
  dropped: "Брошено"
};

export const TYPE_LABELS = {
  manga: "Манга",
  manhwa: "Манхва",
  manhua: "Маньхуа"
};

export const RELEASE_LABELS = { ongoing: "Выходит", completed: "Завершён" };

export const SORT_LABELS = {
  popular: "По популярности",
  rating: "По оценке редакции",
  readers: "По оценке читателей",
  new: "Новинки",
  updated: "Недавно обновлённые",
  year: "По году",
  title: "По названию"
};

/** Фон обложки для CSS: картинка поверх градиента или только градиент. Такая же функция есть в functions/_lib/titles.js */
export function posterBackground(title) {
  return title.cover ? `url("${title.cover}") center / cover no-repeat, ${title.poster}` : title.poster;
}

/** 1 глава, 3 главы, 5 глав */
export function chaptersText(n) {
  return `${n} ${plural(n, "глава", "главы", "глав")}`;
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ==================== ДАТЫ ====================

/** Дата из базы («2026-10-30 12:00:00», UTC) → Date */
export function parseDate(value) {
  return new Date(`${String(value).replace(" ", "T")}Z`);
}

export function formatDate(value, options = { day: "numeric", month: "long", year: "numeric" }) {
  return parseDate(value).toLocaleDateString("ru-RU", options);
}

/** «только что», «5 мин назад», «вчера», «3 дня назад», дальше — дата */
export function timeAgo(value) {
  const seconds = Math.max(0, (Date.now() - parseDate(value).getTime()) / 1000);
  if (seconds < 60) return "только что";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч назад`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return formatDate(value, { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}

// ==================== ЭЛЕМЕНТЫ ====================

/** Элемент с классом и текстом. Текст всегда через textContent: так строка из базы не станет HTML */
export function el(tag, className = null, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

export function link(href, className, text) {
  const node = el("a", className, text);
  node.href = href;
  return node;
}

export function button(text, className, onClick, { label = null, pressed = null } = {}) {
  const node = el("button", className, text);
  node.type = "button";
  if (label) node.setAttribute("aria-label", label);
  if (pressed !== null) node.setAttribute("aria-pressed", String(pressed));
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

/** Аватар: загруженная картинка или первая буква имени на цветном фоне */
export function avatar(user, extraClass = "") {
  const node = el("span", `avatar-dot color-${user?.avatarColor || "violet"} ${extraClass}`.trim());
  node.setAttribute("aria-hidden", "true");
  if (user?.avatar) {
    const img = el("img");
    img.src = user.avatar;
    img.alt = "";
    img.loading = "lazy";
    node.append(img);
  } else {
    node.textContent = (user?.name || "?").charAt(0).toUpperCase();
  }
  return node;
}

/** Имя пользователя со ссылкой на профиль и меткой роли */
export function userLink(user, { small = "", size = "" } = {}) {
  const wrap = el("span", "user-chip");
  if (!user) {
    wrap.append(avatar(null, size), el("span", "muted", "Удалённый пользователь"));
    return wrap;
  }
  const text = el("span");
  const name = user.username ? link(`/users/${encodeURIComponent(user.username)}`, null, user.name) : el("span", null, user.name);
  const strong = el("strong");
  strong.append(name);
  if (user.role === "admin" || user.role === "moderator") strong.append(el("span", "role-badge", user.role === "admin" ? "админ" : "модератор"));
  text.append(strong);
  if (small) text.append(el("small", null, small));
  wrap.append(avatar(user, size), text);
  return wrap;
}

/** Состояние раздела: пусто, ошибка или подсказка. action — { href, text } или { onClick, text } */
export function stateBox({ icon = "✦", title = "", text = "", action = null, error = false } = {}) {
  const box = el("div", `state${error ? " state-error" : ""}`);
  box.setAttribute("role", error ? "alert" : "status");
  box.append(el("span", "state-icon", error ? "⚠" : icon));
  if (title) box.append(el("strong", null, title));
  if (text) box.append(el("p", null, text));
  if (action) {
    box.append(action.href ? link(action.href, "ghost-btn", action.text) : button(action.text, "ghost-btn", action.onClick));
  }
  return box;
}

export function errorBox(message, retry = null) {
  return stateBox({ error: true, title: "Не получилось загрузить", text: message, action: retry ? { text: "Повторить", onClick: retry } : null });
}

/** Скелеты карточек, пока идёт загрузка */
export function cardSkeletons(count = 6) {
  return Array.from({ length: count }, () => {
    const box = el("div", "t-skeleton");
    box.setAttribute("aria-hidden", "true");
    box.append(el("div", "skeleton"), el("div", "skeleton skeleton-line"), el("div", "skeleton skeleton-line"));
    return box;
  });
}

export function lineSkeletons(count = 4, height = 70) {
  return Array.from({ length: count }, () => {
    const line = el("div", "skeleton");
    line.style.height = `${height}px`;
    line.setAttribute("aria-hidden", "true");
    return line;
  });
}

/** Обложка тайтла: картинка или градиент с символом */
export function coverBox(title, className = "t-cover") {
  const cover = el("div", `${className}${title.cover ? " has-image" : ""}`);
  cover.style.setProperty("--poster", posterBackground(title));
  if (title.cover) {
    cover.setAttribute("role", "img");
    cover.setAttribute("aria-label", `Обложка «${title.title}»`);
  }
  const symbol = el("span", "t-symbol", title.symbol || "✦");
  symbol.setAttribute("aria-hidden", "true");
  cover.append(symbol);
  return cover;
}

/** Маленькая обложка для списков (уведомления, поиск, календарь) */
export function thumb(title, className = "update-thumb") {
  const node = el("span", className, title.cover ? "" : title.symbol || "✦");
  node.style.setProperty("--poster", posterBackground(title));
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** Оценка для карточки: читателей, если оценок достаточно, иначе редакции */
export function scoreText(title) {
  if (title.readerVotes >= 3 && title.readerRating !== null) return `★ ${title.readerRating.toFixed(1)}`;
  return `★ ${Number(title.rating).toFixed(1)}`;
}

/**
 * Карточка тайтла: обложка, тип и статус, оценка, название, жанры и краткое описание.
 * options.library — запись полки (избранное и прогресс), options.onFavorite — кнопка ♡, options.wide — широкая карточка,
 * options.reasons — объяснение рекомендации или связи, options.extra — элементы под текстом
 */
export function titleCard(title, { library = null, onFavorite = null, wide = false, reasons = null, extra = null, description = wide } = {}) {
  const card = el("article", `t-card${wide ? " is-wide" : ""}`);
  card.dataset.titleId = String(title.id);
  const cover = coverBox(title);

  const badges = el("div", "t-badges");
  badges.append(el("span", `t-badge type-${title.type}`, TYPE_LABELS[title.type]));
  if (!wide) badges.append(el("span", `t-badge status-${title.status}`, RELEASE_LABELS[title.status]));
  cover.append(badges);

  const score = el("div", "t-score");
  const rating = el("span", "t-rating", scoreText(title));
  rating.title = title.readerVotes >= 3 ? `Оценка читателей: ${title.readerVotes} голосов` : "Оценка редакции";
  score.append(rating);
  if (title.chapters) score.append(el("span", "t-readers", chaptersText(title.chapters)));
  cover.append(score);

  if (onFavorite) {
    const favorite = Boolean(library?.favorite);
    const fav = button(favorite ? "♥" : "♡", "t-fav", () => onFavorite(title, card), {
      label: favorite ? `Убрать «${title.title}» из избранного` : `Добавить «${title.title}» в избранное`,
      pressed: favorite
    });
    cover.append(fav);
  }

  const body = el("div", "t-body");
  const heading = el("h3", "t-title");
  heading.append(link(`/title/${title.id}`, null, title.title));
  body.append(heading);
  const meta = [title.genres.slice(0, wide ? 4 : 2).join(" · ")];
  if (wide) meta.unshift(`${title.year}`);
  body.append(el("p", "t-meta", meta.filter(Boolean).join(" · ")));
  if (wide && title.status) body.append(el("p", "t-meta", `${RELEASE_LABELS[title.status]}${title.author ? ` · ${title.author}` : ""}`));
  if (description && title.description) body.append(el("p", "t-desc", title.description));
  if (reasons?.length) body.append(reasonList(reasons));

  if (library && library.chapter > 0 && title.chapters > 0) {
    const progress = el("div", "t-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Прочитано глав");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(title.chapters));
    progress.setAttribute("aria-valuenow", String(library.chapter));
    const bar = el("span");
    bar.style.width = `${Math.min(100, Math.round((library.chapter / title.chapters) * 100))}%`;
    progress.append(bar);
    body.append(progress, el("p", "t-meta", `${STATUS_LABELS[library.status] || "На полке"} · ${library.chapter} из ${title.chapters}`));
  } else if (library?.status) {
    body.append(el("p", "t-meta", STATUS_LABELS[library.status]));
  }
  if (extra) body.append(...[].concat(extra));
  card.append(cover, body);
  return card;
}

/** Объяснение связи или рекомендации: «Жанры: Экшен, Фэнтези» */
export function reasonList(reasons, max = 4) {
  const list = el("div", "reasons");
  for (const reason of reasons.slice(0, max)) {
    const row = el("p", "reason");
    row.dataset.kind = reason.kind;
    row.append(el("b", null, reason.label));
    if (reason.items?.length) row.append(el("span", null, reason.items.join(", ")));
    list.append(row);
  }
  return list;
}

/** Кнопки «назад» и «вперёд» для горизонтальной ленты */
export function railControls(rail) {
  const controls = el("div", "rail-controls");
  const step = () => Math.max(rail.clientWidth * 0.8, 200);
  const prev = button("←", null, () => rail.scrollBy({ left: -step(), behavior: "smooth" }), { label: "Прокрутить назад" });
  const next = button("→", null, () => rail.scrollBy({ left: step(), behavior: "smooth" }), { label: "Прокрутить вперёд" });
  const update = () => {
    prev.disabled = rail.scrollLeft <= 4;
    next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
  };
  rail.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(update).observe(rail);
  controls.append(prev, next);
  return controls;
}

// ==================== ПОЛКА ====================

let libraryPromise = null;

/** Полка пользователя: Map titleId → { favorite, status, chapter }. Пустая для гостя */
export function getLibrary() {
  if (!libraryPromise) {
    libraryPromise = getMe().then(async ({ user }) => {
      if (!user) return new Map();
      const result = await api("/api/library");
      return new Map((result.ok ? result.data.items : []).map((item) => [item.titleId, item]));
    });
  }
  return libraryPromise;
}

/** Изменить запись полки. Возвращает новую запись или null; гостю предлагает войти */
export async function updateLibrary(titleId, changes) {
  const { user } = await getMe();
  if (!user) {
    askLogin("Чтобы собирать свою полку, войдите в профиль.");
    return null;
  }
  const result = await api(`/api/library/${titleId}`, { method: "PUT", body: changes });
  if (!result.ok) {
    toast(result.data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
    return null;
  }
  const library = await getLibrary();
  library.set(titleId, result.data.item);
  announceAchievements(result.data.achievements);
  return result.data.item;
}

/** Обработчик кнопки ♡ на карточке: переключает избранное и перерисовывает кнопку */
export async function toggleFavorite(title, card) {
  const library = await getLibrary();
  const current = library.get(title.id);
  const item = await updateLibrary(title.id, { favorite: !current?.favorite });
  if (!item) return;
  const fav = card.querySelector(".t-fav");
  if (fav) {
    fav.textContent = item.favorite ? "♥" : "♡";
    fav.setAttribute("aria-pressed", String(item.favorite));
    fav.setAttribute("aria-label", item.favorite ? `Убрать «${title.title}» из избранного` : `Добавить «${title.title}» в избранное`);
  }
  toast(item.favorite ? `«${title.title}» в избранном` : `«${title.title}» убран из избранного`);
}

const ACHIEVEMENT_NAMES = {
  first_shelf: "Первая полка", collector_10: "Коллекционер", finisher_1: "Финишная прямая", finisher_10: "Марафонец",
  chapters_100: "Сотня глав", chapters_1000: "Тысяча глав", explorer_5: "Исследователь жанров", critic_1: "Первая оценка",
  critic_10: "Критик", voice_10: "Голос сообщества", theorist: "Теоретик", voter_10: "Избиратель", curator: "Куратор",
  followed_5: "Узнаваемый"
};

/** Сообщить о новых достижениях, которые вернул сервер после действия */
export function announceAchievements(codes) {
  if (!codes?.length) return;
  const names = codes.map((code) => `«${ACHIEVEMENT_NAMES[code] || code}»`).join(", ");
  setTimeout(() => toast(`🏆 Новое достижение: ${names}`, { duration: 5000 }), 600);
}

// ==================== ПОДБОР ТАЙТЛА ====================

/**
 * Поле поиска тайтла с подсказками. onPick(title) вызывается при выборе.
 * Возвращает { root, input, clear }. Подсказки — из /api/titles по мере ввода
 */
export function titlePicker({ placeholder = "Название тайтла…", onPick, label = "Найти тайтл", id = `picker${Math.random().toString(36).slice(2, 8)}` }) {
  const root = el("div", "picker");
  const labelNode = el("label", "visually-hidden", label);
  labelNode.htmlFor = id;
  const input = el("input", "input");
  input.id = id;
  input.type = "search";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${id}-list`);
  const list = el("div", "picker-list");
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  root.append(labelNode, input, list);

  let timer = null;
  let request = 0;
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };
  const choose = (title) => {
    close();
    input.value = "";
    onPick(title);
  };
  const highlight = () => {
    [...list.children].forEach((child, i) => child.classList.toggle("is-active", i === active));
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) return close();
    timer = setTimeout(async () => {
      const id = ++request;
      const result = await api(`/api/titles?${new URLSearchParams({ q: query, limit: "8", sort: "popular" })}`);
      if (id !== request) return;
      items = result.ok ? result.data.titles : [];
      list.replaceChildren(...(items.length ? items.map((title) => {
        const option = el("button");
        option.type = "button";
        option.setAttribute("role", "option");
        const text = el("span");
        text.append(el("strong", null, title.title), el("small", null, `${TYPE_LABELS[title.type]} · ${title.year} · ${title.genres.slice(0, 2).join(", ")}`));
        option.append(thumb(title, "picker-thumb"), text);
        option.addEventListener("click", () => choose(title));
        return option;
      }) : [el("p", "muted small", "Ничего не найдено.")]));
      list.querySelectorAll("p").forEach((node) => node.classList.add("picker-empty"));
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
    }, 200);
  });
  input.addEventListener("keydown", (event) => {
    if (list.hidden || !items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      highlight();
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      close();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !root.contains(event.target)) close();
  });
  return { root, input, clear: () => { input.value = ""; close(); } };
}

// ==================== ДИАЛОГИ ====================

/**
 * Модальное окно с формой. build(form) добавляет поля, onSubmit(form) возвращает текст ошибки или null.
 * Возвращает промис: true — отправлено, false — закрыто
 */
export function openDialog({ title, build, submitText = "Сохранить", onSubmit }) {
  return new Promise((resolve) => {
    const dialog = el("dialog", "modal");
    const form = el("form", "modal-body");
    form.noValidate = true;
    const head = el("div", "modal-head");
    const heading = el("h2", null, title);
    heading.id = `dialog${Date.now()}`;
    dialog.setAttribute("aria-labelledby", heading.id);
    head.append(heading, button("✕", "modal-close", () => dialog.close("cancel"), { label: "Закрыть" }));
    form.append(head);
    build(form);
    const message = el("p", "form-error");
    message.setAttribute("role", "alert");
    const actions = el("div", "modal-actions");
    const submit = el("button", "primary-btn", submitText);
    submit.type = "submit";
    actions.append(button("Отмена", "ghost-btn", () => dialog.close("cancel")), submit);
    form.append(message, actions);
    dialog.append(form);
    document.body.append(dialog);

    let done = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const problem = await onSubmit(form);
      submit.disabled = false;
      if (problem) {
        message.textContent = problem;
        return;
      }
      done = true;
      dialog.close("done");
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(done);
    });
    dialog.showModal();
    form.querySelector("input, textarea, select")?.focus();
  });
}

/** Поле формы с подписью */
export function field(labelText, control, hint = "") {
  const row = el("div", "form-row");
  const id = control.id || `f${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const label = el("label", null, labelText);
  label.htmlFor = id;
  row.append(label, control);
  if (hint) row.append(el("small", "muted small", hint));
  return row;
}

export function input(name, { type = "text", value = "", maxLength = 200, placeholder = "", required = false } = {}) {
  const node = el("input", "input");
  node.name = name;
  node.type = type;
  node.value = value;
  if (maxLength) node.maxLength = maxLength;
  node.placeholder = placeholder;
  node.required = required;
  return node;
}

export function textarea(name, { value = "", maxLength = 3000, placeholder = "", rows = 4 } = {}) {
  const node = el("textarea", "textarea");
  node.name = name;
  node.value = value;
  node.maxLength = maxLength;
  node.placeholder = placeholder;
  node.rows = rows;
  return node;
}

export function checkbox(name, labelText, checked = false) {
  const label = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.name = name;
  box.checked = checked;
  label.append(box, document.createTextNode(labelText));
  return label;
}

/** Значение поля формы по имени */
export function formValue(form, name) {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement && control.type === "checkbox") return control.checked;
  return control && "value" in control ? control.value : "";
}

// ==================== ЖАЛОБЫ ====================

const REPORT_REASONS = {
  spam: "Спам или реклама",
  abuse: "Оскорбления или травля",
  spoiler: "Спойлер без пометки",
  illegal: "Нарушает закон или авторские права",
  other: "Другое"
};

/** Пожаловаться на комментарий, отзыв, обсуждение, подборку, профиль или турнир */
export async function reportContent(targetType, targetId) {
  const { user } = await getMe();
  if (!user) return askLogin("Чтобы пожаловаться, войдите в профиль.");
  const sent = await openDialog({
    title: "Пожаловаться",
    submitText: "Отправить жалобу",
    build(form) {
      const select = el("select", "select");
      select.name = "reason";
      for (const [value, text] of Object.entries(REPORT_REASONS)) select.append(new Option(text, value));
      form.append(field("Причина", select), field("Подробности (необязательно)", textarea("details", { maxLength: 1000, rows: 3 })));
    },
    async onSubmit(form) {
      const result = await api("/api/reports", {
        method: "POST",
        body: { targetType, targetId, reason: formValue(form, "reason"), details: formValue(form, "details") }
      });
      return result.ok ? null : result.data?.error || "Не удалось отправить жалобу.";
    }
  });
  if (sent) toast("Жалоба отправлена модераторам. Спасибо!");
}

// ==================== СПОЙЛЕРЫ ====================

/** Текст под спойлером: скрыт, пока по нему не нажали */
export function spoilerText(node, isSpoiler) {
  if (!isSpoiler) return node;
  node.classList.add("spoiler");
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", "Спойлер. Нажмите, чтобы показать");
  const open = () => {
    node.classList.add("is-open");
    node.removeAttribute("role");
    node.removeAttribute("aria-label");
    node.removeAttribute("tabindex");
  };
  node.addEventListener("click", open, { once: true });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  }, { once: true });
  return node;
}
