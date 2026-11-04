// Админка в браузере: разделы портала, пользователи с подтверждением паролем и журнал.
// Администратора создаёт global-setup

import { expect, test } from "@playwright/test";
import { apiClient, BASE, state } from "./helpers.mjs";

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "проверяется в одном браузере");
  const [name, value] = state().cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
});

test("разделы портала и журнал", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("#dashboardHeading")).toBeVisible();
  await expect(page.locator("#stats .admin-stat")).toHaveCount(6);
  for (const name of ["Тайтлы", "Каталог", "Вселенные", "Голосования", "Подборки"]) {
    await expect(page.locator(".admin-menu").getByRole("link", { name, exact: true })).toHaveCount(0);
  }

  await page.locator(".admin-menu").getByRole("link", { name: "Игры" }).click();
  await expect(page).toHaveURL(/#games$/);
  await expect(page.locator("#gamesContent")).toContainText("Endemion Life");

  await page.locator(".admin-menu").getByRole("link", { name: "Журнал" }).click();
  await expect(page.locator("#auditList")).toBeVisible();
});

test("пользователи: права через окно с паролем", async ({ page }) => {
  const email = `e2e-member-${Date.now()}@example.com`;
  await apiClient().call("POST", "/api/auth/register", { name: "Участник", email, password: "member-password-1", consent: true });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/admin#users");
  await expect(page.locator("#usersHeading")).toBeVisible();
  // У своего аккаунта нет кнопок действий
  const self = page.locator(".admin-user", { hasText: "Это вы" });
  await expect(self).toHaveCount(1);
  await expect(self.locator("button")).toHaveCount(0);

  await page.locator("#userSearch").fill(email);
  const row = page.locator(".admin-user", { hasText: email });
  await expect(row).toHaveCount(1);
  await expect(page.locator("#userCount")).toHaveText("Найдено: 1");

  // Отмена окна ничего не меняет
  await row.getByRole("button", { name: "Сделать администратором" }).click();
  await expect(page.locator("#passwordDialog")).toBeVisible();
  await page.locator("#passwordDialog").getByRole("button", { name: "Отмена" }).click();
  await expect(page.locator("#passwordDialog")).toBeHidden();
  await expect(row.locator(".admin-tag.is-admin")).toHaveCount(0);

  // Неверный пароль
  await row.getByRole("button", { name: "Сделать администратором" }).click();
  await page.locator("#passwordInput").fill("wrong-password-1");
  await page.locator("#passwordDialog").getByRole("button", { name: "Подтвердить" }).click();
  await expect(page.locator("#usersMessage")).toHaveText("Неверный пароль.");

  await row.getByRole("button", { name: "Сделать администратором" }).click();
  await page.locator("#passwordInput").fill(state().password);
  await page.locator("#passwordDialog").getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.locator(".admin-tag.is-admin")).toHaveText("Администратор");

  await row.getByRole("button", { name: "Снять права администратора" }).click();
  await page.locator("#passwordInput").fill(state().password);
  await page.locator("#passwordDialog").getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.locator(".admin-tag.is-admin")).toHaveCount(0);

  await row.getByRole("button", { name: "Заблокировать" }).click();
  await expect(row.locator(".admin-tag.is-blocked")).toContainText("Заблокирован");
  await row.getByRole("button", { name: "Разблокировать" }).click();
  await expect(row.locator(".admin-tag.is-blocked")).toHaveCount(0);

  await row.getByRole("button", { name: "Удалить аккаунт" }).click();
  await page.locator("#passwordInput").fill(state().password);
  await page.locator("#passwordDialog").getByRole("button", { name: "Подтвердить" }).click();
  await expect(page.locator("#usersMessage")).toHaveText(`Аккаунт ${email} удалён.`);
  await expect(row).toHaveCount(0);

  await page.locator(".admin-menu").getByRole("link", { name: "Журнал" }).click();
  await page.locator("#auditGroup").selectOption("users");
  await expect(page.locator("#auditList")).toContainText("Удаление аккаунта");
  await expect(page.locator("#auditList")).not.toContainText(email);
});
