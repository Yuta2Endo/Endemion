// Разбор поля «Планы» игры в этапы roadmap: статусы, даты, задачи, прогресс только по отмеченным задачам

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoadmap } from "../functions/_lib/roadmap.js";

test("текст без заголовков «## » не считается структурированным roadmap", () => {
  assert.equal(parseRoadmap(""), null);
  assert.equal(parseRoadmap("Просто планы на будущее.\n- пункт"), null);
});

test("этапы: название, статус, дата, описание и задачи", () => {
  const parsed = parseRoadmap([
    "Вступление к планам.",
    "",
    "## Основа игры | completed | ноябрь 2026",
    "Первая играбельная версия.",
    "- [x] Миры",
    "- [x] Характеристики",
    "",
    "## Род и наследование | в работе",
    "- [x] Формат сохранения",
    "- [ ] Жизнь NPC",
    "- [ ] Наследство",
    "",
    "## Дальше | неизвестный статус"
  ].join("\n"));
  assert.equal(parsed.intro, "Вступление к планам.");
  assert.equal(parsed.stages.length, 3);

  const [first, second, third] = parsed.stages;
  assert.deepEqual([first.title, first.status, first.date], ["Основа игры", "completed", "ноябрь 2026"]);
  assert.equal(first.description, "Первая играбельная версия.");
  assert.equal(first.progress, 100);

  assert.equal(second.status, "in_progress");
  assert.equal(second.date, "");
  assert.deepEqual(second.tasks.map((t) => t.done), [true, false, false]);
  assert.equal(second.progress, 33);

  // Неизвестный статус не превращается в выдуманный, у этапа без задач нет процента
  assert.equal(third.status, null);
  assert.equal(third.progress, null);
});

test("кириллическая «х» в отметке задачи тоже считается выполненной", () => {
  const parsed = parseRoadmap("## Этап | planned\n- [х] Готово\n- [ ] Не готово");
  assert.deepEqual(parsed.stages[0].tasks, [{ text: "Готово", done: true }, { text: "Не готово", done: false }]);
  assert.equal(parsed.stages[0].progress, 50);
});
