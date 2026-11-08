// Восстановление пароля в браузере. Нужен локальный сервер с MAIL_DEV_MODE=1 в .dev.vars: письмо не отправляется,
// а ссылка из него показывается на странице

import { expect, test } from "@playwright/test";
import { apiClient } from "./helpers.mjs";

test("новый пароль по ссылке из письма", async ({ page }) => {
  const config = await apiClient().call("GET", "/api/config");
  test.skip(!config.passwordReset, "нужен MAIL_DEV_MODE=1 в .dev.vars");

  const email = `reset-${Date.now()}@example.com`;
  await apiClient().call("POST", "/api/auth/register", { name: "Сброс", email, password: "old-password-1", consent: true });

  await page.goto("/auth");
  await page.locator("#forgotLink").click();
  await expect(page).toHaveURL(/\/reset$/);
  await page.locator("#forgotEmail").fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.locator("#resetMessage")).toContainText("Если аккаунт с такой почтой есть");

  await page.locator("#devLink").click();
  // Токен убран из адреса, форма нового пароля на месте
  await expect(page).toHaveURL(/\/reset$/);
  await page.locator("#newPassword").fill("new-password-1");
  await page.locator("#confirmPassword").fill("new-password-2");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(page.locator("#resetMessage")).toHaveText("Пароли не совпадают.");
  await page.locator("#confirmPassword").fill("new-password-1");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await page.waitForURL(/\/profile$/);
  await expect(page.locator("#profileEmail")).toHaveText(email);

  // Старый пароль больше не подходит, новый подходит. В конце тестовый пользователь удаляется
  const client = apiClient();
  await expect(client.call("POST", "/api/auth/login", { email, password: "old-password-1" })).rejects.toThrow(/401/);
  await client.call("POST", "/api/auth/login", { email, password: "new-password-1" });
  await client.call("DELETE", "/api/me", { password: "new-password-1" });
});
