// Roadmap игры из поля games.roadmap (админка → Игры → «Планы»). Структурированный формат:
//
//   ## Название этапа | статус | дата
//   Описание этапа, одна или несколько строк.
//   - [x] Выполненная задача
//   - [ ] Задача в работе
//
// Статус: planned, in_progress, completed (или «запланировано», «в работе», «завершено»), дата — любой текст.
// Прогресс считается только по отмеченным задачам: процент нельзя задать вручную, его не из чего выдумать.
// Текст без заголовков «## » остаётся обычным текстом (как было до структурированного формата)

export const ROADMAP_STATUSES = ["planned", "in_progress", "completed"];
export const ROADMAP_STATUS_LABELS = { planned: "Запланировано", in_progress: "В работе", completed: "Завершено" };

const STATUS_ALIASES = {
  planned: "planned", "запланировано": "planned", "запланирован": "planned", "план": "planned",
  in_progress: "in_progress", "in progress": "in_progress", "в работе": "in_progress", "в процессе": "in_progress",
  completed: "completed", done: "completed", "завершено": "completed", "завершён": "completed", "готово": "completed"
};

const TASK = /^\s*[-*]\s+\[( |x|х)\]\s+(.+)$/i;

/**
 * @param {string} text
 * @returns {{ intro: string, stages: Array<{ title: string, status: string | null, date: string, description: string,
 *   tasks: Array<{ text: string, done: boolean }>, progress: number | null }> } | null} null — текст без этапов
 */
export function parseRoadmap(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => line.startsWith("## "))) return null;
  const intro = [];
  const stages = [];
  let stage = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const [title = "", status = "", date = ""] = line.slice(3).split("|").map((part) => part.trim());
      stage = { title, status: STATUS_ALIASES[status.toLowerCase()] || null, date, description: "", tasks: [], progress: null };
      stages.push(stage);
      continue;
    }
    const task = TASK.exec(line);
    if (stage && task) {
      stage.tasks.push({ text: task[2].trim(), done: task[1] !== " " });
    } else if (stage) {
      stage.description += `${line}\n`;
    } else {
      intro.push(line);
    }
  }
  for (const s of stages) {
    s.description = s.description.trim();
    if (s.tasks.length) s.progress = Math.round((s.tasks.filter((t) => t.done).length / s.tasks.length) * 100);
  }
  return { intro: intro.join("\n").trim(), stages: stages.filter((s) => s.title) };
}
