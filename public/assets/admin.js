// Админка: сводка, жалобы, пользователи и журнал действий. Разделы портала — в admin-studio.js, модерация — в admin-community.js.
// Права проверяет сервер в каждом запросе /api/admin/*, эта страница только показывает формы.
// Модератор видит только модерацию

import { api, getMe, loginUrl } from "./app.js";
import { loadModeration, loadPlatformStats, loadReports } from "./admin-community.js";
import { initStudioAdmin, loadForumCategories, loadGames, loadSiteSettings, loadStudioPosts } from "./admin-studio.js";

const $ = (selector) => document.querySelector(selector);

const adminLayout = $("#admin");
const denied = $("#denied");
// Задержка поиска пользователей после ввода, мс
const SEARCH_DELAY = 250;

// Вошедший администратор: свой аккаунт в разделе «Пользователи» менять нельзя
let me = null;

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function formatDate(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Дата и время в часовом поясе администратора */
function formatDateTime(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

// ==================== РАЗДЕЛЫ ====================

const SECTIONS = ["dashboard", "games", "studio", "forum-categories", "site-settings", "moderation", "complaints", "users", "audit"];
const MODERATOR_SECTIONS = ["moderation"];

/** Разделы, доступные вошедшему: модератору — только модерация */
const allowedSections = () => (me?.isAdmin ? SECTIONS : MODERATOR_SECTIONS);

function showSection(name) {
  document.querySelectorAll("[data-panel]").forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
  document.querySelectorAll("[data-section]").forEach((link) => {
    if (link.dataset.section === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

/** Адрес #раздел открывает раздел. После обновления страницы остаёшься там же */
async function route() {
  const name = location.hash.slice(1).split("/")[0];
  const allowed = allowedSections();
  const section = allowed.includes(name) ? name : allowed[0];
  showSection(section);

  if (section === "dashboard") loadDashboard();
  if (section === "games") loadGames();
  if (section === "studio") loadStudioPosts();
  if (section === "forum-categories") loadForumCategories();
  if (section === "site-settings") loadSiteSettings();
  if (section === "moderation") loadModeration();
  if (section === "complaints") loadComplaints();
  if (section === "users") loadUsers();
  if (section === "audit") loadAudit();
}

window.addEventListener("hashchange", route);

// ==================== СВОДКА ====================

const statsBox = $("#stats");
const recentAudit = $("#recentAudit");

function statCard(label, value, note, alert = false) {
  const card = element("div", `admin-stat${alert ? " is-alert" : ""}`);
  card.append(element("span", null, label), element("strong", null, String(value)), element("small", null, note));
  return card;
}

async function loadDashboard() {
  loadPlatformStats();
  const [stats, recent] = await Promise.all([api("/api/admin/stats"), api("/api/admin/audit?limit=8")]);
  if (!stats.ok) {
    setMessage($("#statsMessage"), stats.data?.error || "Не удалось загрузить сводку.");
  } else {
    setMessage($("#statsMessage"), "");
    const { users, content, complaints, storage } = stats.data;
    statsBox.replaceChildren(
      statCard("Пользователи", users.total, `+${users.week} за 7 дней · +${users.month} за 30 дней`),
      statCard("Администраторы", users.admins, users.blocked ? `заблокировано: ${users.blocked}` : "заблокированных нет"),
      statCard("Игры", content.games, `опубликовано: ${content.publishedGames}`),
      statCard("Публикации студии", content.posts, `черновиков: ${content.drafts}`),
      statCard("Новые жалобы", complaints.new, `всего: ${complaints.total}`, complaints.new > 0),
      storage
        ? statCard("Файлы в R2", `${storage.complete ? "" : "больше "}${formatBytes(storage.bytes)}`, `файлов: ${storage.files}`)
        : statCard("Файлы в R2", "—", "хранилище не подключено")
    );
    updateComplaintsBadge(complaints.new);
  }
  renderAudit(recentAudit, recent.ok ? recent.data.entries : []);
}

// ==================== ЖАЛОБЫ ====================

const complaintList = $("#complaintList");
const complaintsMessage = $("#complaintsMessage");
const complaintsBadge = $("#complaintsBadge");
const COMPLAINT_LABELS = { new: "Новая", resolved: "Материал удалён", rejected: "Отклонена" };
let complaints = [];

function updateComplaintsBadge(count) {
  complaintsBadge.hidden = !count;
  complaintsBadge.textContent = String(count);
  complaintsBadge.setAttribute("aria-label", `новых: ${count}`);
}

function complaintRow(complaint) {
  const item = element("li", `admin-complaint${complaint.status === "new" ? " is-new" : ""}`);

  const header = element("header");
  header.append(
    element("strong", null, `№${complaint.id} · ${COMPLAINT_LABELS[complaint.status]}`),
    element("small", null, formatDate(complaint.createdAt))
  );

  // Текст жалобы пришёл от посетителя сайта: только textContent, никакого HTML
  const details = element("dl");
  const add = (label, value) => {
    const dd = element("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    details.append(element("dt", null, label), dd);
  };
  add("Заявитель", complaint.name);
  const mail = element("a", null, complaint.email);
  mail.href = `mailto:${encodeURIComponent(complaint.email).replace("%40", "@")}`;
  add("Почта", mail);
  add("Правообладатель", complaint.rightholder);
  add("Произведение", complaint.work);
  const links = element("div");
  for (const href of complaint.links) {
    // Сервер принимает только ссылки на этот сайт, но открываем их всё равно без доступа к этой вкладке
    const link = element("a", null, href);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.append(link, element("br"));
  }
  add("Ссылки", links);

  const actions = element("div", "admin-chapter-actions");
  for (const [status, label] of Object.entries(COMPLAINT_LABELS)) {
    if (status === complaint.status) continue;
    const text = status === "new" ? "Вернуть в новые" : label;
    actions.append(button(text, "secondary-button", () => setComplaintStatus(complaint, status)));
  }
  actions.append(button("Удалить жалобу", "danger-button", () => deleteComplaint(complaint)));

  item.append(header, details, element("p", "admin-complaint-text", complaint.description), actions);
  return item;
}

function renderComplaints() {
  const fresh = complaints.filter((complaint) => complaint.status === "new").length;
  $("#complaintsHeading").textContent = fresh ? `Жалобы правообладателей (новых: ${fresh})` : "Жалобы правообладателей";
  updateComplaintsBadge(fresh);
  complaintList.replaceChildren(
    ...(complaints.length ? complaints.map(complaintRow) : [element("li", "admin-empty", "Жалоб нет.")])
  );
}

async function loadComplaints() {
  const result = await api("/api/admin/complaints");
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось загрузить жалобы.");
  complaints = result.data.complaints;
  renderComplaints();
}

async function setComplaintStatus(complaint, status) {
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "PUT", body: { status } });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось изменить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id}: ${COMPLAINT_LABELS[status].toLowerCase()}.`, true);
  await loadComplaints();
}

async function deleteComplaint(complaint) {
  if (!confirm(`Удалить жалобу №${complaint.id} с данными заявителя? Это нельзя отменить.`)) return;
  const result = await api(`/api/admin/complaints/${complaint.id}`, { method: "DELETE" });
  if (!result.ok) return setMessage(complaintsMessage, result.data?.error || "Не удалось удалить жалобу.");
  setMessage(complaintsMessage, `Жалоба №${complaint.id} удалена.`, true);
  await loadComplaints();
}

// ==================== ПОДТВЕРЖДЕНИЕ ПАРОЛЕМ ====================

const passwordDialog = $("#passwordDialog");
const passwordInput = $("#passwordInput");

/** Пароль администратора для опасного действия или null, если окно закрыли. Проверяет пароль сервер */
function askPassword(text) {
  return new Promise((resolve) => {
    $("#passwordDialogText").textContent = text;
    $("#passwordUsername").value = me.email;
    passwordInput.value = "";
    passwordDialog.returnValue = "";
    passwordDialog.addEventListener("close", () => {
      const value = passwordDialog.returnValue === "confirm" ? passwordInput.value : null;
      // Пароль не остаётся в поле после закрытия окна
      passwordInput.value = "";
      resolve(value || null);
    }, { once: true });
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

// ==================== ПОЛЬЗОВАТЕЛИ ====================

const userList = $("#userList");
const userSearch = $("#userSearch");
const userFilter = $("#userFilter");
const usersMessage = $("#usersMessage");
const usersMore = $("#usersMore");
const USERS_PAGE = 50;
let users = [];
let usersTotal = 0;
// Ответ на устаревший запрос (фильтр успели сменить) отбрасывается
let usersRequest = 0;

function usersUrl(offset) {
  const params = new URLSearchParams({ filter: userFilter.value, limit: String(USERS_PAGE), offset: String(offset) });
  const query = userSearch.value.trim();
  if (query) params.set("q", query);
  return `/api/admin/users?${params}`;
}

function tag(text, className = "") {
  return element("span", `admin-tag ${className}`.trim(), text);
}

function userRow(user) {
  const item = element("li", `admin-user${user.blockedAt ? " is-blocked" : ""}`);

  const info = element("div", "admin-user-info");
  const name = element("strong", null, user.name);
  const tags = element("span", "admin-tags");
  if (user.id === me.id) tags.append(tag("Это вы", "is-self"));
  if (user.isAdmin) tags.append(tag("Администратор", "is-admin"));
  if (user.role === "moderator") tags.append(tag("Модератор", "is-moderator"));
  if (user.blockedAt) tags.append(tag(`Заблокирован ${formatDate(user.blockedAt)}`, "is-blocked"));
  if (user.mutedUntil && new Date(`${user.mutedUntil.replace(" ", "T")}Z`) > new Date()) {
    tags.append(tag(`Без публикаций до ${formatDate(user.mutedUntil)}`, "is-blocked"));
  }
  info.append(
    name,
    tags,
    element("small", null, user.email),
    element("small", null, `#${user.id} · с ${formatDate(user.createdAt)} · сеансов: ${user.sessions} · комментариев: ${user.comments}`)
  );

  const actions = element("div", "admin-chapter-actions");
  // Свой аккаунт меняется только в профиле: так нельзя случайно снять права с себя
  if (user.id !== me.id) {
    if (user.blockedAt) {
      actions.append(button("Разблокировать", "secondary-button", () => userAction(user, "unblock")));
    } else if (!user.isAdmin) {
      actions.append(button("Заблокировать", "secondary-button", () => userAction(user, "block")));
    }
    if (user.sessions > 0) actions.append(button("Завершить сеансы", "secondary-button", () => userAction(user, "logout")));
    if (user.isAdmin) actions.append(button("Снять права администратора", "secondary-button", () => userAction(user, "revokeAdmin")));
    else if (!user.blockedAt) actions.append(button("Сделать администратором", "secondary-button", () => userAction(user, "grantAdmin")));
    if (user.role === "moderator") actions.append(button("Снять права модератора", "secondary-button", () => setRole(user, "user")));
    else if (user.role === "user" && !user.blockedAt) actions.append(button("Сделать модератором", "secondary-button", () => setRole(user, "moderator")));
    if (user.mutedUntil && new Date(`${user.mutedUntil.replace(" ", "T")}Z`) > new Date()) {
      actions.append(button("Снять ограничение", "secondary-button", () => unmute(user)));
    }
    if (!user.isAdmin) actions.append(button("Удалить аккаунт", "danger-button", () => deleteUser(user)));
  }

  item.append(info, actions);
  return item;
}

function renderUsers() {
  $("#userCount").textContent = `Найдено: ${usersTotal}`;
  userList.replaceChildren(...(users.length ? users.map(userRow) : [element("li", "admin-empty", "Никого не найдено.")]));
  usersMore.hidden = users.length >= usersTotal;
}

async function loadUsers() {
  const id = ++usersRequest;
  const result = await api(usersUrl(0));
  if (id !== usersRequest) return;
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось загрузить пользователей.");
  users = result.data.users;
  usersTotal = result.data.total;
  renderUsers();
}

usersMore.addEventListener("click", async () => {
  const id = usersRequest;
  usersMore.disabled = true;
  const result = await api(usersUrl(users.length));
  usersMore.disabled = false;
  if (id !== usersRequest) return;
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось загрузить пользователей.");
  // Пока листали, могли зарегистрироваться новые пользователи: повторы убираем
  const known = new Set(users.map((user) => user.id));
  users = [...users, ...result.data.users.filter((user) => !known.has(user.id))];
  usersTotal = result.data.total;
  renderUsers();
});

let userSearchTimer = null;
userSearch.addEventListener("input", () => {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(loadUsers, SEARCH_DELAY);
});
userFilter.addEventListener("change", loadUsers);

const USER_ACTIONS = {
  block: { confirm: (user) => `Заблокировать ${user.email}? Все сеансы пользователя сразу завершатся, войти он не сможет.`, done: "заблокирован" },
  unblock: { done: "разблокирован" },
  logout: { confirm: (user) => `Завершить все сеансы ${user.email}? На всех устройствах нужно будет войти заново.`, done: "сеансы завершены" },
  grantAdmin: { password: (user) => `Выдать ${user.email} права администратора? У него будет доступ ко всей админке.`, done: "теперь администратор" },
  revokeAdmin: { password: (user) => `Снять с ${user.email} права администратора?`, done: "больше не администратор" }
};

function replaceUser(saved) {
  users = users.map((user) => (user.id === saved.id ? saved : user));
  renderUsers();
}

async function userAction(user, action) {
  const config = USER_ACTIONS[action];
  if (config.confirm && !confirm(config.confirm(user))) return;
  let password;
  if (config.password) {
    password = await askPassword(config.password(user));
    if (!password) return;
  }
  const result = await api(`/api/admin/users/${user.id}`, { method: "PUT", body: { action, password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось выполнить действие.");
  replaceUser(result.data.user);
  setMessage(usersMessage, `${user.email}: ${config.done}.`, true);
}

const ROLE_TEXTS = {
  moderator: { ask: (user) => `Сделать ${user.email} модератором? Он сможет скрывать контент, разбирать жалобы и вести голосования.`, done: "теперь модератор" },
  user: { ask: (user) => `Снять с ${user.email} права модератора?`, done: "больше не модератор" }
};

async function setRole(user, role) {
  const text = ROLE_TEXTS[role];
  const password = await askPassword(text.ask(user));
  if (!password) return;
  const result = await api(`/api/admin/users/${user.id}/role`, { method: "PUT", body: { role, password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось изменить роль.");
  replaceUser(result.data.user);
  setMessage(usersMessage, `${user.email}: ${text.done}.`, true);
}

async function unmute(user) {
  const result = await api(`/api/moderation/users/${user.id}/unmute`, { method: "POST" });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось снять ограничение.");
  replaceUser({ ...user, mutedUntil: null });
  setMessage(usersMessage, `${user.email}: публиковать снова можно.`, true);
}

async function deleteUser(user) {
  if (!confirm(`Удалить аккаунт ${user.email} вместе с полкой и прогрессом? Это нельзя отменить.`)) return;
  const password = await askPassword(`Удаление аккаунта ${user.email}.`);
  if (!password) return;
  const result = await api(`/api/admin/users/${user.id}`, { method: "DELETE", body: { password } });
  if (!result.ok) return setMessage(usersMessage, result.data?.error || "Не удалось удалить аккаунт.");
  users = users.filter((item) => item.id !== user.id);
  usersTotal = Math.max(0, usersTotal - 1);
  renderUsers();
  setMessage(usersMessage, `Аккаунт ${user.email} удалён.`, true);
}

// ==================== ЖУРНАЛ ====================

const auditList = $("#auditList");
const auditGroup = $("#auditGroup");
const auditMessage = $("#auditMessage");
const auditMore = $("#auditMore");
const AUDIT_PAGE = 50;
let auditEntries = [];
let auditTotal = 0;
let auditRequest = 0;

// Коды действий пишет сервер (functions/_lib/audit.js и обработчики /api/admin/*)
const ACTION_LABELS = {
  "game.create": "новая игра",
  "game.update": "изменение игры",
  "game.delete": "удаление игры",
  "game.cover": "обложка игры",
  "game.coverDelete": "удаление обложки игры",
  "game.shot": "новый скриншот",
  "game.shotDelete": "удаление скриншота",
  "post.create": "новая публикация",
  "post.update": "изменение публикации",
  "post.published": "публикация опубликована",
  "post.draft": "публикация в черновики",
  "post.archived": "публикация в архив",
  "post.delete": "удаление публикации",
  "post.image": "картинка публикации",
  "post.imageDelete": "удаление картинки публикации",
  "forum.create": "новая категория форума",
  "forum.update": "изменение категории форума",
  "forum.delete": "удаление категории форума",
  "settings.update": "настройки сайта",
  "complaint.new": "жалоба возвращена в новые",
  "complaint.resolved": "жалоба: материал удалён",
  "complaint.rejected": "жалоба отклонена",
  "complaint.delete": "удаление жалобы",
  "user.block": "блокировка",
  "user.unblock": "разблокировка",
  "user.logout": "завершение сеансов",
  "user.grantAdmin": "выдача прав администратора",
  "user.revokeAdmin": "снятие прав администратора",
  "user.role.user": "роль: читатель",
  "user.role.moderator": "роль: модератор",
  "user.role.admin": "роль: администратор",
  "user.delete": "удаление аккаунта"
};

function auditRow(entry) {
  const item = element("li", "admin-audit-entry");
  const label = ACTION_LABELS[entry.action] || entry.action;
  const what = element("span");
  what.append(element("strong", null, label.charAt(0).toUpperCase() + label.slice(1)), ` · ${entry.target}`);
  item.append(element("time", null, formatDateTime(entry.createdAt)), what, element("small", null, entry.actorName));
  item.querySelector("time").dateTime = `${entry.createdAt.replace(" ", "T")}Z`;
  return item;
}

function renderAudit(list, entries) {
  list.replaceChildren(...(entries.length ? entries.map(auditRow) : [element("li", "admin-empty", "Записей пока нет.")]));
}

function auditUrl(offset) {
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE), offset: String(offset) });
  if (auditGroup.value) params.set("group", auditGroup.value);
  return `/api/admin/audit?${params}`;
}

async function loadAudit() {
  const id = ++auditRequest;
  const result = await api(auditUrl(0));
  if (id !== auditRequest) return;
  if (!result.ok) return setMessage(auditMessage, result.data?.error || "Не удалось загрузить журнал.");
  auditEntries = result.data.entries;
  auditTotal = result.data.total;
  renderAudit(auditList, auditEntries);
  auditMore.hidden = auditEntries.length >= auditTotal;
}

auditMore.addEventListener("click", async () => {
  const id = auditRequest;
  auditMore.disabled = true;
  const result = await api(auditUrl(auditEntries.length));
  auditMore.disabled = false;
  if (id !== auditRequest) return;
  if (!result.ok) return setMessage(auditMessage, result.data?.error || "Не удалось загрузить журнал.");
  // Новые записи сдвигают страницы: повторы убираем
  const known = new Set(auditEntries.map((entry) => entry.id));
  auditEntries = [...auditEntries, ...result.data.entries.filter((entry) => !known.has(entry.id))];
  auditTotal = result.data.total;
  renderAudit(auditList, auditEntries);
  auditMore.hidden = auditEntries.length >= auditTotal;
});

auditGroup.addEventListener("change", loadAudit);

// ==================== СТАРТ ====================

async function init() {
  const { user } = await getMe();
  if (!user) {
    location.replace(loginUrl());
    return;
  }
  if (!user.isAdmin && !user.isModerator) {
    denied.hidden = false;
    return;
  }
  me = user;
  initStudioAdmin();

  if (!user.isAdmin) {
    // Модератору не нужны разделы администратора: эти запросы сервер ему всё равно отклонит
    document.querySelectorAll("[data-admin-only]").forEach((node) => node.remove());
    adminLayout.hidden = false;
    loadReports();
    await route();
    return;
  }

  adminLayout.hidden = false;
  // Значки новых жалоб в меню видны в любом разделе
  loadComplaints();
  loadReports();
  await route();
}

init();
