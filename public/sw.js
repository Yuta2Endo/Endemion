// Service worker: сайт можно установить как приложение, без интернета показывается страница «Нет связи».
// Всё идёт с сервера в первую очередь: кеш нужен только на случай, когда сети нет. Так после обновления сайта
// новая страница никогда не получит старый скрипт. Личные данные (API, профиль, админка) не кешируются вовсе

// Версию подставляет обработчик /sw.js из ASSET_VERSION (functions/sw.js) при выкладке.
const VERSION = "dev";
const CACHE = `endemion-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/assets/base.css", "/assets/account.css", "/assets/studio.css", "/assets/account-dashboard.css", "/assets/ui.css", "/favicon.ico?v=2", "/icons/icon-192.png?v=2"];

// Только локальные тесты: браузерные тесты Playwright в Firefox не могут отключить сеть для service worker
// через context.setOffline(). Страница на localhost может попросить service worker сымитировать обрыв сети,
// чтобы проверить страницу «Нет связи». На рабочем домене сообщение игнорируется.
const SIMULATION_HOSTS = new Set(["localhost", "127.0.0.1"]);
const simulationAllowed = SIMULATION_HOSTS.has(self.location.hostname);
let simulateOffline = false;

self.addEventListener("message", (event) => {
  if (!simulationAllowed) return;
  if (event.data === "endemion:simulate-offline") simulateOffline = true;
  else if (event.data === "endemion:simulate-online") simulateOffline = false;
  else return;
  // Подтверждение, чтобы тест дождался смены режима до навигации
  event.source?.postMessage({ type: "endemion:simulation", offline: simulateOffline });
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// Кеши прежних версий удаляются
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("endemion-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** Сеть недоступна: отдаём сохранённую страницу «Нет связи», если она есть. */
async function offlineFallback() {
  return (await caches.match(OFFLINE_URL)) || Response.error();
}

/**
 * Оформление сайта: с сервера, а без сети — сохранённая копия.
 * cache: "no-cache" — браузер сверяется с сервером, даже если файл лежит в его кеше как immutable
 * (так отдавались /assets/*.js и *.css с 4 ноября 2026 до перехода на no-cache)
 */
async function networkFirst(event) {
  try {
    if (simulateOffline) throw new TypeError("Simulated network failure");
    const response = await fetch(new Request(event.request, { cache: "no-cache" }));
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Страницы не кешируются: без сети вместо них страница «Нет связи».
  // Ошибку сети и ответ 5xx считаем недоступностью сайта; 4xx — обычный ответ сервера, его не подменяем.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        if (simulateOffline) throw new TypeError("Simulated network failure");
        const response = await fetch(request);
        if (response.status >= 500) throw new Error("Server unavailable");
        return response;
      } catch (err) {
        return offlineFallback();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
    event.respondWith(networkFirst(event));
  }
  // Остальное (API, страницы глав, обложки) идёт мимо service worker, как без него
});
