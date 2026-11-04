// Service worker: сайт можно установить как приложение, без интернета показывается страница «Нет связи».
// Всё идёт с сервера в первую очередь: кеш нужен только на случай, когда сети нет. Так после обновления сайта
// новая страница никогда не получит старый скрипт. Личные данные (API, профиль, админка) не кешируются вовсе

const VERSION = "v5";
const CACHE = `endemion-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/assets/base.css", "/assets/account.css", "/assets/ui.css", "/favicon.svg", "/icons/icon-192.png"];

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

/**
 * Оформление сайта: с сервера, а без сети — сохранённая копия.
 * cache: "no-cache" — браузер сверяется с сервером, даже если файл лежит в его кеше как immutable
 * (так отдавались /assets/*.js и *.css с 4 ноября 2026 до перехода на no-cache)
 */
async function networkFirst(event) {
  try {
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

  // Страницы не кешируются: без сети вместо них страница «Нет связи»
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/favicon.svg") {
    event.respondWith(networkFirst(event));
  }
  // Остальное (API, страницы глав, обложки) идёт мимо service worker, как без него
});
