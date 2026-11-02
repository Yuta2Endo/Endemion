// Юнит-тесты расчётов без базы: сходство Nexus, сетка и победитель турнира, очистка текста

import assert from "node:assert/strict";
import { test } from "node:test";
import { firstRoundPairs, matchWinner } from "../functions/_lib/arena.js";
import { spamProblem } from "../functions/_lib/limits.js";
import { similarity } from "../functions/_lib/nexus.js";
import { splitAuthors } from "../functions/_lib/taxonomy.js";
import { cleanLine, cleanText } from "../functions/_lib/validate.js";

function features(items, relations = {}, readers = {}) {
  const byId = new Map(items.map((item) => [item.id, {
    title: { id: item.id, type: item.type || "manga" },
    genres: new Set(item.genres || []),
    tags: new Map((item.tags || []).map(([code, category, weight]) => [code, { category, name: code, weight }])),
    authors: new Set(item.authors || [])
  }]));
  return { titles: items, byId, relations: new Map(Object.entries(relations)), readers: new Map(Object.entries(readers)) };
}

test("сходство: без общих признаков связи нет, тип сам по себе не связь", () => {
  const f = features([{ id: 1, genres: ["Экшен"] }, { id: 2, genres: ["Романтика"] }]);
  assert.deepEqual(similarity(f, 1, 2), { score: 0, reasons: [] });
  assert.equal(similarity(f, 1, 1).score, 0);
});

test("сходство: объяснение перечисляет общие жанры, теги и автора", () => {
  const f = features([
    { id: 1, genres: ["Экшен", "Фэнтези"], authors: ["А"], tags: [["mood-dark", "mood", 3], ["hero-growth", "hero", 2]] },
    { id: 2, genres: ["Экшен"], authors: ["А"], tags: [["mood-dark", "mood", 3]] },
    { id: 3, genres: ["Экшен"], tags: [["mood-dark", "mood", 1]] }
  ]);
  const strong = similarity(f, 1, 2);
  const weak = similarity(f, 1, 3);
  assert.deepEqual(strong.reasons.map((reason) => reason.kind), ["author", "genre", "mood"]);
  assert.deepEqual(strong.reasons.find((reason) => reason.kind === "genre").items, ["Экшен"]);
  assert.ok(strong.score > weak.score, "общий автор и главный тег весят больше");
});

test("сходство: связь из админки и общие читатели", () => {
  const f = features([{ id: 1 }, { id: 2 }], { "1:2": "sequel", "2:1": "prequel" }, { "1:2": 3, "2:1": 3 });
  const result = similarity(f, 2, 1);
  assert.deepEqual(result.reasons.map((reason) => reason.label), ["Предыстория", "Читают вместе"]);
  assert.deepEqual(result.reasons[1].items, ["3 читателя"]);
});

test("турнир: посев 1–N и победитель с ничьей в пользу лучшего посева", () => {
  assert.deepEqual(firstRoundPairs(8), [[1, 8], [2, 7], [3, 6], [4, 5]]);
  const base = { entryA: 10, entryB: 20, seedA: 2, seedB: 7 };
  assert.equal(matchWinner({ ...base, votesA: 1, votesB: 3 }), 20);
  assert.equal(matchWinner({ ...base, votesA: 2, votesB: 2 }), 10);
  assert.equal(matchWinner({ ...base, seedA: 9, votesA: 0, votesB: 0 }), 20);
});

test("очистка текста: управляющие и невидимые символы, переносы строк", () => {
  const invisible = String.fromCharCode(0x202e) + String.fromCharCode(0x200b);
  assert.equal(cleanText(`  привет${invisible}\r\n\n\n\nмир\u0007  `), "привет\n\nмир");
  assert.equal(cleanLine(" a\n\tb  c "), "a b c");
  assert.equal(spamProblem("a".repeat(30)), "Слишком много повторяющихся символов.");
  assert.equal(spamProblem("обычный текст https://one.example"), null);
});

test("авторы через запятую или точку с запятой без повторов", () => {
  assert.deepEqual(splitAuthors("Чхугон, DUBU; Чхугон ,"), ["Чхугон", "DUBU"]);
});
