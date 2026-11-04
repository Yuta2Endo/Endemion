// Юнит-тесты без базы: очистка текста, защита от спама, разбор номеров из адреса

import assert from "node:assert/strict";
import { test } from "node:test";
import { spamProblem } from "../functions/_lib/limits.js";
import { cleanLine, cleanText, parseId } from "../functions/_lib/validate.js";

test("очистка текста: управляющие и невидимые символы, переносы строк", () => {
  const invisible = String.fromCharCode(0x202e) + String.fromCharCode(0x200b);
  assert.equal(cleanText(`  привет${invisible}\r\n\n\n\nмир\u0007  `), "привет\n\nмир");
  assert.equal(cleanLine(" a\n\tb  c "), "a b c");
  assert.equal(spamProblem("a".repeat(30)), "Слишком много повторяющихся символов.");
  assert.equal(spamProblem("обычный текст https://one.example"), null);
});

test("номер из адреса: только положительное целое", () => {
  assert.equal(parseId("5"), 5);
  assert.equal(parseId(7), 7);
  for (const bad of ["0", "-1", "1.5", "abc", "", null, undefined, "1e3x"]) assert.equal(parseId(bad), null, String(bad));
});
