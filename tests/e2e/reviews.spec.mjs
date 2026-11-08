// Сквозные сценарии отзывов, оценок, спойлеров, избранного и локализации.
// Требует аутентифицированного пользователя (администратор создаётся в global-setup).

import { expect, test } from "@playwright/test";
import { BASE, state } from "./helpers.mjs";

const GAME_SLUG = "endemion-life";

test.beforeEach(async ({ context }) => {
  const [name, value] = state().cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
  await context.addCookies([{ name: "lang", value: "ru", url: BASE }]);
});

test("гость может читать отзывы, но не может отправить отзыв", async ({ browser }) => {
  // Гость: контекст без кук сессии
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  try {
    const resp = await guestPage.request.get(`${BASE}/api/games/${GAME_SLUG}/reviews`);
    expect(resp.ok()).toBe(true);
    const reviews = await resp.json();
    expect(Array.isArray(reviews.reviews)).toBe(true);

    const create = await guestPage.request.post(`${BASE}/api/games/${GAME_SLUG}/reviews/add`, {
      data: { score: 5, body: "Гостевой отзыв" },
      headers: { Origin: BASE }
    });
    expect(create.ok()).toBe(false);
    expect(create.status()).toBe(401);
  } finally {
    await guestContext.close();
  }
});

test("избранное: добавить и убрать игру", async ({ page }) => {
  await page.goto(`/games/${GAME_SLUG}`);

  const favBtn = page.locator(".game-favorite-btn");
  await expect(favBtn).toBeVisible();

  await favBtn.click();
  await expect(favBtn).toHaveAttribute("data-favorited", "1");

  await favBtn.click();
  await expect(favBtn).toHaveAttribute("data-favorited", "0");
});

test("локализация на странице игры", async ({ page }) => {
  await page.goto(`/games/${GAME_SLUG}`);
  await expect(page.locator("h1")).toContainText("Endemion Life");
  await expect(page.locator(".game-review-form .form-label").first()).toContainText("Оценка");
  await expect(page.locator("#reviewSpoiler")).toBeVisible();
});
