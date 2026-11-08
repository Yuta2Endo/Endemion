// Согласие на cookie Яндекс Метрики. Нужен сервер с YANDEX_METRIKA_ID (любой номер из цифр).
// Запросы к mc.yandex.ru в тестах не уходят в интернет: отвечает заглушка

import { expect, test } from "@playwright/test";
import { apiClient, BASE, state } from "./helpers.mjs";

test.beforeEach(async ({ page }) => {
  const config = await apiClient().call("GET", "/api/config");
  test.skip(!config.yandexMetrikaId, "нужен YANDEX_METRIKA_ID на сервере");
  await page.route("https://mc.yandex.ru/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
});

const metrikaRequested = (page) => page.evaluate(() => [...document.scripts].some((script) => script.src.includes("mc.yandex.ru")));

test("без согласия Метрика не загружается", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".consent-banner")).toBeVisible();
  expect(await metrikaRequested(page)).toBe(false);

  await page.getByRole("button", { name: "Отказаться" }).click();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  expect(await metrikaRequested(page)).toBe(false);
});

test("после согласия Метрика загружается, выбор можно изменить", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Разрешить" }).click();
  await expect.poll(() => metrikaRequested(page)).toBe(true);
  await page.reload();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  await expect.poll(() => metrikaRequested(page)).toBe(true);

  // «Настройки cookie» в подвале снова показывают вопрос, отказ отключает Метрику
  await page.locator("[data-cookie-settings]").first().click();
  await expect(page.locator(".consent-banner")).toBeVisible();
  await page.getByRole("button", { name: "Отказаться" }).click();
  await page.waitForLoadState("load");
  await expect.poll(() => metrikaRequested(page)).toBe(false);
});

test("в админке и на странице нового пароля Метрики нет", async ({ page, context }) => {
  // Вход администратором: без него /admin перенаправляет на страницу входа
  const [name, value] = state().cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
  await page.goto("/");
  await page.getByRole("button", { name: "Разрешить" }).click();
  for (const path of ["/reset", "/admin"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, path).toBe(path);
    expect(await metrikaRequested(page), path).toBe(false);
    await expect(page.locator(".consent-banner")).toHaveCount(0);
  }
});
