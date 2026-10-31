// Установка сайта как приложения: манифест, значки, service worker и страница «Нет связи» без интернета

import { expect, test } from "@playwright/test";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "проверяется в одном браузере");
});

test("манифест и значки", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href)).json();
  expect(manifest.short_name).toBe("Endemion");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);
});

test("без интернета — страница «Нет связи»", async ({ page, context }) => {
  await page.goto("/");
  // Ждём, пока service worker установится и возьмёт страницу под управление
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto("/copyright");
  await expect(page.locator("h1")).toContainText("Связь");
  await expect(page.locator(".eyebrow")).toHaveText("Нет подключения");
  await context.setOffline(false);

  // С сетью снова открывается настоящая страница
  await page.goto("/copyright");
  await expect(page.locator("h1")).toHaveText("Правообладателям");
});
