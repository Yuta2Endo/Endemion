// Реклама Яндекс.РСЯ (Яндекс.Автоплейсмент). Блок рисуется в слоте, который отметила страница:
// у Яндекса запрашиваются блоки кампании (номер страницы), нужный блок ставится в слот.
// Так место рекламы задаёт сайт, а не алгоритм Яндекса.

// Тот же адрес, что использует штатный загрузчик Яндекса: список блоков кампании
const BLOCKS_API = "https://an.yandex.ru/auto_placement/";
// Контекст Яндекса: в нём живёт менеджер рекламы (Ya.Context.AdvManager)
const CONTEXT_URL = "https://yandex.ru/ads/system/context.js";
// Штатный загрузчик Яндекса: запасной путь, если блок не удалось поставить в слот
const LOADER_URL = "https://yandex.ru/ads/system/ap-loader.js";

// Места блоков в порядке предпочтения: сначала внутри содержимого, потом внизу, потом вверху
const PLACEMENTS = ["afterContentAd", "inArticleAds", "inLayoutAds", "desktopFloorAd", "mobileFloorAd", "topAd"];

let started = false;

/** Реклама уже запускалась: после отказа от cookie страницу нужно открыть заново */
export function adsStarted() {
  return started;
}

/** Слот для рекламы: элемент, который отметила страница */
function slot() {
  return document.querySelector("[data-ads-slot]");
}

/** Убрать место рекламы: пустой блок не должен оставлять дыру в странице */
function hide(target) {
  (target.closest(".ads-block") || target).remove();
}

/**
 * Контекст Яндекса. В нём менеджер рекламы (Ya.Context.AdvManager), который рисует блок.
 * Яндекс вызывает накопленные callbacks, когда контекст готов.
 */
function loadContext() {
  return new Promise((resolve, reject) => {
    const ready = () => resolve();
    const queue = window.yaContextCb;
    if (typeof queue === "function") queue(ready);
    else {
      window.yaContextCb = queue || [];
      window.yaContextCb.push(ready);
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = CONTEXT_URL;
    script.onerror = () => reject(new Error("Контекст Яндекса не загрузился"));
    document.head.append(script);
  });
}

/** Блоки кампании: у Яндекса спрашивается то же, что спрашивает его штатный загрузчик */
async function campaignBlocks(pageId) {
  const response = await fetch(`${BLOCKS_API}?page-id=${encodeURIComponent(pageId)}`);
  if (!response.ok) throw new Error(`Яндекс не отдал блоки кампании: ${response.status}`);
  const data = await response.json();
  return data?.payload || {};
}

/** Блок для нашей страницы: на телефоне нижний блок мобильный, на компьютере — обычный */
function pickUnit(payload) {
  const mobile = window.matchMedia("(max-width: 680px)").matches;
  const order = mobile
    ? ["afterContentAd", "inArticleAds", "inLayoutAds", "mobileFloorAd", "topAd"]
    : PLACEMENTS;
  for (const key of order) {
    const unit = payload?.[key];
    if (unit?.blockId) return unit;
  }
  return null;
}

/** Поставить блок в слот */
function renderUnit(unit, target) {
  const manager = window.Ya?.Context?.AdvManager;
  if (!manager) throw new Error("Нет менеджера рекламы Яндекса");
  if (unit.styles) Object.assign(target.style, unit.styles);
  manager.render(
    {
      blockId: unit.blockId,
      renderTo: target.id,
      pageNumber: target.id,
      isAutoPlacementUnit: true,
      enableAd: true,
      lazyLoad: true
    },
    {
      onError: () => hide(target),
      altCallback: () => hide(target)
    }
  );
}

/** Штатный загрузчик Яндекса: сам расставит блоки по правилам кампании */
function loadAutoplacement(pageId) {
  const script = document.createElement("script");
  script.async = true;
  script.dataset.pageId = pageId;
  script.src = LOADER_URL;
  document.head.append(script);
}

/**
 * Показать рекламу. Вызывается после согласия посетителя на cookie (public/assets/app.js):
 * без согласия Яндекс не должен ни получать данные посетителя, ни ставить свои cookie.
 */
export function loadAds() {
  const target = slot();
  if (!target) return;
  const pageId = target.dataset.adsPageId;
  if (!pageId) return;
  started = true;

  loadContext()
    .then(() => campaignBlocks(pageId))
    .then((payload) => {
      const unit = pickUnit(payload);
      if (!unit) throw new Error("У кампании нет подходящих блоков");
      renderUnit(unit, target);
      // Если блок не показался (нет объявлений, загрузка не удалась), место убираем
      setTimeout(() => {
        if (!target.childElementCount) hide(target);
      }, 4000);
    })
    .catch((error) => {
      console.warn("Реклама Яндекса не показана:", error.message);
      hide(target);
      // Запасной путь: штатный загрузчик поставит блоки сам, пусть и не в наш слот
      loadAutoplacement(pageId);
    });
}
