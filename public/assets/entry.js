// Страницы произведения, персонажа и человека: свой список (статус, оценка, просмотренные эпизоды или прочитанные главы),
// избранное, отзывы (написать, исправить, удалить, пожаловаться) и комментарии.
// Сама информация о произведении собрана на сервере (functions/encyclopedia.js)

import {
  api, askLogin, button, checkbox, el, errorBox, formatDate, formValue, initHeader, link, loginUrl, reportContent, spoilerText,
  stateBox, toast, userLink
} from "./app.js";
import { mountComments } from "./comments.js";
import { favoriteButton, LIST_STATUSES, removeListItem, saveListItem, SCORE_LABELS } from "./ency-lib.js";

const entryRoot = document.querySelector("#entryRoot");
const personRoot = document.querySelector("#personRoot");
const root = entryRoot || personRoot;
const actions = document.querySelector("#entryActions");

const REVIEW_MIN = 30;
const REVIEW_MAX = 10000;

// ==================== СПИСОК ====================

/** Панель списка: статус, оценка, прогресс. item — запись списка или null */
function listPanel({ kind, id, units, unitsAired, status: releaseStatus }, initial, favorite) {
  let item = initial;
  const statuses = LIST_STATUSES[kind];
  const unitName = kind === "anime" ? "Эпизоды" : "Главы";
  const panel = el("div", "list-panel");
  panel.setAttribute("aria-label", "Мой список");

  const statusSelect = el("select", "select");
  statusSelect.setAttribute("aria-label", "Статус в списке");
  statusSelect.append(new Option("Не в списке", ""), ...Object.entries(statuses).map(([value, label]) => new Option(label, value)));

  const scoreBox = el("div", "score-picker");
  scoreBox.setAttribute("role", "group");
  scoreBox.setAttribute("aria-label", "Моя оценка");
  const scoreButtons = Array.from({ length: 10 }, (_, i) => {
    const value = i + 1;
    const node = button(String(value), null, () => save({ score: item?.score === value ? null : value }), { label: `${value} — ${SCORE_LABELS[value]}` });
    node.title = SCORE_LABELS[value];
    return node;
  });
  scoreBox.append(...scoreButtons);
  const scoreNote = el("span", "muted small");

  // Сколько можно отметить: у выходящего аниме — сколько уже вышло, иначе всего
  const limit = kind === "anime" && releaseStatus === "ongoing" && unitsAired ? unitsAired : units;
  const progressInput = el("input", "input");
  progressInput.type = "number";
  progressInput.min = "0";
  if (limit) progressInput.max = String(limit);
  progressInput.inputMode = "numeric";
  progressInput.setAttribute("aria-label", kind === "anime" ? "Просмотрено эпизодов" : "Прочитано глав");
  const plus = button("+1", "ghost-btn small-btn", () => save({ progress: Math.min((item?.progress || 0) + 1, limit || Infinity) }),
    { label: kind === "anime" ? "Отметить следующий эпизод" : "Отметить следующую главу" });
  const progressBox = el("div", "progress-control");
  progressBox.append(progressInput, el("span", "muted small", `из ${units || "?"}`), plus);
  const bar = el("div", "progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", kind === "anime" ? "Просмотрено" : "Прочитано");
  bar.setAttribute("aria-valuemin", "0");
  const barFill = el("span");
  bar.append(barFill);

  const remove = button("Убрать из списка", "link-btn small", async () => {
    if (!(await removeListItem(kind, id))) return;
    item = null;
    draw();
    toast("Убрано из списка");
  });

  const rowStatus = el("div", "list-panel-row");
  rowStatus.append(statusSelect, favorite);
  const rowScore = el("div", "list-panel-row");
  rowScore.append(el("strong", "small", "Оценка"), scoreBox, scoreNote);
  const rowProgress = el("div", "list-panel-row");
  rowProgress.append(el("strong", "small", unitName), progressBox);
  panel.append(rowStatus, rowScore, rowProgress, bar, remove);

  async function save(changes) {
    panel.setAttribute("aria-busy", "true");
    const next = await saveListItem(kind, id, item ? changes : { status: changes.status || "planned", ...changes });
    panel.removeAttribute("aria-busy");
    if (next) {
      const added = !item;
      item = next;
      if (added) toast(`Добавлено: ${statuses[item.status]}`);
    }
    draw();
  }

  statusSelect.addEventListener("change", () => {
    if (statusSelect.value) save({ status: statusSelect.value });
    else remove.click();
  });
  progressInput.addEventListener("change", () => {
    const value = Number(progressInput.value);
    if (!Number.isInteger(value) || value < 0) {
      draw();
      return;
    }
    save({ progress: limit ? Math.min(value, limit) : value });
  });

  function draw() {
    statusSelect.value = item?.status || "";
    const inList = Boolean(item);
    rowScore.hidden = !inList;
    rowProgress.hidden = !inList;
    bar.hidden = !inList || !units;
    remove.hidden = !inList;
    scoreButtons.forEach((node, i) => node.setAttribute("aria-pressed", String(item?.score === i + 1)));
    scoreNote.textContent = item?.score ? SCORE_LABELS[item.score] : "без оценки";
    progressInput.value = String(item?.progress || 0);
    plus.disabled = Boolean(limit) && (item?.progress || 0) >= limit;
    if (units) {
      bar.setAttribute("aria-valuemax", String(units));
      bar.setAttribute("aria-valuenow", String(item?.progress || 0));
      barFill.style.width = `${Math.min(100, Math.round(((item?.progress || 0) / units) * 100))}%`;
    }
  }
  draw();
  return panel;
}

// ==================== ОТЗЫВЫ ====================

function scoreSelect(value) {
  const select = el("select", "select");
  select.name = "score";
  select.append(new Option("Оценка…", ""), ...Array.from({ length: 10 }, (_, i) => new Option(`${10 - i} — ${SCORE_LABELS[10 - i]}`, String(10 - i))));
  select.value = value ? String(value) : "";
  return select;
}

/** Форма своего отзыва: новый или правка. onDone(review | null) */
function reviewForm(kind, id, mine, onDone) {
  const form = el("form", "review-form");
  form.noValidate = true;
  form.append(el("h3", null, mine ? "Ваш отзыв" : "Написать отзыв"));
  const area = el("textarea", "textarea");
  area.name = "body";
  area.rows = 7;
  area.maxLength = REVIEW_MAX;
  area.placeholder = `Что понравилось и что нет? Не меньше ${REVIEW_MIN} символов.`;
  area.value = mine?.body || "";
  area.setAttribute("aria-label", "Текст отзыва");
  const counter = el("small", "muted small");
  const updateCounter = () => (counter.textContent = `${area.value.trim().length} / ${REVIEW_MAX}`);
  area.addEventListener("input", updateCounter);
  updateCounter();
  const row = el("div", "list-panel-row");
  const select = scoreSelect(mine?.score);
  select.setAttribute("aria-label", "Оценка в отзыве");
  row.append(select, checkbox("spoiler", "Есть спойлеры", Boolean(mine?.spoiler)), counter);
  const message = el("p", "form-error");
  message.setAttribute("role", "alert");
  const submit = el("button", "primary-btn", mine ? "Сохранить" : "Опубликовать");
  submit.type = "submit";
  const buttons = el("div", "list-panel-row");
  buttons.append(submit);
  if (mine) buttons.append(button("Отмена", "ghost-btn", () => onDone(undefined)));
  form.append(row, area, message, buttons);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const score = Number(formValue(form, "score"));
    const body = area.value.trim();
    if (!score) return (message.textContent = "Поставьте оценку.");
    if (body.length < REVIEW_MIN) return (message.textContent = `Отзыв — не меньше ${REVIEW_MIN} символов.`);
    submit.disabled = true;
    const result = await api(`/api/catalog/${kind}/${id}/reviews`, { method: "PUT", body: { score, body, spoiler: formValue(form, "spoiler") } });
    submit.disabled = false;
    if (!result.ok) return (message.textContent = result.data?.error || "Не удалось сохранить отзыв.");
    updateScore(result.data.score);
    toast(mine ? "Отзыв обновлён" : "Отзыв опубликован");
    onDone(result.data.review);
  });
  return form;
}

function reviewNode(review, { onEdit, onDelete, user }) {
  const node = el("article", `entry-review${review.canEdit ? " is-mine" : ""}`);
  node.id = `review-${review.id}`;
  const head = el("div", "entry-review-head");
  const edited = review.updatedAt !== review.createdAt ? " · изменён" : "";
  head.append(userLink(review.author, { small: `${formatDate(review.createdAt)}${edited}` }), el("span", "review-score", `${review.score}/10 · ${SCORE_LABELS[review.score]}`));
  node.append(head);
  if (review.hidden) node.append(el("p", "notice small", "Отзыв скрыт модератором и виден только вам."));
  node.append(spoilerText(el("p", "entry-review-body", review.body), review.spoiler));
  const bar = el("div", "entry-review-actions");
  if (review.canEdit) {
    bar.append(button("Изменить", "ghost-btn small-btn", onEdit), button("Удалить", "link-btn small", onDelete));
  } else {
    if (user) bar.append(button("Пожаловаться", "link-btn small", () => reportContent("entry_review", review.id)));
    if (review.canModerate) bar.append(button("Удалить как модератор", "link-btn small", onDelete));
  }
  const commentsBox = el("div");
  const toggle = button(review.comments ? `Комментарии · ${review.comments}` : "Комментировать", "ghost-btn small-btn", () => {
    toggle.remove();
    mountComments(commentsBox, { targetType: "entry_review", targetId: review.id, placeholder: "Ответ на отзыв…" });
  });
  bar.append(toggle);
  node.append(bar, commentsBox);
  return node;
}

function updateScore(score) {
  const box = document.querySelector("#endemionScore");
  if (!box) return;
  box.replaceChildren(el("strong", null, score ? `★ ${score.average.toFixed(2)}` : "—"), el("span", null, score ? `ENDEMION · ${score.votes}` : "ENDEMION · нет оценок"));
}

async function mountReviews(kind, id, user) {
  const box = document.querySelector("#reviewsBody");
  if (!box) return;
  const list = el("div", "review-list");
  const mineBox = el("div");
  const more = button("Показать ещё", "ghost-btn", () => load(false));
  more.hidden = true;
  box.replaceChildren(mineBox, list, more);
  let offset = 0;

  function showMine(mine) {
    if (!user) {
      mineBox.replaceChildren(stateBox({ icon: "✍", text: "Войдите, чтобы написать отзыв и поставить оценку.", action: { href: loginUrl(), text: "Войти" } }));
      return;
    }
    if (!mine) {
      mineBox.replaceChildren(reviewForm(kind, id, null, (review) => {
        if (!review) return;
        showMine(review);
        // Надпись «Отзывов пока нет» больше не нужна: появился свой отзыв
        list.querySelector(":scope > p.muted")?.remove();
      }));
      return;
    }
    const node = reviewNode(mine, {
      user,
      onEdit: () => mineBox.replaceChildren(reviewForm(kind, id, mine, (review) => showMine(review === undefined ? mine : review))),
      onDelete: async () => {
        if (!confirm("Удалить ваш отзыв?")) return;
        const result = await api(`/api/catalog/${kind}/${id}/reviews`, { method: "DELETE" });
        if (!result.ok) return toast(result.data?.error || "Не удалось удалить отзыв.");
        updateScore(result.data.score);
        toast("Отзыв удалён");
        showMine(null);
        load(true);
      }
    });
    mineBox.replaceChildren(node);
  }

  async function load(reset) {
    if (reset) offset = 0;
    const result = await api(`/api/catalog/${kind}/${id}/reviews?offset=${offset}`);
    if (!result.ok) {
      list.replaceChildren(errorBox(result.data?.error || "Отзывы не загрузились.", () => load(true)));
      return;
    }
    const { reviews, mine, hasMore } = result.data;
    if (reset) {
      showMine(mine);
      list.replaceChildren();
    }
    const others = reviews.filter((review) => !review.canEdit);
    for (const review of others) {
      list.append(reviewNode(review, {
        user,
        onEdit: null,
        onDelete: async () => {
          if (!confirm("Удалить этот отзыв как модератор?")) return;
          const removed = await api(`/api/entry-reviews/${review.id}`, { method: "DELETE" });
          if (!removed.ok) return toast(removed.data?.error || "Не удалось удалить.");
          toast("Отзыв удалён");
          load(true);
        }
      }));
    }
    if (reset && !others.length && !mine) list.append(el("p", "muted", "Отзывов пока нет. Станьте первым."));
    offset += reviews.length;
    more.hidden = !hasMore;
  }

  await load(true);
  const anchor = location.hash.match(/^#review-(\d+)$/);
  if (anchor) document.getElementById(`review-${anchor[1]}`)?.scrollIntoView({ block: "center" });
}

// ==================== СТАРТ ====================

/** Дата следующего эпизода — во времени посетителя */
function localTimes() {
  for (const node of document.querySelectorAll("time[data-local-time]")) {
    const date = new Date(node.getAttribute("datetime") || "");
    if (!Number.isNaN(date.getTime())) {
      node.textContent = date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    }
  }
}

async function initEntry(user) {
  const { kind } = entryRoot.dataset;
  const id = Number(entryRoot.dataset.id);
  const data = { kind, id, units: Number(entryRoot.dataset.units), unitsAired: Number(entryRoot.dataset.unitsAired), status: entryRoot.dataset.status };
  if (user) {
    const result = await api(`/api/mylist/${kind}/${id}`);
    if (result.ok) {
      actions.replaceChildren(listPanel(data, result.data.item, favoriteButton(kind, id, result.data.favorite)));
    } else {
      actions.replaceChildren(errorBox(result.data?.error || "Не удалось загрузить ваш список.", () => initEntry(user)));
    }
  } else {
    // Ссылка «Добавить в список» из разметки сервера ведёт на вход и возвращает сюда
    const add = actions.querySelector("a.primary-btn");
    add?.addEventListener("click", (event) => {
      event.preventDefault();
      askLogin("Чтобы вести свой список, войдите в профиль.");
    });
  }
  initUniverse(user);
  mountReviews(kind, id, user);
  mountComments(document.querySelector("#commentsBody"), { targetType: kind, targetId: id, placeholder: "Что думаете об этом произведении?" });
}

// ==================== UNIVERSE EXPLORER ====================

/**
 * Карта вселенной загружается только когда зритель её открывает: кнопкой в шапке или в разделе,
 * или по ссылке с #universe. До этого на странице нет ни скрипта карты, ни запроса к /api/universe
 */
function initUniverse(user) {
  const box = document.querySelector("#universeRoot");
  if (!box) return;
  let opened = false;
  const open = async () => {
    if (opened) return;
    opened = true;
    box.setAttribute("aria-busy", "true");
    try {
      if (!document.querySelector('link[href^="/assets/universe.css"]')) {
        const style = el("link");
        style.rel = "stylesheet";
        style.href = "/assets/universe.css";
        document.head.append(style);
      }
      const { mountUniverse } = await import("./universe.js");
      mountUniverse(box, { kind: box.dataset.kind, id: Number(box.dataset.id), signedIn: Boolean(user) });
    } catch {
      opened = false;
      box.replaceChildren(errorBox("Скрипт карты не загрузился. Проверьте интернет.", open));
    } finally {
      box.removeAttribute("aria-busy");
    }
  };
  for (const node of document.querySelectorAll("[data-universe-open]")) {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector("#universe")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      open();
    });
  }
  if (location.hash === "#universe") open();
  window.addEventListener("hashchange", () => location.hash === "#universe" && open());
}

async function initPerson(user) {
  const { type } = personRoot.dataset;
  const id = Number(personRoot.dataset.id);
  if (user) {
    const result = await api(`/api/favorites?type=${type}`);
    const on = result.ok && result.data.items.some((item) => item.id === id);
    actions.replaceChildren(favoriteButton(type, id, on));
  } else {
    actions.replaceChildren(link(loginUrl(), "ghost-btn", "♡ В избранное"));
  }
  mountComments(document.querySelector("#commentsBody"), { targetType: type, targetId: id });
}

async function init() {
  localTimes();
  const user = await initHeader();
  if (!root || !actions) return;
  if (entryRoot) await initEntry(user);
  else await initPerson(user);
}

init();
