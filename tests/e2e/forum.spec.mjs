// Сквозные сценарии форума и админки: создать тему, ответить, пожаловаться, опубликовать игру.
// Администратора создаёт global-setup, проверяется в одном браузере

import { expect, test } from "@playwright/test";
import { apiClient, BASE, state } from "./helpers.mjs";

const stamp = `${Date.now()}`;

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "проверяется в одном браузере");
  const [name, value] = state().cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
});

test("тема, ответ и жалоба", async ({ page }) => {
  const subject = `E2E тема ${stamp}`;
  await page.goto("/community/c/general");
  await page.getByRole("button", { name: "Новая тема" }).click();
  const dialog = page.locator("dialog");
  await dialog.locator("[name=subject]").fill(subject);
  await dialog.locator("[name=body]").fill("Текст темы из браузерного теста.");
  await dialog.getByRole("button", { name: "Опубликовать" }).click();
  await page.waitForURL(/\/community\/thread\/\d+$/);
  await expect(page.locator("h1")).toHaveText(subject);

  const reply = page.locator("#comments .comment-form").first();
  await reply.locator("textarea").fill("Ответ из браузерного теста.");
  await reply.getByRole("button", { name: "Отправить" }).click();
  await expect(page.locator("#comments")).toContainText("Ответ из браузерного теста.");

  // На свою тему пожаловаться нельзя: жалобу отправляет второй участник
  const reader = apiClient();
  await reader.call("POST", "/api/auth/register", { name: "Жалобщик", email: `e2e-report-${stamp}@example.com`, password: "report-password-1", consent: true });
  const threadId = page.url().split("/").pop();
  const report = await reader.call("POST", "/api/reports", { targetType: "thread", targetId: Number(threadId), reason: "spam", details: "" });
  expect(report.ok).toBe(true);
});

test("админ публикует игру, она появляется в каталоге", async ({ page }) => {
  const title = `E2E игра ${stamp}`;
  const slug = `e2e-${stamp}`;
  await page.goto("/admin#games");
  await page.locator("#newGameButton").click();
  const form = page.locator(".admin-studio-form");
  await form.locator("[name=title]").fill(title);
  await form.locator("[name=slug]").fill(slug);
  await form.locator("[name=published]").check();
  await form.getByRole("button", { name: "Создать игру" }).click();
  await expect(page.locator(".admin-subheading")).toContainText(title);

  await page.goto(`/games/${slug}`);
  await expect(page.locator("h1")).toContainText(title);

  const id = (await apiClient(state().cookie).call("GET", "/api/admin/games")).games.find((game) => game.slug === slug)?.id;
  expect(id).toBeTruthy();
  await apiClient(state().cookie).call("DELETE", `/api/admin/games/${id}`);
});
