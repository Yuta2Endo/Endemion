// Браузерные тесты читалки: `npm run test:e2e`. Нужен локальный сервер (`npm run dev`), иначе Playwright запустит его сам.
// Браузеры для тестов ставятся один раз: `npx playwright install chromium firefox webkit`

import { defineConfig, devices } from "@playwright/test";
import { BASE } from "./tests/e2e/helpers.mjs";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  globalSetup: "./tests/e2e/global-setup.mjs",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  fullyParallel: true,
  // Локальный wrangler dev медленнее сайта: много параллельных браузеров дают ложные тайм-ауты
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    // Без анимаций и плавной прокрутки: проверки не зависят от того, успела ли доиграть анимация
    reducedMotion: "reduce",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } }
  ],
  webServer: {
    command: "npx wrangler dev --port 8787 --ip 127.0.0.1",
    url: `${BASE}/sitemap.xml`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
