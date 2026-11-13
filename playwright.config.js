// Браузерные тесты читалки: `npm run test:e2e`. Нужен локальный сервер (`npm run dev`), иначе Playwright запустит его сам.
// Браузеры для тестов ставятся один раз: `npx playwright install chromium firefox webkit`

import { defineConfig, devices } from "@playwright/test";
import { BASE, PROJECT_IPS } from "./tests/e2e/helpers.mjs";

// Отдельный CF-Connecting-IP на проект: лимиты входа не мешают параллельным браузерам.
// В продакшене этот заголовок задаёт Cloudflare, подменить его снаружи нельзя.
const project = (name, device) => ({
  name,
  use: { ...device, extraHTTPHeaders: { "CF-Connecting-IP": PROJECT_IPS[name] } }
});

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  globalSetup: "./tests/e2e/global-setup.mjs",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  fullyParallel: true,
  // Локальный wrangler dev медленнее сайта: много параллельных браузеров дают ложные тайм-ауты
  workers: 4,
  // Один повтор на флейки: Firefox-драйвер иногда падает на закрытии контекста
  // (Browser.removeBrowserContext: _maybeDontRestoreTabs), сам тест при этом проходит.
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    // Без анимаций и плавной прокрутки: проверки не зависят от того, успела ли доиграть анимация
    reducedMotion: "reduce",
    trace: "retain-on-failure"
  },
  projects: [
    project("chromium", devices["Desktop Chrome"]),
    project("firefox", devices["Desktop Firefox"]),
    project("webkit", devices["Desktop Safari"]),
    project("android", devices["Pixel 7"]),
    project("iphone", devices["iPhone 14"])
  ],
  webServer: {
    command: "npx wrangler dev --port 8787 --ip 127.0.0.1",
    url: `${BASE}/sitemap.xml`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
