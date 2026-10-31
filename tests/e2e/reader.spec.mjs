// Читалка в настоящих браузерах: листание, клавиши, свайпы, настройки, позиция и экран конца главы

import { expect, test } from "@playwright/test";
import { BASE, state } from "./helpers.mjs";

const counter = (page) => page.locator("#pageCounter");
const total = async (page) => Number(await page.locator("#reader").getAttribute("data-pages"));

/** Нажать по экрану на долю ширины: 0.1 — левый край, 0.9 — правый. По высоте — середина, мимо панелей */
async function tapAt(page, share) {
  const { width, height } = page.viewportSize();
  await page.mouse.click(Math.round(width * share), Math.round(height / 2));
}

async function openSettings(page) {
  await page.locator("#settingsButton").click();
  await expect(page.locator("#readerSettings")).toBeVisible();
}

async function choose(page, label) {
  await page.locator("#readerSettings").getByText(label, { exact: true }).click();
}

test.describe("манга: режим «Страницы», справа налево", () => {
  test("клик по краям и стрелки листают в обратную сторону", async ({ page }) => {
    await page.goto(`/read/${state().manga}/1`);
    const n = await total(page);
    await expect(counter(page)).toHaveText(`1 / ${n}`);

    // В манге следующая страница — по левому краю и стрелкой влево
    await tapAt(page, 0.1);
    await expect(counter(page)).toHaveText(`2 / ${n}`);
    await expect(page).toHaveURL(/#2$/);
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText(`3 / ${n}`);
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText(`2 / ${n}`);
    await tapAt(page, 0.9);
    await expect(counter(page)).toHaveText(`1 / ${n}`);

    // Видна только текущая страница
    await expect(page.locator(".reader-page.is-current")).toHaveCount(1);
    await expect(page.locator('.reader-page[data-page="2"]')).toBeHidden();
  });

  test("страница из адреса и возврат туда, где остановился", async ({ page }) => {
    const url = `/read/${state().manga}/1`;
    await page.goto(`${url}#3`);
    const n = await total(page);
    await expect(counter(page)).toHaveText(`3 / ${n}`);
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText(`4 / ${n}`);

    await page.goto("about:blank");
    await page.goto(url);
    await expect(counter(page)).toHaveText(`4 / ${n}`);
    await expect(page.locator('.reader-page[data-page="4"]')).toBeVisible();
  });

  test("конец главы, переход к следующей и сброс позиции", async ({ page }) => {
    const url = `/read/${state().manga}/1`;
    await page.goto(url);
    const n = await total(page);
    // Тот же адрес с другим #якорем браузер не загружает заново: сначала уходим на пустую страницу
    await page.goto("about:blank");
    await page.goto(`${url}#${n}`);
    await expect(counter(page)).toHaveText(`${n} / ${n}`);

    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("Конец главы");
    await expect(page.locator("#readerEnd")).toBeVisible();
    // Гость: прогресс не сохраняется, читалка предлагает войти
    await expect(page.locator("#endStatus")).toContainText("Войдите");

    await page.keyboard.press("ArrowLeft");
    await page.waitForURL(new RegExp(`/read/${state().manga}/2$`));

    // Дочитанная глава при следующем открытии начинается с первой страницы
    await page.goto(url);
    await expect(counter(page)).toHaveText(`1 / ${n}`);
  });

  test("ползунок переходит на выбранную страницу", async ({ page }) => {
    await page.goto(`/read/${state().manga}/1`);
    const n = await total(page);
    await page.locator("#pageSlider").fill("5");
    await expect(counter(page)).toHaveText(`5 / ${n}`);
  });

  test("пробел на кнопке нажимает кнопку, а не листает", async ({ page }) => {
    await page.goto(`/read/${state().manga}/1`);
    const n = await total(page);
    await page.locator("#settingsButton").focus();
    await page.keyboard.press(" ");
    await expect(page.locator("#readerSettings")).toBeVisible();
    await expect(counter(page)).toHaveText(`1 / ${n}`);
  });

  test("масштаб «По ширине»: пробел сначала докручивает высокую страницу", async ({ page }) => {
    // Страница 900×1350 заведомо выше экрана 720 пикселей
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/read/${state().manga}/1`);
    const n = await total(page);
    await openSettings(page);
    await choose(page, "По ширине");
    await page.keyboard.press("Escape");
    await expect(page.locator("#readerSettings")).toBeHidden();
    await page.locator("#readerStage").focus();

    await page.keyboard.press(" ");
    await expect(counter(page)).toHaveText(`1 / ${n}`);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Когда страница прокручена до низа, следующий пробел листает
    for (let i = 0; i < 6 && (await counter(page).textContent()) === `1 / ${n}`; i++) await page.keyboard.press(" ");
    await expect(counter(page)).toHaveText(`2 / ${n}`);
  });

  test("настройки сохраняются, цвет панели браузера совпадает с фоном", async ({ page }) => {
    await page.goto(`/read/${state().manga}/1`);
    const body = page.locator("body");
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#05070f");

    await openSettings(page);
    await choose(page, "Светлый");
    await expect(body).toHaveAttribute("data-background", "light");
    await expect(themeColor).toHaveAttribute("content", "#e7e8ee");
    await choose(page, "Лента");
    await expect(body).toHaveAttribute("data-mode", "strip");
    await expect(page.locator('.reader-page[data-page="3"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#readerSettings")).toBeHidden();

    await page.reload();
    await expect(body).toHaveAttribute("data-background", "light");
    await expect(body).toHaveAttribute("data-mode", "strip");
    await expect(themeColor).toHaveAttribute("content", "#e7e8ee");
  });
});

test.describe("манхва: режим «Лента»", () => {
  test("прокрутка меняет номер текущей страницы", async ({ page }) => {
    await page.goto(`/read/${state().manhwa}/1`);
    const n = await total(page);
    await expect(page.locator("body")).toHaveAttribute("data-mode", "strip");
    await expect(counter(page)).toHaveText(`1 / ${n}`);

    await page.locator('.reader-page[data-page="3"]').evaluate((image) => image.scrollIntoView({ block: "center" }));
    await expect(counter(page)).toHaveText(`3 / ${n}`);
    await expect(page).toHaveURL(/#3$/);

    await page.locator("#readerEnd").evaluate((end) => end.scrollIntoView({ block: "center" }));
    await expect(counter(page)).toHaveText("Конец главы");
  });
});

test.describe("сенсорный экран", () => {
  /** Касание одним или несколькими пальцами: down всех, затем up всех со сдвигом dx */
  async function touch(page, fingers, dx) {
    const stage = page.locator("#readerStage");
    const { width, height } = page.viewportSize();
    const x = width / 2;
    const y = height / 2;
    for (let id = 1; id <= fingers; id++) {
      await stage.dispatchEvent("pointerdown", { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y + id * 10 });
    }
    for (let id = fingers; id >= 1; id--) {
      await stage.dispatchEvent("pointerup", { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x + dx, clientY: y + id * 10 });
    }
  }

  test("свайп листает, два пальца — нет", async ({ page, hasTouch }) => {
    test.skip(!hasTouch, "только для телефонов");
    await page.goto(`/read/${state().manga}/1#2`);
    const n = await total(page);
    await expect(counter(page)).toHaveText(`2 / ${n}`);

    // В манге справа налево свайп вправо — следующая страница
    await touch(page, 1, 120);
    await expect(counter(page)).toHaveText(`3 / ${n}`);
    await touch(page, 1, -120);
    await expect(counter(page)).toHaveText(`2 / ${n}`);

    // Два пальца — это pinch-zoom, страница не меняется
    await touch(page, 2, 120);
    await expect(counter(page)).toHaveText(`2 / ${n}`);
  });
});

test.describe("место в главе на сервере", () => {
  test("на другом устройстве чтение продолжается с той же страницы", async ({ browser }, testInfo) => {
    // Место одно на тайтл и пользователя: в нескольких браузерах сразу тесты мешали бы друг другу
    test.skip(testInfo.project.name !== "chromium", "проверяется в одном браузере");
    const [name, value] = state().cookie.split("=");
    const options = { baseURL: BASE, reducedMotion: "reduce" };

    // Первое «устройство»: дошёл до страницы 4 второй главы
    const phone = await browser.newContext(options);
    await phone.addCookies([{ name, value, url: BASE }]);
    const first = await phone.newPage();
    await first.goto(`/read/${state().manga}/2`);
    const n = await total(first);
    const saved = first.waitForResponse((response) => response.url().includes("/api/positions/") && response.request().method() === "PUT");
    for (let i = 0; i < 3; i++) await first.keyboard.press("ArrowLeft");
    await expect(counter(first)).toHaveText(`4 / ${n}`);
    expect((await saved).ok()).toBe(true);
    await phone.close();

    // Второе «устройство» с пустым localStorage
    const computer = await browser.newContext(options);
    await computer.addCookies([{ name, value, url: BASE }]);
    const second = await computer.newPage();
    await second.goto(`/title/${state().manga}`);
    await expect(second.locator("#readButton")).toHaveText("Продолжить: глава 2, стр. 4");
    await second.goto(`/read/${state().manga}/2`);
    await expect(counter(second)).toHaveText(`4 / ${n}`);
    await expect(second.locator(".toast")).toContainText("Продолжаем со страницы 4");
    await computer.close();
  });
});

test.describe("без JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("глава читается лентой, настройки скрыты", async ({ page }) => {
    await page.goto(`/read/${state().manga}/1`);
    const n = await total(page);
    await expect(page.locator(".reader-page")).toHaveCount(n);
    await expect(page.locator(`.reader-page[data-page="${n}"]`)).toBeVisible();
    await expect(page.locator("#settingsButton")).toBeHidden();
  });
});
