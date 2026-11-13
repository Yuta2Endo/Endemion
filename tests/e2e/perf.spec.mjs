// Бюджет производительности: LCP и CLS на главных страницах.
// Меряем в chromium на локальном wrangler dev; в CI раннер медленнее, поэтому допуск шире.
import { test, expect } from "@playwright/test";

// LCP меряется в миллисекундах, CLS — безразмерная величина
const LCP_BUDGET = process.env.CI ? 4000 : 2500;
const CLS_BUDGET = 0.1;

/** Ставит наблюдателей до загрузки страницы и возвращает снятые метрики */
async function measure(page, path) {
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.lcp = Math.max(window.__perf.lcp, entry.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__perf.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path, { waitUntil: "load" });
  // Даём браузеру время на финальный LCP и сдвиги от подгрузки шрифтов
  await page.waitForTimeout(700);
  return page.evaluate(() => window.__perf);
}

test.describe("бюджет производительности", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "метрики снимаем только в chromium");

  for (const path of ["/", "/games", "/community"]) {
    test(`${path}: LCP < ${LCP_BUDGET} мс, CLS < ${CLS_BUDGET}`, async ({ page }) => {
      const metrics = await measure(page, path);
      console.log(`${path}: LCP ${Math.round(metrics.lcp)} мс, CLS ${metrics.cls.toFixed(4)}`);
      expect(metrics.lcp, `LCP на ${path}`).toBeGreaterThan(0);
      expect(metrics.lcp, `LCP на ${path}`).toBeLessThan(LCP_BUDGET);
      expect(metrics.cls, `CLS на ${path}`).toBeLessThan(CLS_BUDGET);
    });
  }
});
