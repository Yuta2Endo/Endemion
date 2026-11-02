// Разделы админки для сообщества и справочников: сводка платформы, жанры и авторы, модерация жалоб пользователей,
// голосования Арены и подборки. Права проверяет сервер: модератору доступны модерация и голосования, остальное — администратору

import { api, button, el, link, plural, timeAgo, titlePicker } from "./app.js";

const $ = (selector) => document.querySelector(selector);

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function empty(text) {
  return el("li", "admin-empty", text);
}

// ==================== СВОДКА ПЛАТФОРМЫ ====================

function statCard(label, value, note, alert = false) {
  const card = el("div", `admin-stat${alert ? " is-alert" : ""}`);
  card.append(el("span", null, label), el("strong", null, String(value)), el("small", null, note));
  return card;
}

export async function loadPlatformStats() {
  const box = $("#platformStats");
  const top = $("#topTitles");
  const result = await api("/api/admin/platform-stats");
  if (!result.ok) {
    box.replaceChildren(el("p", "form-message", result.data?.error || "Не удалось загрузить статистику сообщества."));
    top.replaceChildren();
    return;
  }
  const s = result.data;
  box.replaceChildren(
    statCard("Комментарии", s.comments, `за 7 дней: ${s.comments_week}`),
    statCard("Рецензии", s.reviews, `обсуждений: ${s.threads}`),
    statCard("Подборки", s.collections, `подписок: ${s.follows}`),
    statCard("Голоса на Арене", s.votes, `открытых голосований: ${s.polls_open} · турниров: ${s.tournaments}`),
    statCard("Жалобы пользователей", s.reports_open, s.muted ? `с ограничением: ${s.muted}` : "ограничений нет", s.reports_open > 0),
    statCard("Полки читателей", s.library, `прочитано глав: ${s.chapters_read}`),
    statCard("Справочники", s.genres, `авторов: ${s.authors} · персонажей: ${s.characters}`)
  );
  if (!s.topTitles.length) {
    top.replaceChildren();
    return;
  }
  const list = el("ol", "admin-top-list");
  list.append(...s.topTitles.map((title) => {
    const item = el("li");
    item.append(link(`/title/${title.id}`, null, title.title), el("small", null, ` · ${title.readers} ${plural(title.readers, "читатель", "читателя", "читателей")}`));
    return item;
  }));
  top.replaceChildren(el("h4", "admin-subheading", "Больше всего читателей"), list);
}

// ==================== ЖАНРЫ И АВТОРЫ ====================

/** Справочник жанров или авторов: список с правкой на месте и форма добавления */
function dictionary({ url, list, form, message, textKey, textLabel, maxName, maxText, noun }) {
  let items = [];

  function row(item) {
    const node = el("li", "admin-plain-item");
    const info = el("div", "admin-plain-info");
    info.append(el("strong", null, item.name), el("small", null, `${noun.count(item.titles)}${item[textKey] ? ` · ${item[textKey]}` : ""}`));
    const actions = el("div", "admin-chapter-actions");
    actions.append(button("Изменить", "secondary-button", () => edit(node, item)));
    if (!item.titles) actions.append(button("Удалить", "danger-button", () => remove(item)));
    node.append(info, actions);
    return node;
  }

  function edit(node, item) {
    const editor = el("form", "admin-inline-form admin-inline-edit");
    editor.noValidate = true;
    const name = el("input", "input");
    name.value = item.name;
    name.maxLength = maxName;
    name.setAttribute("aria-label", "Название");
    const text = el("input", "input");
    text.value = item[textKey] || "";
    text.maxLength = maxText;
    text.placeholder = textLabel;
    text.setAttribute("aria-label", textLabel);
    const save = el("button", "main-button", "Сохранить");
    save.type = "submit";
    editor.append(name, text, save, button("Отмена", "secondary-button", render));
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await api(`${url}/${item.id}`, { method: "PUT", body: { name: name.value, [textKey]: text.value } });
      if (!result.ok) return setMessage(message, result.data?.error || "Не удалось сохранить.");
      items = result.data.items;
      render();
      setMessage(message, "Сохранено.", true);
    });
    node.replaceChildren(editor);
    name.focus();
  }

  async function remove(item) {
    if (!confirm(`Удалить «${item.name}»?`)) return;
    const result = await api(`${url}/${item.id}`, { method: "DELETE" });
    if (!result.ok) return setMessage(message, result.data?.error || "Не удалось удалить.");
    items = result.data.items;
    render();
    setMessage(message, `«${item.name}» удалён.`, true);
  }

  function render() {
    list.replaceChildren(...(items.length ? items.map(row) : [empty("Пока пусто.")]));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = form.elements.namedItem("name");
    const result = await api(url, { method: "POST", body: { name: field.value } });
    if (!result.ok) return setMessage(message, result.data?.error || "Не удалось добавить.");
    items = result.data.items;
    field.value = "";
    render();
    setMessage(message, "Добавлено.", true);
  });

  return async function load() {
    const result = await api(url);
    if (!result.ok) return setMessage(message, result.data?.error || "Не удалось загрузить список.");
    items = result.data.items;
    render();
  };
}

const loadGenres = dictionary({
  url: "/api/admin/genres", list: $("#genreList"), form: $("#genreForm"), message: $("#genreMessage"),
  textKey: "description", textLabel: "Описание жанра", maxName: 30, maxText: 500,
  noun: { count: (n) => (n ? `${n} ${plural(n, "тайтл", "тайтла", "тайтлов")}` : "не используется") }
});
const loadAuthors = dictionary({
  url: "/api/admin/authors", list: $("#authorList"), form: $("#authorForm"), message: $("#authorMessage"),
  textKey: "bio", textLabel: "Коротко об авторе", maxName: 120, maxText: 1000,
  noun: { count: (n) => (n ? `${n} ${plural(n, "тайтл", "тайтла", "тайтлов")}` : "без тайтлов") }
});

export function loadTaxonomy() {
  return Promise.all([loadGenres(), loadAuthors()]);
}

// ==================== МОДЕРАЦИЯ ====================

const reportList = $("#reportList");
const reportStatus = $("#reportStatus");
const reportsMessage = $("#reportsMessage");

export function updateReportsBadge(count) {
  const badge = $("#reportsBadge");
  badge.hidden = !count;
  badge.textContent = count ? String(count) : "";
}

const ACTION_VERBS = { remove: "скрыто", restore: "восстановлено", reject: "жалобы отклонены" };

async function moderate(group, action, { mute = false } = {}) {
  const what = group.label.toLowerCase();
  const prompts = {
    remove: `Скрыть ${what}? Автор получит уведомление. Причина (необязательно):`,
    restore: `Вернуть ${what}? Причина (необязательно):`,
    reject: "Отклонить жалобы как необоснованные? Комментарий (необязательно):"
  };
  const reason = prompt(prompts[action], "");
  if (reason === null) return;
  const body = { targetType: group.targetType, targetId: group.targetId, action, reason };
  if (mute) {
    const days = prompt("На сколько дней запретить автору публиковать? От 1 до 30.", "3");
    if (days === null) return;
    body.muteDays = Number(days);
  }
  const result = await api("/api/moderation/actions", { method: "POST", body });
  if (!result.ok) return setMessage(reportsMessage, result.data?.error || "Не удалось применить решение.");
  setMessage(reportsMessage, `${group.label} #${group.targetId}: ${ACTION_VERBS[action]}${mute ? ", публикации автора ограничены" : ""}.`, true);
  await Promise.all([loadReports(), loadModLog()]);
}

function reportRow(group) {
  const item = el("li", `admin-complaint${reportStatus.value === "open" ? " is-new" : ""}`);
  const header = el("header");
  header.append(
    el("strong", null, `${group.label} #${group.targetId}`),
    el("small", null, `${group.reports} ${plural(group.reports, "жалоба", "жалобы", "жалоб")} · последняя ${timeAgo(group.lastAt)}`)
  );
  item.append(header);

  if (group.content) {
    const text = el("p", "admin-complaint-text", group.content.text || "(текст удалён)");
    item.append(text);
    const meta = el("p", "admin-hint");
    if (group.content.removed) meta.append(el("span", "admin-tag is-blocked", "Скрыто"), " ");
    if (group.content.link) meta.append(link(group.content.link, null, "Открыть на сайте"));
    item.append(meta);
  } else {
    item.append(el("p", "admin-hint", "Контент уже удалён."));
  }

  const reasons = el("ul", "admin-report-reasons");
  reasons.append(...group.items.map((report) => {
    const line = el("li");
    line.append(el("strong", null, report.reasonLabel || report.reason), ` — ${report.reporter || "удалённый пользователь"}`);
    if (report.details) line.append(el("q", null, report.details));
    return line;
  }));
  item.append(reasons);

  if (reportStatus.value === "open" && group.content) {
    const actions = el("div", "admin-chapter-actions");
    const canRemove = group.targetType !== "user" && !group.content.removed;
    if (canRemove) {
      actions.append(button("Скрыть", "danger-button", () => moderate(group, "remove")));
      if (group.content.ownerId) actions.append(button("Скрыть и ограничить автора", "danger-button", () => moderate(group, "remove", { mute: true })));
    }
    if (group.content.removed && group.targetType !== "comment") actions.append(button("Восстановить", "secondary-button", () => moderate(group, "restore")));
    actions.append(button("Отклонить жалобы", "secondary-button", () => moderate(group, "reject")));
    if (group.targetType === "user") actions.append(el("small", "admin-hint", "Заблокировать профиль может администратор в разделе «Пользователи»."));
    item.append(actions);
  }
  return item;
}

export async function loadReports() {
  const result = await api(`/api/moderation/reports?status=${reportStatus.value}`);
  if (!result.ok) return setMessage(reportsMessage, result.data?.error || "Не удалось загрузить жалобы.");
  updateReportsBadge(result.data.open);
  const label = { open: "Открытых жалоб нет.", resolved: "Решённых жалоб нет.", rejected: "Отклонённых жалоб нет." }[reportStatus.value];
  reportList.replaceChildren(...(result.data.groups.length ? result.data.groups.map(reportRow) : [empty(label)]));
}

reportStatus.addEventListener("change", loadReports);

// Свежие комментарии: модератор может скрыть комментарий без жалобы
async function removeComment(comment) {
  const reason = prompt("Скрыть комментарий? Текст будет стёрт, автор получит уведомление. Причина (необязательно):", "");
  if (reason === null) return;
  const result = await api("/api/moderation/actions", {
    method: "POST", body: { targetType: "comment", targetId: comment.id, action: "remove", reason }
  });
  const message = $("#recentCommentsMessage");
  if (!result.ok) return setMessage(message, result.data?.error || "Не удалось скрыть комментарий.");
  setMessage(message, `Комментарий #${comment.id} скрыт.`, true);
  await Promise.all([loadComments(), loadModLog()]);
}

const COMMENT_PLACES = { title: "тайтл", thread: "обсуждение", collection: "подборка", review: "рецензия", tournament: "турнир", chapter: "глава" };

async function loadComments() {
  const list = $("#recentComments");
  const result = await api("/api/moderation/comments");
  if (!result.ok) return setMessage($("#recentCommentsMessage"), result.data?.error || "Не удалось загрузить комментарии.");
  list.replaceChildren(...(result.data.comments.length ? result.data.comments.slice(0, 20).map((comment) => {
    const item = el("li", "admin-plain-item");
    const info = el("div", "admin-plain-info");
    const author = comment.author
      ? (comment.author.username ? link(`/u/${comment.author.username}`, null, comment.author.name) : el("span", null, comment.author.name))
      : el("span", null, "удалённый пользователь");
    const meta = el("small");
    meta.append(author, ` · ${COMMENT_PLACES[comment.targetType] || comment.targetType} #${comment.targetId} · ${timeAgo(comment.createdAt)}`);
    if (comment.reports) meta.append(" · ", el("span", "admin-tag is-blocked", `жалоб: ${comment.reports}`));
    info.append(el("p", "admin-complaint-text", comment.body), meta);
    item.append(info, button("Скрыть", "danger-button", () => removeComment(comment)));
    return item;
  }) : [empty("Комментариев пока нет.")]));
}

// Журнал модерации
const MOD_TARGETS = { comment: "комментарий", review: "рецензия", thread: "обсуждение", collection: "подборка", user: "профиль", tournament: "турнир", poll: "голосование" };
const MOD_ACTIONS = {
  remove: "скрыт контент", restore: "восстановлен контент", reject: "жалобы отклонены", mute: "ограничены публикации",
  unmute: "сняты ограничения", create: "создано", open: "открыто снова", close: "закрыто", delete: "удалено"
};
let modEntries = [];
let modTotal = 0;

function modRow(entry) {
  const item = el("li", "admin-audit-entry");
  const verb = MOD_ACTIONS[entry.action.split(".").pop()] || entry.action;
  const what = el("span");
  what.append(el("strong", null, verb.charAt(0).toUpperCase() + verb.slice(1)), ` · ${MOD_TARGETS[entry.targetType] || entry.targetType} #${entry.targetId}`);
  if (entry.reason) what.append(` · ${entry.reason}`);
  const time = el("time", null, timeAgo(entry.createdAt));
  time.dateTime = `${entry.createdAt.replace(" ", "T")}Z`;
  item.append(time, what, el("small", null, entry.moderator));
  return item;
}

async function loadModLog(append = false) {
  const result = await api(`/api/moderation/log?offset=${append ? modEntries.length : 0}`);
  if (!result.ok) return setMessage($("#modLogMessage"), result.data?.error || "Не удалось загрузить журнал.");
  const known = new Set(append ? modEntries.map((entry) => entry.id) : []);
  modEntries = append ? [...modEntries, ...result.data.entries.filter((entry) => !known.has(entry.id))] : result.data.entries;
  modTotal = result.data.total;
  $("#modLog").replaceChildren(...(modEntries.length ? modEntries.map(modRow) : [empty("Решений пока нет.")]));
  $("#modLogMore").hidden = modEntries.length >= modTotal;
}

$("#modLogMore").addEventListener("click", () => loadModLog(true));

export function loadModeration() {
  return Promise.all([loadReports(), loadComments(), loadModLog()]);
}

// ==================== ГОЛОСОВАНИЯ ====================

const pollForm = $("#pollForm");
const pollKind = $("#pollKind");
const pollOptionsList = $("#pollOptions");
const pollMessage = $("#pollMessage");
const POLL_KIND_LABELS = { title: "Тайтлы", character: "Персонажи", genre: "Жанры", versus: "Кто кого" };
let pollOptions = [];
let genreCache = null;

function renderPollOptions() {
  pollOptionsList.replaceChildren(...(pollOptions.length ? pollOptions.map((option, index) => {
    const item = el("li");
    item.append(el("span", null, option.label), button("Убрать", "link-btn small", () => {
      pollOptions.splice(index, 1);
      renderPollOptions();
    }, { label: `Убрать вариант «${option.label}»` }));
    return item;
  }) : [el("li", "admin-empty", "Добавьте варианты через поиск выше.")]));
}

function addPollOption(option) {
  const key = JSON.stringify({ t: option.titleId, c: option.characterId, g: option.genreId });
  if (pollOptions.some((item) => JSON.stringify({ t: item.titleId, c: item.characterId, g: item.genreId }) === key)) {
    return setMessage(pollMessage, "Этот вариант уже добавлен.");
  }
  if (pollOptions.length >= 16) return setMessage(pollMessage, "Не больше 16 вариантов.");
  pollOptions.push(option);
  setMessage(pollMessage, "");
  renderPollOptions();
}

/** Поиск персонажа по имени или тайтлу: /api/characters?q= */
function characterPicker() {
  const root = el("div", "picker");
  const input = el("input", "input");
  input.type = "search";
  input.placeholder = "Имя персонажа или название тайтла…";
  input.setAttribute("aria-label", "Найти персонажа");
  const list = el("div", "picker-list");
  list.hidden = true;
  root.append(input, list);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      list.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      const result = await api(`/api/characters?q=${encodeURIComponent(query)}`);
      const found = result.ok ? result.data.characters : [];
      list.replaceChildren(...(found.length ? found.slice(0, 10).map((character) => {
        const option = el("button");
        option.type = "button";
        const text = el("span");
        text.append(el("strong", null, `${character.symbol} ${character.name}`), el("small", null, character.title));
        option.append(text);
        option.addEventListener("click", () => {
          list.hidden = true;
          input.value = "";
          addPollOption({ label: `${character.name} (${character.title})`, characterId: character.id });
        });
        return option;
      }) : [el("p", "picker-empty", "Никого не нашлось. Персонажей добавляют в разделе «Тайтлы».")]));
      list.hidden = false;
    }, 200);
  });
  return root;
}

async function genrePicker() {
  if (!genreCache) {
    const result = await api("/api/admin/genres");
    genreCache = result.ok ? result.data.items : [];
  }
  const row = el("div", "admin-inline-form");
  const select = el("select", "select");
  select.setAttribute("aria-label", "Жанр");
  select.append(...genreCache.map((genre) => {
    const option = el("option", null, genre.name);
    option.value = String(genre.id);
    return option;
  }));
  row.append(select, button("Добавить жанр", "secondary-button", () => {
    const genre = genreCache.find((item) => item.id === Number(select.value));
    if (genre) addPollOption({ label: genre.name, genreId: genre.id });
  }));
  return row;
}

async function renderOptionPicker() {
  const box = $("#pollOptionPicker");
  const kind = pollKind.value;
  const parts = [];
  if (kind === "title" || kind === "versus") {
    parts.push(titlePicker({
      placeholder: "Найти тайтл…", label: "Найти тайтл для варианта",
      onPick: (title) => addPollOption({ label: title.title, titleId: title.id })
    }).root);
  }
  if (kind === "character" || kind === "versus") parts.push(characterPicker());
  if (kind === "genre") parts.push(await genrePicker());
  box.replaceChildren(...parts);
}

pollKind.addEventListener("change", () => {
  // Варианты другого вида сервер не примет: список начинается заново
  pollOptions = [];
  renderPollOptions();
  renderOptionPicker();
});

pollForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const daysValue = pollForm.elements.namedItem("days").value;
  const body = {
    kind: pollKind.value,
    question: pollForm.elements.namedItem("question").value,
    description: pollForm.elements.namedItem("description").value,
    days: daysValue ? Number(daysValue) : null,
    options: pollOptions.map(({ titleId, characterId, genreId }) => ({ titleId, characterId, genreId }))
  };
  const result = await api("/api/polls", { method: "POST", body });
  if (!result.ok) return setMessage(pollMessage, result.data?.error || "Не удалось создать голосование.");
  pollForm.reset();
  pollOptions = [];
  renderPollOptions();
  renderOptionPicker();
  setMessage(pollMessage, "Голосование создано и уже видно на Арене.", true);
  await loadPollList();
});

let polls = [];

function pollRow(poll) {
  const item = el("li", "admin-plain-item");
  const info = el("div", "admin-plain-info");
  const status = poll.status === "open"
    ? (poll.endsAt ? `открыто до ${new Date(`${poll.endsAt.replace(" ", "T")}Z`).toLocaleDateString("ru-RU")}` : "открыто без срока")
    : "закрыто";
  info.append(
    el("strong", null, poll.question),
    el("small", null, `${POLL_KIND_LABELS[poll.kind] || poll.kind} · ${status} · ${poll.total} ${plural(poll.total, "голос", "голоса", "голосов")}`),
    el("small", null, poll.options.map((option) => `${option.label}: ${option.votes}`).join(" · "))
  );
  const actions = el("div", "admin-chapter-actions");
  actions.append(button(poll.status === "open" ? "Закрыть" : "Открыть снова", "secondary-button", () => setPollStatus(poll, poll.status === "open" ? "closed" : "open")));
  actions.append(button("Удалить", "danger-button", () => deletePoll(poll)));
  item.append(info, actions);
  return item;
}

async function setPollStatus(poll, status) {
  const result = await api(`/api/polls/${poll.id}`, { method: "PATCH", body: { status } });
  if (!result.ok) return setMessage($("#pollsMessage"), result.data?.error || "Не удалось изменить голосование.");
  setMessage($("#pollsMessage"), status === "open" ? "Голосование открыто." : "Голосование закрыто.", true);
  await loadPollList();
}

async function deletePoll(poll) {
  if (!confirm(`Удалить голосование «${poll.question}» вместе со всеми голосами?`)) return;
  const result = await api(`/api/polls/${poll.id}`, { method: "DELETE" });
  if (!result.ok) return setMessage($("#pollsMessage"), result.data?.error || "Не удалось удалить голосование.");
  setMessage($("#pollsMessage"), "Голосование удалено.", true);
  await loadPollList();
}

async function loadPollList() {
  const result = await api("/api/polls");
  if (!result.ok) return setMessage($("#pollsMessage"), result.data?.error || "Не удалось загрузить голосования.");
  polls = result.data.polls;
  $("#pollList").replaceChildren(...(polls.length ? polls.map(pollRow) : [empty("Голосований пока нет.")]));
}

let pollsReady = false;

export async function loadPolls() {
  if (!pollsReady) {
    pollsReady = true;
    renderPollOptions();
    await renderOptionPicker();
  }
  await loadPollList();
}

// ==================== ПОДБОРКИ ====================

async function updateCollection(collection, change, done) {
  const result = await api(`/api/admin/collections/${collection.id}`, { method: "PUT", body: change });
  const message = $("#collectionsMessage");
  if (!result.ok) return setMessage(message, result.data?.error || "Не удалось изменить подборку.");
  setMessage(message, `«${collection.name}»: ${done}.`, true);
  await loadCollections();
}

function collectionRow(collection) {
  const item = el("li", `admin-plain-item${collection.hidden ? " is-muted" : ""}`);
  const info = el("div", "admin-plain-info");
  const name = el("strong");
  name.append(link(`/collection/${collection.id}`, null, collection.name));
  const tags = el("span", "admin-tags");
  if (collection.featured) tags.append(el("span", "admin-tag is-admin", "На главной"));
  if (collection.hidden) tags.append(el("span", "admin-tag is-blocked", "Скрыта"));
  if (!collection.isPublic) tags.append(el("span", "admin-tag", "Личная"));
  info.append(name, tags, el("small", null, `${collection.author} · ${collection.size} ${plural(collection.size, "тайтл", "тайтла", "тайтлов")} · обновлена ${timeAgo(collection.updatedAt)}`));
  const actions = el("div", "admin-chapter-actions");
  if (collection.isPublic && !collection.hidden) {
    actions.append(collection.featured
      ? button("Убрать с главной", "secondary-button", () => updateCollection(collection, { featured: false }, "убрана с главной"))
      : button("На главную", "secondary-button", () => updateCollection(collection, { featured: true }, "теперь на главной")));
  }
  actions.append(collection.hidden
    ? button("Показать", "secondary-button", () => updateCollection(collection, { hidden: false }, "снова видна"))
    : button("Скрыть", "danger-button", () => updateCollection(collection, { hidden: true }, "скрыта")));
  item.append(info, actions);
  return item;
}

export async function loadCollections() {
  const result = await api("/api/admin/collections");
  if (!result.ok) return setMessage($("#collectionsMessage"), result.data?.error || "Не удалось загрузить подборки.");
  const { collections } = result.data;
  $("#collectionList").replaceChildren(...(collections.length ? collections.map(collectionRow) : [empty("Подборок пока нет.")]));
}

