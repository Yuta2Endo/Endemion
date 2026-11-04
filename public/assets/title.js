// Страница тайтла: полка (избранное, статус, прогресс по главам), теги, персонажи, легальные источники,
// оценки и отзывы, обсуждение, похожие истории и подборки. Сама страница приходит готовой с сервера

import {
  announceAchievements, api, askLogin, avatar, button, chaptersText, el, errorBox, getMe, initHeader, link, loginUrl,
  openDialog, reasonList, reportContent, spoilerText, stateBox, STATUS_LABELS, textarea, thumb, timeAgo, toast,
  TYPE_LABELS, updateLibrary, field, formValue, checkbox
} from "./app.js";
import { mountComments } from "./comments.js";

const root = document.querySelector("#titleRoot");
const titleId = Number(root.dataset.titleId);
const totalChapters = Number(root.dataset.chapters);
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
  const item = await updateLibrary(titleId, changes);
  if (!item) return false;
  entry = item;
  render();
  return true;
}

// ==================== ПОЛКА И ПРОГРЕСС ====================

function renderControls() {
  controls.replaceChildren();
  const favorite = button(entry.favorite ? "♥ В избранном" : "♡ В избранное", "primary-btn", async () => {
    if (await save({ favorite: !entry.favorite })) controls.querySelector(".primary-btn")?.focus();
  }, { pressed: entry.favorite });

  const label = el("label", "visually-hidden", "Статус на полке");
  label.htmlFor = "statusSelect";
  const select = el("select", "select status-select");
  select.id = "statusSelect";
  select.append(new Option("Без статуса", ""));
  for (const [value, text] of Object.entries(STATUS_LABELS)) select.append(new Option(text, value));
  select.value = entry.status || "";
  select.disabled = !user;
  select.addEventListener("change", () => save({ status: select.value || null }));

  const collect = button("＋ В подборку", "ghost-btn", addToCollection);
  controls.append(favorite, label, select, collect);

  if (!user) {
    const hint = el("p", "controls-hint");
    hint.append(link(loginUrl(), null, "Войдите"), ", чтобы отмечать прочитанные главы и собирать полку.");
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

  const summary = el("div", "chapter-summary");
  summary.append(
    el("strong", null, read === 0 ? "Ещё не начато" : read >= totalChapters ? "Все главы прочитаны" : `Прочитано ${read} из ${totalChapters}`),
    el("span", null, read < totalChapters ? `Следующая: глава ${read + 1}` : chaptersText(totalChapters))
  );

  const progress = el("div", "t-progress chapter-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", String(totalChapters));
  progress.setAttribute("aria-valuenow", String(read));
  progress.setAttribute("aria-label", "Прочитано глав");
  const bar = el("span");
  bar.style.width = `${Math.round((read / totalChapters) * 100)}%`;
  progress.append(bar);

  const actions = el("div", "chapter-actions");
  actions.append(
    button("+1 глава", "primary-btn", () => save({ chapter: read + 1 })),
    button("Прочитано всё", "ghost-btn", () => save({ chapter: totalChapters })),
    button("Сбросить", "ghost-btn", () => save({ chapter: 0 }))
  );
  const [plusOne, all, reset] = actions.children;
  plusOne.disabled = all.disabled = read >= totalChapters;
  reset.disabled = read === 0;

  const form = el("form", "chapter-form");
  const label = el("label", null, "Остановился на главе");
  label.htmlFor = "chapterInput";
  const input = el("input", "input");
  input.id = "chapterInput";
  input.type = "number";
  input.min = "0";
  input.max = String(totalChapters);
  input.value = String(read);
  input.inputMode = "numeric";
  const submit = el("button", "ghost-btn", "Сохранить");
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
  for (const node of document.querySelectorAll("#chapterList a")) {
    const n = Number(node.dataset.chapter);
    node.classList.toggle("is-read", n <= read);
    node.classList.toggle("is-next", n === read + 1);
  }
}

function render() {
  renderControls();
  // У тайтла без глав нет ни панели прогресса, ни списка глав
  if (totalChapters === 0) return;
  renderPanel();
  renderReading();
}

// ==================== ПОДБОРКИ ====================

async function addToCollection() {
  if (!user) return askLogin("Чтобы собирать подборки, войдите в профиль.");
  const result = await api("/api/collections?mine=1");
  if (!result.ok) return toast(result.data?.error || "Не удалось загрузить подборки.");
  const mine = result.data.collections;
  await openDialog({
    title: "Добавить в подборку",
    submitText: "Добавить",
    build(form) {
      const select = el("select", "select");
      select.name = "collection";
      for (const collection of mine) select.append(new Option(`${collection.name} (${collection.size})`, String(collection.id)));
      select.append(new Option("＋ Новая подборка…", "new"));
      const nameRow = field("Название новой подборки", Object.assign(el("input", "input"), { name: "name", maxLength: 80 }));
      nameRow.hidden = mine.length > 0;
      select.addEventListener("change", () => (nameRow.hidden = select.value !== "new"));
      form.append(field("Подборка", select), nameRow, field("Заметка (необязательно)", Object.assign(el("input", "input"), { name: "note", maxLength: 300 })));
    },
    async onSubmit(form) {
      let id = formValue(form, "collection");
      if (id === "new") {
        const created = await api("/api/collections", { method: "POST", body: { name: formValue(form, "name") } });
        if (!created.ok) return created.data?.error || "Не удалось создать подборку.";
        id = String(created.data.collection.id);
      }
      const added = await api(`/api/collections/${id}/items`, { method: "PUT", body: { titleId, note: formValue(form, "note") } });
      if (!added.ok) return added.data?.error || "Не удалось добавить.";
      announceAchievements(added.data.achievements);
      toast("Добавлено в подборку.");
      loadCollections();
      return null;
    }
  });
}

async function loadCollections() {
  const result = await api(`/api/collections?title=${titleId}`);
  if (!result.ok || !result.data.collections.length) return;
  document.querySelector("#titleCollections").hidden = false;
  document.querySelector("#titleCollectionList").replaceChildren(...result.data.collections.slice(0, 5).map((collection) => {
    const row = el("p");
    row.append(link(`/collection/${collection.id}`, null, collection.name), el("span", "muted small", ` · ${collection.size} тайтлов · ${collection.author.name}`));
    return row;
  }));
}

// ==================== ДЕТАЛИ: ТЕГИ, ПЕРСОНАЖИ, ИСТОЧНИКИ ====================

const CATEGORY_LABELS = { mood: "Атмосфера", hero: "Главный герой", plot: "Сюжет", theme: "Темы", setting: "Мир" };

async function loadDetails() {
  const result = await api(`/api/titles/${titleId}/details`);
  const sources = document.querySelector("#sourceList");
  if (!result.ok) {
    sources.replaceChildren(el("p", "muted small", "Не удалось загрузить."));
    return;
  }
  const { tags, characters } = result.data;
  if (tags.length) {
    document.querySelector("#tagsSection").hidden = false;
    const groups = Object.entries(CATEGORY_LABELS).map(([category, label]) => {
      const items = tags.filter((tag) => tag.category === category);
      if (!items.length) return null;
      const row = el("div", "tag-group");
      const chips = el("div", "chips");
      chips.append(...items.map((tag) => {
        const chip = link(`/catalog?tag=${encodeURIComponent(tag.code)}`, `tag${tag.weight === 3 ? " is-strong" : ""}`, tag.name);
        chip.title = tag.weight === 3 ? "Главное в этой истории" : "Есть в истории";
        return chip;
      }));
      row.append(el("span", null, label), chips);
      return row;
    }).filter(Boolean);
    document.querySelector("#tagGroups").replaceChildren(...groups);
  }
  if (characters.length) {
    document.querySelector("#charactersSection").hidden = false;
    document.querySelector("#characterList").replaceChildren(...characters.map((character) => {
      const card = el("div", "character");
      const text = el("div");
      text.append(el("strong", null, character.name), el("small", null, result.data.roles[character.role]));
      if (character.description) text.append(el("small", null, character.description));
      card.append(el("b", null, character.symbol), text);
      return card;
    }));
  }
  if (!result.data.sources.length) {
    sources.replaceChildren(el("p", "muted small", "Официальные источники пока не указаны. Читайте у издателей, которые владеют правами на перевод."));
  } else {
    sources.replaceChildren(...result.data.sources.map((source) => {
      const a = link(source.url, "source-link", "");
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.append(el("strong", null, source.name), el("span", "tag", source.kindLabel));
      return a;
    }));
  }
}

async function loadRelated() {
  const list = document.querySelector("#relatedList");
  const result = await api(`/api/titles/${titleId}/related?limit=5`);
  if (!result.ok) return list.replaceChildren(el("p", "muted small", "Не удалось загрузить похожие."));
  if (!result.data.items.length) return list.replaceChildren(el("p", "muted small", "Похожих историй пока не нашлось."));
  list.replaceChildren(...result.data.items.map((item) => {
    const row = el("a", "related-item");
    row.href = `/title/${item.title.id}`;
    const text = el("div");
    text.append(el("strong", null, item.title.title), el("span", "muted small", `${TYPE_LABELS[item.title.type]} · ${item.title.year}`), reasonList(item.reasons, 2));
    row.append(thumb(item.title, "picker-thumb"), text);
    return row;
  }));
}

// ==================== ОЦЕНКИ И ОТЗЫВЫ ====================

const reviewsBox = document.querySelector("#reviewsBox");

function reviewNode(review) {
  const node = el("article", "review");
  node.id = `review-${review.id}`;
  const head = el("div", "comment-head");
  head.append(avatar(review.author, "avatar-sm"));
  head.append(review.author.username ? link(`/users/${encodeURIComponent(review.author.username)}`, null, review.author.name) : el("strong", null, review.author.name));
  head.append(el("time", null, timeAgo(review.updatedAt)), el("span", "review-score", `${review.score}/10`));
  const text = el("p", "comment-text", review.body);
  node.append(head, spoilerText(text, review.spoiler));
  const actions = el("div", "comment-actions");
  actions.append(link(`#review-${review.id}`, null, review.comments ? `Комментарии: ${review.comments}` : "Комментировать"));
  actions.lastChild.addEventListener("click", (event) => {
    event.preventDefault();
    toggleReviewComments(node, review);
  });
  if (user && !review.canEdit) actions.append(button("Пожаловаться", null, () => reportContent("review", review.id)));
  node.append(actions);
  return node;
}

async function toggleReviewComments(node, review) {
  const existing = node.querySelector(".review-comments");
  if (existing) return existing.remove();
  const box = el("div", "review-comments section");
  node.append(box);
  await mountComments(box, { targetType: "review", targetId: review.id, placeholder: "Ответьте на отзыв…" });
}

function scoreSummary(summary) {
  const wrap = el("div", "score-summary");
  const big = el("div", "score-big", summary.average === null ? "—" : summary.average.toFixed(1));
  big.append(el("small", null, summary.votes ? `${summary.votes} ${summary.votes % 10 === 1 && summary.votes % 100 !== 11 ? "оценка" : "оценок"} читателей` : "Оценок пока нет"));
  const histogram = el("div", "histogram");
  const max = Math.max(1, ...Object.values(summary.distribution));
  for (let score = 10; score >= 1; score--) {
    const row = el("div");
    const bar = el("div", "t-progress");
    const fill = el("span");
    fill.style.width = `${Math.round((summary.distribution[score] / max) * 100)}%`;
    bar.append(fill);
    row.append(el("span", null, String(score)), bar, el("span", null, String(summary.distribution[score])));
    histogram.append(row);
  }
  wrap.append(big, histogram);
  return wrap;
}

function myReviewForm(mine) {
  const form = el("form", "stack section");
  form.noValidate = true;
  let score = mine?.score || 0;
  const picker = el("div", "score-picker");
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Ваша оценка от 1 до 10");
  for (let value = 1; value <= 10; value++) {
    picker.append(button(String(value), null, () => {
      score = value;
      picker.querySelectorAll("button").forEach((node, i) => node.setAttribute("aria-pressed", String(i + 1 === value)));
    }, { pressed: value === score, label: `Оценка ${value}` }));
  }
  const body = textarea("body", { value: mine?.body || "", maxLength: 5000, placeholder: "Отзыв (необязательно): что понравилось, что нет…", rows: 3 });
  body.setAttribute("aria-label", "Текст отзыва");
  const spoiler = checkbox("spoiler", "В отзыве спойлеры", mine?.spoiler);
  const actions = el("div", "comment-form-actions");
  const submit = el("button", "primary-btn small-btn", mine ? "Обновить оценку" : "Оценить");
  submit.type = "submit";
  const right = el("div", "section-actions");
  if (mine) {
    right.append(button("Удалить оценку", "ghost-btn small-btn", async () => {
      if (!confirm("Удалить вашу оценку и отзыв?")) return;
      const result = await api(`/api/titles/${titleId}/reviews`, { method: "DELETE" });
      if (!result.ok) return toast(result.data?.error || "Не удалось удалить.");
      loadReviews();
    }));
  }
  right.append(submit);
  actions.append(spoiler, right);
  const message = el("p", "form-error");
  form.append(el("strong", null, mine ? "Ваша оценка" : "Оцените тайтл"), picker, body, actions, message);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!score) {
      message.textContent = "Выберите оценку от 1 до 10.";
      return;
    }
    submit.disabled = true;
    const result = await api(`/api/titles/${titleId}/reviews`, {
      method: "PUT",
      body: { score, body: body.value, spoiler: formValue(form, "spoiler") }
    });
    submit.disabled = false;
    if (!result.ok) {
      message.textContent = result.data?.error || "Не удалось сохранить оценку.";
      return;
    }
    announceAchievements(result.data.achievements);
    toast("Оценка сохранена.");
    loadReviews();
  });
  return form;
}

let reviewsOffset = 0;

async function loadReviews(more = false) {
  if (!more) reviewsOffset = 0;
  const result = await api(`/api/titles/${titleId}/reviews?offset=${reviewsOffset}`);
  if (!result.ok) {
    reviewsBox.replaceChildren(errorBox(result.data?.error || "Отзывы не загрузились.", () => loadReviews()));
    return;
  }
  const { reviews, total, summary, mine } = result.data;
  if (!more) {
    reviewsBox.replaceChildren(scoreSummary(summary));
    if (user) {
      reviewsBox.append(myReviewForm(mine));
      if (mine?.hidden) reviewsBox.append(el("p", "form-error", "Модератор скрыл ваш отзыв. Исправьте его, чтобы он снова прошёл проверку."));
    } else {
      reviewsBox.append(stateBox({ icon: "★", text: "Войдите, чтобы поставить оценку и написать отзыв.", action: { href: loginUrl(), text: "Войти" } }));
    }
    reviewsBox.append(el("div", "stack section"));
  }
  const list = reviewsBox.lastElementChild;
  list.querySelector(".load-more")?.remove();
  if (!more && !reviews.length) list.append(el("p", "muted small", "Отзывов с текстом пока нет."));
  list.append(...reviews.map(reviewNode));
  reviewsOffset += reviews.length;
  if (reviewsOffset < total) {
    const box = el("div", "load-more");
    box.append(button("Ещё отзывы", "ghost-btn", () => loadReviews(true)));
    list.append(box);
  }
  const anchor = location.hash.match(/^#review-(\d+)$/);
  if (anchor && !more) document.getElementById(`review-${anchor[1]}`)?.scrollIntoView({ block: "center" });
}

// ==================== СТАРТ ====================

async function init() {
  user = await initHeader();
  if (user) {
    const [library, place] = await Promise.all([api("/api/library"), totalChapters > 0 ? api(`/api/positions/${titleId}`) : null]);
    const found = library.ok ? library.data.items.find((item) => item.titleId === titleId) : null;
    if (found) entry = found;
    if (place?.ok) position = place.data.position;
  }
  render();
  // Просмотр страницы: история для вошедших и счётчик популярности. Ошибка здесь читателю не мешает
  api(`/api/titles/${titleId}/view`, { method: "POST", body: {} });
  loadDetails();
  loadRelated();
  loadReviews();
  loadCollections();
  mountComments(document.querySelector("#commentsBox"), { targetType: "title", targetId: titleId, placeholder: "Что думаете об этой истории?" });
}

getMe();
init();
