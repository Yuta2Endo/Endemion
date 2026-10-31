// Юнит-тесты страниц глав: `npm test`. Проверяют все тайтлы каталога без сервера

import assert from "node:assert/strict";
import { test } from "node:test";
import { pageCount, pageKind, renderPage } from "../functions/_lib/pages.js";

const TITLES = [
  { id: 1, title: "Клинок пепельной луны", type: "manga", chapters: 112, translator: "Ночной свиток", symbol: "☾", poster: "linear-gradient(145deg, #1f2a4d, #5d4a8a 55%, #e3b5c9)" },
  { id: 5, title: "Охотник одиннадцатого уровня", type: "manhwa", chapters: 156, translator: "Вертикаль", symbol: "⚔", poster: "linear-gradient(145deg, #10233f, #2f6fb5 55%, #8be0ff)" },
  { id: 9, title: "Путь небесного меча <&>", type: "manhua", chapters: 178, translator: "Нефритовый «свиток»", symbol: "剑", poster: "нет цветов" }
];

test("манга листается страницами, манхва и маньхуа — лентой", () => {
  assert.equal(pageKind(TITLES[0]), "page");
  assert.equal(pageKind(TITLES[1]), "strip");
  assert.equal(pageKind(TITLES[2]), "strip");
});

test("число страниц в главе стабильно и в пределах", () => {
  for (const title of TITLES) {
    for (let chapter = 1; chapter <= 30; chapter++) {
      const count = pageCount(title, chapter);
      assert.equal(count, pageCount(title, chapter));
      const [min, max] = pageKind(title) === "page" ? [14, 20] : [8, 12];
      assert.ok(count >= min && count <= max, `${title.id}/${chapter}: ${count}`);
    }
  }
});

test("страница одинакова при каждом запросе и отличается от соседней", () => {
  for (const title of TITLES) {
    assert.equal(renderPage(title, 3, 2), renderPage(title, 3, 2));
    assert.notEqual(renderPage(title, 3, 2), renderPage(title, 3, 3));
  }
});

test("SVG без ошибок в числах, скриптов и внешних ссылок, текст экранирован", () => {
  for (const title of TITLES) {
    for (let chapter = 1; chapter <= 8; chapter++) {
      for (let page = 1; page <= pageCount(title, chapter); page++) {
        const svg = renderPage(title, chapter, page);
        assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"));
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${title.id}/${chapter}/${page}`);
        assert.doesNotMatch(svg, /<script|href=|https?:\/\/(?!www\.w3\.org)/i);
      }
    }
  }
  const cover = renderPage(TITLES[2], 1, 1);
  assert.ok(cover.includes("&lt;&amp;&gt;"));
  assert.ok(!cover.includes("<&>"));
});
