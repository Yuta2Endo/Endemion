// Разделы админки для сообщества: сводка форума и модерация жалоб пользователей.
// Права проверяет сервер: модератору доступна модерация, сводка — администратору

import { api, button, el, link, plural, timeAgo } from "./app.js";

const $ = (selector) => document.querySelector(selector);

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function empty(text) {
  return el("li", "admin-empty", text);
}

// ==================== СВОДКА СООБЩЕСТВА ====================

function statCard(label, value, note, alert = false) {
  const card = el("div", `admin-stat${alert ? " is-alert" : ""}`);
  card.append(el("span", null, label), el("strong", null, String(value)), el("small", null, note));
  return card;
}

export async function loadPlatformStats() {
  const box = $("#platformStats");
  const result = await api("/api/admin/platform-stats");
  if (!result.ok) {
    box.replaceChildren(el("p", "form-message", result.data?.error || "Не удалось загрузить статистику сообщества."));
    return;
  }
  const s = result.data;
  box.replaceChildren(
    statCard("Темы форума", s.threads, `за 7 дней: ${s.threads_week}`),
    statCard("Ответы", s.comments, `за 7 дней: ${s.comments_week}`),
    statCard("Подписки", s.follows, "между участниками"),
    statCard("Жалобы пользователей", s.reports_open, s.muted ? `с ограничением: ${s.muted}` : "ограничений нет", s.reports_open > 0)
  );
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

// В журнале остаются записи о контенте прежних разделов (тайтлы, подборки, Арена): подписи нужны и для них
const COMMENT_PLACES = { thread: "тема", title: "тайтл", collection: "подборка", review: "рецензия", tournament: "турнир", chapter: "глава" };

async function loadComments() {
  const list = $("#recentComments");
  const result = await api("/api/moderation/comments");
  if (!result.ok) return setMessage($("#recentCommentsMessage"), result.data?.error || "Не удалось загрузить комментарии.");
  list.replaceChildren(...(result.data.comments.length ? result.data.comments.slice(0, 20).map((comment) => {
    const item = el("li", "admin-plain-item");
    const info = el("div", "admin-plain-info");
    const author = comment.author
      ? (comment.author.username ? link(`/users/${comment.author.username}`, null, comment.author.name) : el("span", null, comment.author.name))
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
