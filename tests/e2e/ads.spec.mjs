// Реклама Яндекс.РСЯ в сообществе: блок показывается только после согласия на cookie.
// Нужен сервер с YANDEX_ADS_PAGE_ID (любой номер из цифр). Запросы к Яндексу в тестах не уходят в интернет: отвечают заглушки

import { expect, test } from "@playwright/test";
import { apiClient, clientIpFor } from "./helpers.mjs";

// Service worker мешает перехвату запросов в WebKit: он пропускает запросы к Яндексу через себя,
// и заглушки перестают отвечать. Для этого теста service worker не нужен
test.use({ serviceWorkers: "block" });

// Заглушка контекста Яндекса: вместо настоящего скрипта ставит «рекламу» в слот страницы
const CONTEXT_STUB = `
  window.yaContextCb = window.yaContextCb || [];
  window.Ya = { Context: { AdvManager: {
    render(params) {
      const target = document.getElementById(params.renderTo);
      if (!target) return;
      const frame = document.createElement("iframe");
      frame.title = "Реклама";
      frame.width = "300";
      frame.height = "250";
      target.append(frame);
    }
  } } };
  for (const callback of window.yaContextCb) callback();
`;

// Ответ Яндекса со списком блоков кампании
const BLOCKS_STUB = JSON.stringify({ payload: { afterContentAd: { blockId: "R-I-1-2" } } });

test.beforeEach(async ({ page }, testInfo) => {
  const config = await apiClient("", clientIpFor(testInfo.project.name)).call("GET", "/api/config");
  test.skip(!config.yandexAdsPageId, "нужен YANDEX_ADS_PAGE_ID на сервере");
  await page.route("https://an.yandex.ru/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: BLOCKS_STUB }));
  await page.route("https://yandex.ru/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: CONTEXT_STUB }));
});

const yandexRequested = (page) => page.evaluate(() => [...document.scripts].some((script) => script.src.includes("yandex.ru")));

test("без согласия реклама не загружается", async ({ page }) => {
  await page.goto("/community");
  await expect(page.locator(".consent-banner")).toBeVisible();
  expect(await yandexRequested(page)).toBe(false);
});

test("после согласия блок появляется в сообществе", async ({ page }) => {
  await page.goto("/community");
  await page.getByRole("button", { name: "Разрешить" }).click();
  await expect(page.locator(".ads-slot iframe")).toHaveCount(1);

  // Выбор сохраняется: после перезагрузки реклама показывается без нового вопроса
  await page.reload();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  await expect(page.locator(".ads-slot iframe")).toHaveCount(1);
});
