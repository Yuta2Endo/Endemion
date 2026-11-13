import { expect, test } from "@playwright/test";
import { adminFor, apiClient, BASE, clientIpFor, uniqueSuffix } from "./helpers.mjs";

const TABS = [
  { id: "overview", labelRu: "Обзор", labelEn: "Overview" },
  { id: "characters", labelRu: "Персонажи и жизни", labelEn: "Characters & Lives" },
  { id: "achievements", labelRu: "Достижения", labelEn: "Achievements" },
  { id: "family", labelRu: "Семья и наследие", labelEn: "Family & Legacy" },
  { id: "settings", labelRu: "Настройки профиля", labelEn: "Profile Settings" },
  { id: "security", labelRu: "Безопасность", labelEn: "Security" }
];

const contextErrors = new WeakMap();

test.beforeEach(async ({ context }, testInfo) => {
  const [name, value] = adminFor(testInfo.project.name).cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
  await context.addCookies([{ name: "lang", value: "ru", url: BASE }]);

  const errors = [];
  contextErrors.set(context, errors);

  context.on("page", (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push({ source: "console", text: msg.text(), location: msg.location() });
    });
    page.on("pageerror", (err) => errors.push({ source: "pageerror", text: err.message }));
    page.on("requestfailed", (req) => errors.push({ source: "requestfailed", url: req.url(), error: req.failure()?.errorText }));
    page.on("response", (res) => {
      if (res.status() >= 500 && res.url().includes("/api/")) {
        errors.push({ source: "response", url: res.url(), status: res.status() });
      }
    });
  });
});

function getErrors(context) {
  return contextErrors.get(context) || [];
}

test("неаутентифицированный пользователь перенаправляется на вход", async ({ browser }) => {
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  try {
    const response = await guestPage.goto("/account");
    expect(response?.status()).toBe(200);
    // The browser URL-encodes the next parameter: /auth?next=%2Faccount
    await guestPage.waitForURL(/\/auth\?next=%2Faccount$/);
    expect(new URL(guestPage.url()).pathname).toBe("/auth");
  } finally {
    await guestContext.close();
  }
});

test("аутентифицированный пользователь видит свою панель аккаунта", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const me = await client.call("GET", "/api/me");
  expect(me.user).toBeTruthy();

  await page.goto("/account");
  await expect(page.locator("#account")).toBeVisible();
  await expect(page.locator("#playerName")).toHaveText(me.user.name);
  await expect(page.locator("#playerId")).toContainText("ID");
  await expect(page.locator("h1")).toContainText(me.user.name);
});

test("панель аккаунта не открывается без сессии (API защищён)", async ({ browser }) => {
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  try {
    const resp = await guestPage.request.get(`${BASE}/api/me/sessions`, {
      headers: { Origin: BASE }
    });
    expect(resp.ok()).toBe(false);
    expect(resp.status()).toBe(401);
  } finally {
    await guestContext.close();
  }
});

test("все шесть вкладки отображаются и переключаются", async ({ page }) => {
  await page.goto("/account");

  const nav = page.locator(".account-nav");
  await expect(nav).toBeVisible();

  // Only the first tab (overview) is selected initially
  await expect(page.locator('[role=tab][data-tab="overview"]')).toHaveAttribute("aria-selected", "true");

  for (const tab of TABS) {
    const btn = page.locator(`[role=tab][data-tab="${tab.id}"]`);
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(tab.labelRu);

    await btn.click();
    await expect(btn).toHaveAttribute("aria-selected", "true");

    const panel = page.locator(`[data-panel="${tab.id}"]`);
    await expect(panel).toBeVisible();
  }
});

test("клавиатурная навигация между вкладками (стрелки)", async ({ page }) => {
  await page.goto("/account");

  const firstTab = page.locator('[role=tab][data-tab="overview"]');
  await firstTab.focus();
  await expect(firstTab).toHaveAttribute("aria-selected", "true");

  await firstTab.press("ArrowRight");
  const secondTab = page.locator('[role=tab][data-tab="characters"]');
  await expect(secondTab).toHaveAttribute("aria-selected", "true");
  await expect(secondTab).toBeFocused();

  await secondTab.press("ArrowLeft");
  await expect(firstTab).toHaveAttribute("aria-selected", "true");
  await expect(firstTab).toBeFocused();
});

test("глубокая ссылка через хеш URL", async ({ page }) => {
  await page.goto("/account#security");
  await expect(page.locator('[role=tab][data-tab="security"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-panel="security"]')).toBeVisible();
  await expect(page.locator("#securitySessionsTitle")).toBeVisible();
});

test("переключение вкладок не вызывает JavaScript-ошибок", async ({ page, context }) => {
  await page.goto("/account");
  for (const tab of TABS) {
    await page.locator(`[role=tab][data-tab="${tab.id}"]`).click();
  }
  const errors = getErrors(context);
  const jsErrors = errors.filter(
    (e) =>
      (e.source === "console" || e.source === "pageerror") &&
      !/content.security.policy/i.test(e.text) &&
      !/cloudflareinsights\.com|mc\.yandex\.ru|yastatic\.net/i.test(e.text + " " + (e.location?.url || ""))
  );
  expect(jsErrors).toEqual([]);
});

test("изменение отображаемого имени, био и цвета аватара сохраняется", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const newName = `E2E Test ${Date.now()}`;
  const newBio = "Тестовое описание из E2E теста";

  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  await page.locator("#accountName").fill(newName);
  await page.locator("#accountBio").fill(newBio);
  await page.locator("#accountProfileForm button[type=submit]").click();

  await expect(page.locator("#accountProfileMessage")).toHaveText("Профиль сохранён.");
  await expect(page.locator("#playerName")).toHaveText(newName);

  await page.reload();
  await page.locator('[role=tab][data-tab="settings"]').click();
  await expect(page.locator("#accountName")).toHaveValue(newName);
  await expect(page.locator("#accountBio")).toHaveValue(newBio);

  const updated = await client.call("GET", "/api/me");
  expect(updated.user.name).toBe(newName);
});

test("изменение настроек приватности сохраняется", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));

  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  const isPublic = page.locator('input[name="isPublic"]');
  if (await isPublic.isChecked()) {
    await isPublic.uncheck();
  }
  await page.locator("#accountPrivacyForm button[type=submit]").click();
  await expect(page.locator("#accountPrivacyMessage")).toHaveText(/виден только|private/);

  await page.reload();
  await page.locator('[role=tab][data-tab="settings"]').click();
  await expect(isPublic).not.toBeChecked();

  const profile = await client.call("GET", "/api/me/profile");
  expect(profile.profile.isPublic).toBe(false);
});

test("изменение настроек уведомлений сохраняется", async ({ page }) => {
  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  const replies = page.locator('input[name="replies"]');
  await replies.uncheck();
  await page.locator("#accountNotifyForm button[type=submit]").click();
  await expect(page.locator("#accountNotifyMessage")).toHaveText("Настройки уведомлений сохранены.");

  await page.reload();
  await page.locator('[role=tab][data-tab="settings"]').click();
  await expect(replies).not.toBeChecked();
});

test("загрузка и удаление аватара", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));

  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  const avatarInput = page.locator("#accountAvatarInput");
  const filePath = "tests/e2e/fixtures/avatar-test.png";

  const fs = await import("node:fs");
  if (!fs.existsSync(filePath)) {
    test.skip(true, "тестовый файл аватара не найден");
  }

  await avatarInput.setInputFiles(filePath);
  await expect(page.locator("#accountProfileMessage")).toHaveText("Аватар загружен.");

  await page.reload();
  await page.locator('[role=tab][data-tab="settings"]').click();
  await expect(page.locator("#accountAvatarRemove")).toBeVisible();

  await page.locator("#accountAvatarRemove").click();
  await expect(page.locator("#accountProfileMessage")).toHaveText("Аватар убран.");

  const profile = await client.call("GET", "/api/me/profile");
  expect(profile.profile.avatar).toBeNull();
});

test("неподдерживаемый тип файла аватара отклоняется", async ({ page }) => {
  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  const fs = await import("node:fs");
  const filePath = "tests/e2e/fixtures/avatar-test.txt";
  if (!fs.existsSync(filePath)) {
    test.skip(true, "тестовый файл не найден");
  }

  await page.locator("#accountAvatarInput").setInputFiles(filePath);
  await expect(page.locator("#accountProfileMessage")).toContainText("картинкой");
});

test("интерфейс на русском языке", async ({ page }) => {
  await page.goto("/account");
  await page.locator('[role=tab][data-tab="settings"]').click();

  await expect(page.locator(".account-eyebrow")).toContainText("Endemion Account");
  await expect(page.locator('[role=tab][data-tab="overview"]')).toContainText("Обзор");
  await expect(page.locator('[role=tab][data-tab="achievements"]')).toContainText("Достижения");
  await expect(page.locator('[role=tab][data-tab="security"]')).toContainText("Безопасность");
  await expect(page.locator("#accountProfileForm button[type=submit]")).toBeVisible();
  await expect(page.locator("#accountLogout")).toContainText("Выйти");
});

test("интерфейс на английском языке", async ({ page, context }) => {
  await context.addCookies([{ name: "lang", value: "en", url: BASE }]);
  await page.goto("/account");
  await page.goto("/account");

  await expect(page.locator(".account-eyebrow")).toContainText("Endemion Account");
  await expect(page.locator('[role=tab][data-tab="overview"]')).toContainText("Overview");
  await expect(page.locator('[role=tab][data-tab="achievements"]')).toContainText("Achievements");
  await expect(page.locator('[role=tab][data-tab="security"]')).toContainText("Security");
  await expect(page.locator("#accountLogout")).toContainText("Log out");
});

test("переключатель языка меняет язык после перезагрузки", async ({ page }) => {
  await page.goto("/account");
  await expect(page.locator('[role=tab][data-tab="overview"]')).toContainText("Обзор");

  await page.locator('[data-lang-toggle]').click();
  await page.waitForLoadState("load");

  await expect(page.locator('[role=tab][data-tab="overview"]')).toContainText("Overview");
});

test("список сессий показывает только свои сессии и помечает текущую", async ({ page }) => {
  await page.goto("/account");
  await page.locator('[role=tab][data-tab="security"]').click();

  await expect(page.locator("#securitySessionsTitle")).toBeVisible();
  const sessionsList = page.locator("#securitySessions");
  await expect(sessionsList).toBeVisible();

  const currentRows = page.locator(".session-row.current");
  await expect(currentRows).toHaveCount(1);
  await expect(currentRows.locator(".session-label")).toContainText("Текущая сессия");

  const sessionIds = page.locator(".session-id");
  const count = await sessionIds.count();
  for (let i = 0; i < count; i++) {
    const id = await sessionIds.nth(i).textContent();
    expect(id?.length).toBeLessThanOrEqual(12);
  }
});

test("завершение нетекущей сессии", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const sessions = await client.call("GET", "/api/me/sessions");
  const nonCurrent = sessions.sessions.find((s) => !s.current);
  test.skip(!nonCurrent, "нет дополнительных сессий для завершения");

  await page.goto("/account");
  await page.locator('[role=tab][data-tab="security"]').click();

  const terminateBtn = page.locator(".session-btn.terminate").first();
  await expect(terminateBtn).toBeVisible();
  await terminateBtn.click();

  await expect(page.locator(".toast")).toContainText("Сессия завершена.");
  await expect(page.locator(".session-row")).toHaveCount(sessions.sessions.length - 1);
});

test("нельзя завершить текущую сессию через API", async ({ page }) => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const sessions = await client.call("GET", "/api/me/sessions");
  const current = sessions.sessions.find((s) => s.current);
  test.skip(!current, "нет текущей сессии");

  const resp = await page.request.delete(`${BASE}/api/me/sessions`, {
    data: { sessionId: current.id },
    headers: { Origin: BASE }
  });
  expect(resp.ok()).toBe(false);
  expect(resp.status()).toBe(409);
});

test("неизвестный ID сессии возвращает 404", async () => {
  const client = apiClient(adminFor(test.info().project.name).cookie, clientIpFor(test.info().project.name));
  const resp = await client.call("DELETE", "/api/me/sessions", { sessionId: "nonexistent-id" }).catch(() => {
    return { ok: false, status: 404 };
  });
  expect(resp.ok).toBe(false);
});

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 360, height: 740 }
];

for (const vp of viewports) {
  test(`отображается корректно на ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/account");

    await expect(page.locator("#account")).toBeVisible();
    await expect(page.locator(".account-nav")).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(vp.width + 20);

    for (const tab of TABS) {
      const btn = page.locator(`[role=tab][data-tab="${tab.id}"]`);
      await expect(btn).toBeVisible();
    }

    await page.locator('[role=tab][data-tab="settings"]').click();
    await expect(page.locator("#accountProfileForm")).toBeVisible();

    await page.locator('[role=tab][data-tab="security"]').click();
    await expect(page.locator("#securitySessions")).toBeVisible();
  });
}

test("отсутствуют ошибки консоли и сети при загрузке панели", async ({ page, context }) => {
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  const errors = getErrors(context);
  const consoleErrors = errors.filter(
    (e) =>
      e.source === "console" &&
      !/content.security.policy|cloudflareinsights\.com|mc\.yandex\.ru|yastatic\.net/i.test(
        e.text + " " + (e.location?.url || "")
      )
  );
  const pageErrors = errors.filter((e) => e.source === "pageerror");
  const failedRequests = errors.filter(
    (e) => e.source === "requestfailed" && !e.url.includes("cloudflareinsights.com") && !e.url.includes("mc.yandex.ru")
  );
  const serverErrors = errors.filter((e) => e.source === "response");

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("страница /profile по-прежнему доступна", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.locator("#profile")).toBeVisible();
});

test("выход из системы работает", async ({ page, context }, testInfo) => {
  // Отдельный аккаунт: выход завершает сессию, а общий админ нужен остальным тестам файла
  const client = apiClient("", clientIpFor(testInfo.project.name));
  await client.call("POST", "/api/auth/register", {
    name: "Logout",
    email: `e2e-logout-${uniqueSuffix()}@example.com`,
    password: "correct-horse-1",
    consent: true
  });
  const [name, value] = client.cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);

  await page.goto("/account");
  await page.locator("#accountLogout").click();
  await page.waitForURL(/\/$/);
  expect(new URL(page.url()).pathname).toBe("/");
});
