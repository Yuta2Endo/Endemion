// Навигационные ссылки шапки и подвала: локализованные названия, URL, отсутствие undefined.
import assert from "node:assert/strict";
import { test } from "node:test";
import { t } from "../functions/_lib/i18n.js";
import { siteHeader, siteFooter, navLabel } from "../functions/_lib/layout.js";

const LINK = 'href="https://t.me/EndemionOfficial"';

test("ru nav.telegram = Телеграм", () => {
  assert.equal(t("ru").nav.telegram, "Телеграм");
});

test("en nav.telegram = Telegram", () => {
  assert.equal(t("en").nav.telegram, "Telegram");
});

test("header Telegram link is localized and has no undefined", () => {
  for (const [lang, label] of [["ru", "Телеграм"], ["en", "Telegram"]]) {
    const html = siteHeader(null, t(lang));
    assert.match(html, new RegExp(`${LINK}>${label}</a>`), `${lang} header label`);
    assert.ok(!html.includes("undefined"), `${lang} header has no undefined`);
  }
});

test("footer nav Telegram link is localized and has no undefined", () => {
  for (const [lang, label] of [["ru", "Телеграм"], ["en", "Telegram"]]) {
    const html = siteFooter(t(lang));
    assert.match(html, new RegExp(`${LINK}>${label}</a>`), `${lang} footer label`);
    assert.ok(!html.includes("undefined"), `${lang} footer has no undefined`);
  }
});

test("footer social static Telegram CTA still works", () => {
  for (const [lang, label] of [["ru", "Наш Телеграм"], ["en", "Our Telegram"]]) {
    const html = siteFooter(t(lang));
    assert.match(html, new RegExp(`${LINK}[\\s\\S]*>\\s*${label}</a>`), `${lang} footer social label`);
  }
});

test("navLabel fallback is never undefined/null/empty", () => {
  assert.equal(navLabel({ nav: {} }, "telegram"), "telegram");
  assert.equal(navLabel({ nav: { telegram: "Телеграм" } }, "telegram"), "Телеграм");
});
