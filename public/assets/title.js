// Страница тайтла: избранное, статус и прочитанные главы. Сама страница приходит готовой с сервера

import { api, chaptersText, initHeader, loginUrl, STATUS_LABELS, toast } from "./app.js";

const main = document.querySelector("#main");
const titleId = Number(main.dataset.titleId);
const totalChapters = Number(main.dataset.chapters);
const controls = document.querySelector("#libraryControls");
const panel = document.querySelector("#chapterPanel");

// Градиент обложки: в разметке он лежит в data-атрибуте, потому что встроенный style запрещён CSP
const poster = document.querySelector(".title-poster");
poster.style.setProperty("--poster", poster.dataset.poster);

let user = null;
let entry = { favorite: false, status: null, chapter: 0 };
// Место в главе, на котором читатель остановился (на любом устройстве), или null
let position = null;

async function save(changes) {
  if (!user) {
    toast(`Чтобы сохранять тайтлы, <a href="${loginUrl()}">войдите в профиль</a>.`, { html: true, duration: 5000 });
    return false;
  }
  const result = await api(`/api/library/${titleId}`, { method: "PUT", body: changes });
  if (!result.ok) {
    toast(result.data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
    return false;
  }
  entry = result.data.item;
  render();
  return true;
}

function button(text, className, onClick, disabled = false) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}

function renderControls() {
  controls.replaceChildren();

  const favorite = button(entry.favorite ? "♥ В избранном" : "♡ В избранное", "primary-btn", async () => {
    if (await save({ favorite: !entry.favorite })) controls.querySelector(".primary-btn")?.focus();
  });
  favorite.setAttribute("aria-pressed", String(entry.favorite));

  const label = document.createElement("label");
  label.className = "visually-hidden";
  label.htmlFor = "statusSelect";
  label.textContent = "Статус";

  const select = document.createElement("select");
  select.id = "statusSelect";
  select.className = "status-select";
  select.append(new Option("Без статуса", ""));
  for (const [value, text] of Object.entries(STATUS_LABELS)) select.append(new Option(text, value));
  select.value = entry.status || "";
  select.disabled = !user;
  select.addEventListener("change", () => save({ status: select.value || null }));

  controls.append(favorite, label, select);

  if (!user) {
    const hint = document.createElement("p");
    hint.className = "controls-hint";
    const link = document.createElement("a");
    link.href = loginUrl();
    link.textContent = "Войдите";
    hint.append(link, ", чтобы отмечать прочитанные главы и сохранять тайтл.");
    controls.append(hint);
  }
}

/**
 * Прогресс чтения: полоска, кнопки «+1 глава» и «Прочитано всё», поле для номера главы.
 * Сетка из сотни кнопок неудобна, поэтому номер можно ввести сразу
 */
function renderPanel() {
  panel.replaceChildren();
  const read = entry.chapter;

  const summary = document.createElement("div");
  summary.className = "chapter-summary";
  const title = document.createElement("strong");
  title.textContent = read === 0 ? "Ещё не начато" : read >= totalChapters ? "Все главы прочитаны" : `Прочитано ${read} из ${totalChapters}`;
  const next = document.createElement("span");
  next.textContent = read < totalChapters ? `Следующая: глава ${read + 1}` : chaptersText(totalChapters);
  summary.append(title, next);

  const progress = document.createElement("div");
  progress.className = "progress-line chapter-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", String(totalChapters));
  progress.setAttribute("aria-valuenow", String(read));
  progress.setAttribute("aria-label", "Прочитано глав");
  const bar = document.createElement("span");
  bar.style.width = `${Math.round((read / totalChapters) * 100)}%`;
  progress.append(bar);

  const actions = document.createElement("div");
  actions.className = "chapter-actions";
  actions.append(
    button("+1 глава", "primary-btn", () => save({ chapter: read + 1 }), read >= totalChapters),
    button("Прочитано всё", "ghost-btn", () => save({ chapter: totalChapters }), read >= totalChapters),
    button("Сбросить", "ghost-btn", () => save({ chapter: 0 }), read === 0)
  );

  const form = document.createElement("form");
  form.className = "chapter-form";
  const label = document.createElement("label");
  label.htmlFor = "chapterInput";
  label.textContent = "Остановился на главе";
  const input = document.createElement("input");
  input.id = "chapterInput";
  input.type = "number";
  input.min = "0";
  input.max = String(totalChapters);
  input.value = String(read);
  input.inputMode = "numeric";
  const submit = button("Сохранить", "ghost-btn", () => {});
  submit.type = "submit";
  form.append(label, input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > totalChapters) {
      toast(`Введите номер главы от 0 до ${totalChapters}.`);
      return;
    }
    if (await save({ chapter: value })) document.querySelector("#chapterInput")?.focus();
  });

  if (!user) {
    actions.querySelectorAll("button").forEach((node) => (node.disabled = true));
    input.disabled = true;
    submit.disabled = true;
  }

  panel.append(summary, progress, actions, form);
}

/** Кнопка «Читать» ведёт на следующую непрочитанную главу, прочитанные главы в списке приглушены */
function renderReading() {
  const read = entry.chapter;
  const readButton = document.querySelector("#readButton");
  if (position && position.chapter > read && position.chapter <= totalChapters) {
    // Глава начата, но не дочитана: продолжаем с той страницы, где остановился
    const hash = position.page > 1 ? `#${position.page}` : "";
    readButton.textContent = position.page > 1
      ? `Продолжить: глава ${position.chapter}, стр. ${position.page}`
      : `Продолжить: глава ${position.chapter}`;
    readButton.href = `/read/${titleId}/${position.chapter}${hash}`;
  } else if (read === 0) {
    readButton.textContent = "Читать с 1 главы";
    readButton.href = `/read/${titleId}/1`;
  } else if (read < totalChapters) {
    readButton.textContent = `Продолжить: глава ${read + 1}`;
    readButton.href = `/read/${titleId}/${read + 1}`;
  } else {
    readButton.textContent = "Перечитать с 1 главы";
    readButton.href = `/read/${titleId}/1`;
  }

  for (const link of document.querySelectorAll("#chapterList a")) {
    const n = Number(link.dataset.chapter);
    link.classList.toggle("is-read", n <= read);
    link.classList.toggle("is-next", n === read + 1);
  }
}

function render() {
  renderControls();
  // У тайтла без глав нет ни панели прогресса, ни списка глав
  if (totalChapters === 0) return;
  renderPanel();
  renderReading();
}

async function init() {
  user = await initHeader();
  if (user) {
    const [result, place] = await Promise.all([api("/api/library"), totalChapters > 0 ? api(`/api/positions/${titleId}`) : null]);
    const found = result.ok ? result.data.items.find((item) => item.titleId === titleId) : null;
    if (found) entry = found;
    if (place?.ok) position = place.data.position;
  }
  render();
}

init();
