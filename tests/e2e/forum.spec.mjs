// Сквозные сценарии форума и админки: создать тему, ответить, пожаловаться, опубликовать игру.
// Администратора создаёт global-setup, проверяется в одном браузере

import { expect, test } from "@playwright/test";
import { adminFor, apiClient, BASE, clientIpFor, uniqueSuffix } from "./helpers.mjs";

test.beforeEach(async ({ context }, testInfo) => {
  const [name, value] = adminFor(testInfo.project.name).cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
});

test("тема, ответ и жалоба", async ({ page }) => {
  const stamp = uniqueSuffix();
  const subject = `E2E тема ${stamp}`;
  const replyText = `Ответ из браузерного теста ${stamp}.`;
  await page.goto("/community/c/general");
  await page.getByRole("button", { name: "Новая тема" }).click();
  const dialog = page.locator("dialog");
  await dialog.locator("[name=subject]").fill(subject);
  await dialog.locator("[name=body]").fill("Текст темы из браузерного теста.");
  await dialog.getByRole("button", { name: "Опубликовать" }).click();
  await page.waitForURL(/\/community\/thread\/\d+$/);
  await expect(page.locator("h1")).toHaveText(subject);

  const reply = page.locator("#comments .comment-form").first();
  await reply.locator("textarea").fill(replyText);
  await reply.getByRole("button", { name: "Отправить" }).click();
  await expect(page.locator("#comments")).toContainText(replyText);

  // На свою тему пожаловаться нельзя: жалобу отправляет второй участник
  const reader = apiClient("", clientIpFor(test.info().project.name));
  await reader.call("POST", "/api/auth/register", { name: "Жалобщик", email: `e2e-report-${stamp}@example.com`, password: "report-password-1", consent: true });
  const threadId = page.url().split("/").pop();
  const report = await reader.call("POST", "/api/reports", { targetType: "thread", targetId: Number(threadId), reason: "spam", details: "" });
  expect(report.ok).toBe(true);
});

test("админ публикует игру, она появляется в каталоге", async ({ page }) => {
  const stamp = uniqueSuffix();
  const title = `E2E игра ${stamp}`;
  const slug = `e2e-${stamp}`;
  await page.goto("/admin#games");
  // Ждём завершения loadGames(), чтобы форма не была перезаписана после открытия
  await page.locator("#gamesContent .admin-plain-list").waitFor({ state: "visible" });
  await page.locator("#newGameButton").click();
  const form = page.locator(".admin-studio-form");
  await form.waitFor({ state: "visible" });
  await form.locator("[name=title]").fill(title);
  await form.locator("[name=slug]").fill(slug);
  await form.locator("[name=published]").check();
  await form.getByRole("button", { name: "Создать игру" }).click();
  await expect(page.locator(".admin-subheading")).toContainText(title);

  await page.goto(`/games/${slug}`);
  await expect(page.locator("h1")).toContainText(title);

  const admin = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const id = (await admin.call("GET", "/api/admin/games")).games.find((game) => game.slug === slug)?.id;
  expect(id).toBeTruthy();
  await admin.call("DELETE", `/api/admin/games/${id}`);
});
