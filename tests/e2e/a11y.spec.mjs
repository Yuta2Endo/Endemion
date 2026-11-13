// Доступность: axe-core на основных страницах. Проверяем только серьёзные нарушения WCAG 2.1 AA —
// мелкие замечания (например, порядок заголовков) не должны останавливать выкладку.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/games", "/community", "/studio", "/about", "/terms", "/privacy", "/copyright"];

test.describe("доступность страниц", () => {
  for (const path of PAGES) {
    test(`${path} — без серьёзных нарушений WCAG 2.1 AA`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = result.violations.filter((rule) => rule.impact === "serious" || rule.impact === "critical");
      const report = serious.map((rule) => `${rule.id} (${rule.help}): ${rule.nodes.length} элемент(ов)`).join("\n");
      expect(report, report).toBe("");
    });
  }
});
