// Панель аккаунта (/account): обзор, персонажи, достижения, семья, настройки, безопасность

import { api, avatar, el, errorBox, formatDate, getConfig, getMe, initHeader, loginUrl, toast } from "./app.js";

const $ = (selector) => document.querySelector(selector);
const S = (selector) => document.querySelectorAll(selector);

const TAB_ORDER = ["overview", "characters", "achievements", "family", "settings", "security"];

let me = null;
let profile = null;
let settings = null;
let achievements = [];
let sessions = [];
let L = {}; // локализованные строки из /api/config

function T(key) {
  return L[key] || key;
}

// ==================== РЕНДЕР: ОБЗОР ====================

function renderOverview() {
  if (!me || !profile) return;

  $("#playerAvatar").replaceChildren(avatar({ ...me, avatar: profile.avatar, avatarColor: profile.avatarColor }, "avatar-lg"));
  $("#playerName").textContent = me.name;
  $("#playerId").textContent = `ID ${me.username || me.id}`;
  $("#playerSince").textContent = `${T("accountPlayerSince")} ${formatDate(me.createdAt)}`;
  $("#playerStatus").textContent = T("accountPlayerStatus");
  $("#playerProvider").textContent = me.viaEndemionId ? T("accountProviderEndemionId") : T("accountProviderLocal");
  $("#accountTitle").textContent = me.name;

  const stats = me.stats || {};
  const statItems = [
    { value: stats.achievements ?? "—", label: T("accountStatsAchievements") },
    { value: stats.topics ?? "—", label: T("accountStatsTopics") },
    { value: stats.posts ?? "—", label: T("accountStatsPosts") },
    { value: stats.followers ?? "—", label: T("accountStatsFollowing") },
  ];

  const statGrid = $("#accountStats");
  statGrid.replaceChildren(
    ...statItems.map((item) => {
      const box = el("div", "stat-item");
      box.append(el("strong", "stat-value", String(item.value)), el("span", "stat-label", item.label));
      return box;
    })
  );

  const hasData = Object.values(stats).some((v) => v !== null && v !== "");
  $("#accountStatsEmpty").hidden = hasData || statGrid.children.length > 0;
}

// ==================== РЕНДЕР: ДОСТИЖЕНИЯ ====================

async function renderAchievements() {
  const box = $("#accountAchievements");
  const result = await api("/api/me/achievements");
  if (!result.ok) {
    box.replaceChildren(errorBox(`${T("accountStatsEmptyTitle")}. ${result.data?.error || ""}`, renderAchievements));
    return;
  }
  achievements = result.data.achievements || [];

  if (!achievements.length) {
    box.replaceChildren(el("div", "account-empty",
      el("span", "empty-icon", "🏆"),
      el("strong", null, T("accountStatsEmptyTitle")),
      el("p", null, T("accountStatsEmptyText"))
    ));
    return;
  }

  box.replaceChildren(...achievements.map((item) => {
    const card = el("div", `achievement-card${item.earnedAt ? "" : " is-locked"}`);
    card.append(el("span", "achievement-icon", item.icon || "✦"));
    card.append(el("h4", null, item.name));
    card.append(el("p", null, item.description));
    const meta = el("span", `achievement-meta ${item.earnedAt ? "earned" : "locked"}`);
    meta.textContent = item.earnedAt
      ? `${T("accountAchievementEarned")} ${formatDate(item.earnedAt)}`
      : T("accountAchievementLocked");
    card.append(meta);
    return card;
  }));
}

// ==================== РЕНДЕР: БЕЗОПАСНОСТЬ (СЕССИИ) ====================

async function renderSecurity() {
  const result = await api("/api/me/sessions");
  if (!result.ok) return;
  sessions = result.data.sessions || [];

  const list = $("#securitySessions");
  list.replaceChildren();

  const current = sessions.find((s) => s.current);
  if (current) {
    $("#securitySessionsHint").textContent = `${T("accountSecuritySessionCurrent")}: ${formatDate(current.createdAt)}`;
  }

  if (!sessions.length) {
    list.replaceChildren(el("div", "account-empty",
      el("span", "empty-icon", "🔐"),
      el("strong", null, T("accountSecurityNoSessions"))
    ));
    return;
  }

  for (const session of sessions) {
    const row = el("div", `session-row${session.current ? " current" : ""}`);
    const info = el("div", "session-info");
    info.append(
      el("div", "session-label", session.current ? T("accountSecuritySessionCurrent") : session.id),
      el("div", "session-meta", `${formatDate(session.createdAt)} · до ${formatDate(session.expiresAt)}`)
    );
    const actions = el("div", "session-actions");
    if (!session.current) {
      const btn = el("button", `session-btn terminate`, T("accountSecuritySessionTerminate"));
      btn.type = "button";
      btn.addEventListener("click", () => terminateSession(session.id));
      actions.append(btn);
    }
    row.append(info, actions);
    list.append(row);
  }
}

async function terminateSession(sessionId) {
  const result = await api("/api/me/sessions", {
    method: "DELETE",
    body: { sessionId }
  });
  if (!result.ok) {
    toast(result.data?.error || T("accountSecuritySessionNotFound"));
    return;
  }
  toast(T("accountSecuritySessionDeleted"));
  renderSecurity();
}

// ==================== РЕНДЕР: НАСТРОЙКИ ====================

async function renderSettings() {
  if (!me || !profile || !settings) return;

  $("#accountName").value = me.name;
  $("#accountNameHint").textContent = me.viaEndemionId ? T("accountNameHintEndemionId") : "";
  if (me.viaEndemionId) {
    $("#accountName").readOnly = true;
    $("#accountName").style.background = "transparent";
  }

  $("#accountBio").value = profile.bio || "";

  const colors = ["violet", "blue", "pink", "teal", "amber", "crimson"];
  $("#accountColorOptions").replaceChildren(...colors.map((color) => {
    const label = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "avatarColor";
    radio.value = color;
    radio.checked = profile.avatarColor === color;
    radio.setAttribute("aria-label", color);
    label.append(radio, avatar({ name: me.name, avatarColor: color }));
    return label;
  }));

  $("#accountAvatarRemove").hidden = !profile.avatar;

  $("#accountPrivacyForm").elements.namedItem("isPublic").checked = settings.isPublic;
  $("#accountPrivacyForm").elements.namedItem("showActivity").checked = settings.showActivity;

  $("#accountNotifyForm").elements.namedItem("replies").checked = settings.notify.replies;
  $("#accountNotifyForm").elements.namedItem("follows").checked = settings.notify.follows;
  $("#accountNotifyForm").elements.namedItem("achievements").checked = settings.notify.achievements;

  if (me.viaEndemionId) {
    $("#accountEndemionIdSettings").hidden = false;
    const { endemionId } = await getConfig();
    if (endemionId) $("#accountEndemionIdLink").href = endemionId.account;
  }
}

// ==================== ФОРМЫ ====================

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.className = "form-message" + (success ? " success" : "");
}

$("#accountProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#accountProfileMessage");
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = T("accountSubmitSaving");

  const fields = {};
  if (!me.viaEndemionId) {
    const name = $("#accountName").value.trim();
    if (name !== me.name) fields.name = name;
  }
  fields.bio = $("#accountBio").value;
  const color = $("#accountProfileForm").querySelector('input[name="avatarColor"]:checked')?.value || profile.avatarColor;
  fields.avatarColor = color;

  const saved = await api("/api/me/profile", { method: "PATCH", body: fields });
  if (!me.viaEndemionId && fields.name && saved.ok) {
    const renamed = await api("/api/me", { method: "PATCH", body: { name: fields.name } });
    if (!renamed.ok) return setMessage(message, renamed.data?.error || T("accountProfileSaveError"));
    me.name = renamed.data.user.name;
    $("#playerName").textContent = me.name;
  }
  submit.disabled = false;
  submit.textContent = T("accountSettingsSaveProfile");
  if (!saved.ok) return setMessage(message, saved.data?.error || T("accountProfileSaveError"));
  const result = await api("/api/me/profile");
  if (result.ok) {
    profile = result.data.profile;
    settings = result.data.settings;
    renderOverview();
  }
  setMessage(message, T("accountProfileSaved"), true);
});

$("#accountAvatarInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const message = $("#accountProfileMessage");
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) return setMessage(message, T("accountAvatarValidationType"));
  if (file.size > 2 * 1024 * 1024) return setMessage(message, T("accountAvatarValidationSize"));
  setMessage(message, T("accountAvatarUploading"));
  let response = null;
  try {
    response = await fetch("/api/me/avatar", { method: "PUT", body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
  } catch {}
  const data = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return setMessage(message, data?.error || T("accountAvatarLoadError"));
  profile.avatar = data.avatar;
  renderOverview();
  renderSettings();
  setMessage(message, T("accountAvatarLoaded"), true);
});

$("#accountAvatarRemove").addEventListener("click", async () => {
  const result = await api("/api/me/avatar", { method: "DELETE" });
  if (!result.ok) return setMessage($("#accountProfileMessage"), result.data?.error || T("accountAvatarRemoveError"));
  profile.avatar = null;
  renderOverview();
  renderSettings();
  setMessage($("#accountProfileMessage"), T("accountAvatarRemoved"), true);
});

$("#accountPrivacyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#accountPrivacyMessage");
  const form = event.currentTarget;
  const body = { isPublic: form.elements.namedItem("isPublic").checked, showActivity: form.elements.namedItem("showActivity").checked };
  const saved = await api("/api/me/profile", { method: "PATCH", body });
  if (!saved.ok) return setMessage(message, saved.data?.error || T("accountSaveFailed"));
  settings = saved.data.settings;
  setMessage(message, settings.isPublic ? T("accountPrivacyPublicText") : T("accountPrivacyPrivateText"), true);
});

$("#accountNotifyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#accountNotifyMessage");
  const form = event.currentTarget;
  const body = { notify: { replies: form.elements.namedItem("replies").checked, follows: form.elements.namedItem("follows").checked, achievements: form.elements.namedItem("achievements").checked } };
  const saved = await api("/api/me/profile", { method: "PATCH", body });
  if (!saved.ok) return setMessage(message, saved.data?.error || T("accountNotifySaveError"));
  settings = saved.data.settings;
  setMessage(message, T("accountNotifySaved"), true);
});

// ==================== ВКЛАДКИ ====================

const tabs = S("[role=tab]");
const panels = S("[data-panel]");

function openTab(name) {
  const tab = TAB_ORDER.includes(name) ? name : "overview";
  tabs.forEach((node) => {
    const active = node.dataset.tab === tab;
    node.setAttribute("aria-selected", String(active));
    node.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel) => (panel.hidden = panel.dataset.panel !== tab));
  history.replaceState(null, "", `#${tab}`);

  window.scrollTo(0, 0);
  if (tab === "overview") renderOverview();
  else if (tab === "achievements") renderAchievements();
  else if (tab === "security") renderSecurity();
  else if (tab === "settings") renderSettings();
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => openTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    openTab(next.dataset.tab);
  });
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

async function init() {
  await initHeader();

  const meResult = await getMe();
  if (!meResult.user) {
    // Гость (сервер ответил 200 без пользователя) уходит на вход. Сетевой сбой или ошибка сервера
    // не должны выкидывать со страницы: переход на /auth ломал бы и саму навигацию
    const status = meResult.status || 0;
    if (status === 0 || status >= 500) {
      document.getElementById("account").after(errorBox("Не удалось загрузить панель. Обновите страницу."));
      return;
    }
    location.replace(loginUrl());
    return;
  }
  me = meResult.user;

  const config = await getConfig();
  L = config.account || {};

  const profileResult = await api("/api/me/profile");
  if (profileResult.ok) {
    profile = profileResult.data.profile;
    settings = profileResult.data.settings;
  }

  renderOverview();
  await renderSettings();

  // Переключатель языка: перезагружает страницу, сервер отдаст нужный язык
  const langToggle = document.querySelector("[data-lang-toggle]");
  if (langToggle) {
    langToggle.addEventListener("click", () => {
      const current = document.documentElement.lang;
      const next = current === "ru" ? "en" : "ru";
      document.cookie = `lang=${next}; path=/; SameSite=Lax`;
      location.reload();
    });
  }

  $("#accountLogout").addEventListener("click", async () => {
    const result = await api("/api/auth/logout", { method: "POST", body: {} });
    const redirect = result.data?.redirect;
    location.href = typeof redirect === "string" && redirect.startsWith("https://") ? redirect : "/";
  });

  $("#playerEdit").addEventListener("click", () => {
    openTab("settings");
  });

  const hash = location.hash.slice(1);
  if (TAB_ORDER.includes(hash)) openTab(hash);
  else openTab("overview");

  document.getElementById("account").hidden = false;
}

init();
