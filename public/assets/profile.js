// ENDEMION ID — свой профиль: активность на форуме, достижения,
// настройки профиля, аватар, приватность, смена пароля, выход и удаление аккаунта

import { api, avatar, el, errorBox, formatDate, getConfig, getMe, initHeader, link, loginUrl } from "./app.js";

const $ = (selector) => document.querySelector(selector);
const COLORS = ["violet", "blue", "pink", "teal", "amber", "crimson"];
const MAX_AVATAR = 2 * 1024 * 1024;

let me = null;
let profile = null;
let settings = null;

function setMessage(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("is-success", success);
}

// ==================== ШАПКА ПРОФИЛЯ ====================

function renderHead() {
  $("#avatar").replaceChildren(avatar({ ...me, avatar: profile.avatar, avatarColor: profile.avatarColor }, "avatar-lg"));
  $("#profileName").textContent = me.name;
  const handle = $("#profileHandle");
  handle.textContent = `@${profile.username}`;
  handle.href = `/users/${encodeURIComponent(profile.username)}`;
  $("#publicLink").href = handle.href;
  $("#profileEmail").textContent = me.email;
  $("#profileBio").textContent = profile.bio || "";
  $("#profileSince").textContent = `С нами с ${formatDate(me.createdAt)}${settings.isPublic ? "" : " · профиль скрыт"}`;
  $("#usernameHint").value = me.email;
  // Ссылка только для удобства: права на /admin и /api/admin/* проверяет сервер
  $("#adminLink").hidden = !me.isModerator;
  $("#adminLink").textContent = me.isAdmin ? "Админка" : "Модерация";
  document.title = `${me.name} | ENDEMION`;
}

// ==================== ОБЗОР ====================

function statBox(value, label) {
  const box = el("div", "stat-box");
  box.append(el("strong", null, String(value ?? "—")), el("span", null, label));
  return box;
}

async function renderOverview() {
  const stats = (await api("/api/me")).data?.stats;
  if (!stats) return $("#stats").replaceChildren(errorBox("Статистика не загрузилась.", renderOverview));
  $("#stats").replaceChildren(
    statBox(stats.topics, "тем"),
    statBox(stats.posts, "ответов"),
    statBox(`${stats.followers} / ${stats.following}`, "подписчики / подписки"),
    statBox(stats.achievements, "достижений")
  );
  const links = $("#overviewLinks");
  links.replaceChildren(
    link("/community", "primary-btn", "Открыть форум"),
    link(`/users/${encodeURIComponent(profile.username)}`, "ghost-btn", "Мои темы и ответы"),
    link("/notifications", "ghost-btn", "Уведомления")
  );
  renderMyTopics();
}

/** Последние свои темы прямо в обзоре: тот же запрос, что на публичном профиле, владельцу он открыт всегда */
async function renderMyTopics() {
  const box = $("#myTopics");
  if (!box) return;
  const result = await api(`/api/users/${encodeURIComponent(profile.username)}/forum`);
  if (!result.ok) return box.replaceChildren(errorBox("Темы не загрузились.", renderMyTopics));
  const { topics } = result.data;
  if (!topics.length) return box.replaceChildren(el("p", "muted small", "Вы ещё не создавали тем."));
  const list = el("div", "stack");
  for (const topic of topics) {
    const row = el("p");
    row.append(link(`/community/thread/${topic.id}`, null, topic.subject), el("span", "muted small", ` · ${formatDate(topic.createdAt)}`));
    list.append(row);
  }
  box.replaceChildren(list);
}

// ==================== ДОСТИЖЕНИЯ ====================

async function renderAchievements() {
  const box = $("#achievementList");
  const result = await api("/api/me/achievements");
  if (!result.ok) return box.replaceChildren(errorBox("Достижения не загрузились.", renderAchievements));
  box.replaceChildren(...result.data.achievements.map((item) => {
    const node = el("div", `achievement${item.earnedAt ? "" : " is-locked"}`);
    node.append(el("b", null, item.icon), el("strong", null, item.name), el("small", null, item.description));
    node.append(el("small", null, item.earnedAt ? `Получено ${formatDate(item.earnedAt)}` : "Ещё не получено"));
    return node;
  }));
}

// ==================== ИЗБРАННЫЕ ИГРЫ ====================

async function renderFavorites() {
  const box = $("#profileFavoritesList");
  if (!box) return;
  const result = await api(`/api/users/${encodeURIComponent(profile.username)}/library`);
  if (!result.ok) return box.replaceChildren(errorBox("Избранное не загрузилось.", renderFavorites));
  const games = result.data.games || [];
  if (!games.length) {
    box.replaceChildren(el("div", "profile-favorites-empty",
      el("strong", null, "Избранных игр пока нет"),
      el("p", null, "Добавляйте игры в избранное на их страницах, и они появятся здесь.")
    ));
    return;
  }
  box.replaceChildren(...games.map((g) => {
    const article = el("article", "card");
    const media = el("div", "card-media");
    if (g.coverUrl) {
      const img = el("img");
      img.src = g.coverUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 1280;
      img.height = 720;
      media.append(img);
    } else {
      media.append(el("div", "placeholder-art", `${g.title}\nОбложка скоро появится`));
    }
    const body = el("div", "card-body");
    body.append(link(`/games/${g.slug}`, "card-title", g.title));
    if (g.tagline) body.append(el("p", "card-text", g.tagline));
    const meta = el("div", "card-meta");
    if (g.platforms.length) meta.append(el("span", null, g.platforms.join(" · ")));
    else meta.append(el("span", null, "Платформы не указаны"));
    body.append(meta);
    article.append(media, body);
    return article;
  }));
}

// ==================== НАСТРОЙКИ ====================

function renderSettings() {
  $("#newName").value = me.name;
  $("#username").value = profile.username;
  $("#bio").value = profile.bio;
  $("#colorOptions").replaceChildren(...COLORS.map((color) => {
    const label = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "avatarColor";
    radio.value = color;
    radio.checked = profile.avatarColor === color;
    radio.setAttribute("aria-label", `Цвет ${color}`);
    label.append(radio, avatar({ name: me.name, avatarColor: color }));
    return label;
  }));
  $("#avatarRemove").hidden = !profile.avatar;
  const privacy = $("#privacyForm");
  privacy.elements.namedItem("isPublic").checked = settings.isPublic;
  privacy.elements.namedItem("showActivity").checked = settings.showActivity;
}

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#profileMessage");
  const name = $("#newName").value.trim();
  // Имя и адрес профиля аккаунта Endemion ID меняются только там
  if (!me.viaEndemionId && name !== me.name) {
    const renamed = await api("/api/me", { method: "PATCH", body: { name } });
    if (!renamed.ok) return setMessage(message, renamed.data?.error || "Не удалось сохранить имя.");
    me.name = renamed.data.user.name;
  }
  const color = $("#profileForm").querySelector('input[name="avatarColor"]:checked')?.value || profile.avatarColor;
  const fields = { bio: $("#bio").value, avatarColor: color };
  if (!me.viaEndemionId) fields.username = $("#username").value.trim();
  const saved = await api("/api/me/profile", { method: "PATCH", body: fields });
  if (!saved.ok) return setMessage(message, saved.data?.error || "Не удалось сохранить профиль.");
  profile = saved.data.profile;
  settings = saved.data.settings;
  renderHead();
  setMessage(message, "Профиль сохранён.", true);
});

$("#privacyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(["isPublic", "showActivity"].map((key) => [key, form.elements.namedItem(key).checked]));
  const saved = await api("/api/me/profile", { method: "PATCH", body });
  if (!saved.ok) return setMessage($("#privacyMessage"), saved.data?.error || "Не удалось сохранить.");
  settings = saved.data.settings;
  renderHead();
  setMessage($("#privacyMessage"), settings.isPublic ? "Сохранено. Профиль виден всем." : "Сохранено. Профиль видите только вы.", true);
});

$("#avatarInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const message = $("#profileMessage");
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) return setMessage(message, "Аватар должен быть картинкой JPEG, PNG, WebP или AVIF.");
  if (file.size > MAX_AVATAR) return setMessage(message, "Аватар должен быть не больше 2 МБ.");
  setMessage(message, "Загружаю аватар…");
  let response = null;
  try {
    response = await fetch("/api/me/avatar", { method: "PUT", body: file, credentials: "same-origin", headers: { "Content-Type": file.type } });
  } catch {}
  const data = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return setMessage(message, data?.error || "Не удалось загрузить аватар.");
  profile.avatar = data.avatar;
  renderHead();
  renderSettings();
  setMessage(message, "Аватар загружен.", true);
});

$("#avatarRemove").addEventListener("click", async () => {
  const result = await api("/api/me/avatar", { method: "DELETE" });
  if (!result.ok) return setMessage($("#profileMessage"), result.data?.error || "Не удалось убрать аватар.");
  profile.avatar = null;
  renderHead();
  renderSettings();
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#settingsMessage");
  const currentPassword = $("#currentPassword").value;
  const newPassword = $("#newPassword").value;
  if (newPassword.length < 8) return setMessage(message, "Новый пароль должен содержать минимум 8 символов.");
  const result = await api("/api/me/password", { method: "POST", body: { currentPassword, newPassword } });
  if (!result.ok) return setMessage(message, result.data?.error || "Не удалось сменить пароль.");
  event.currentTarget.reset();
  setMessage(message, "Пароль изменён. На других устройствах нужно войти заново.", true);
});

$("#deleteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirm("Удалить аккаунт? Это нельзя отменить.")) return;
  const result = await api("/api/me", { method: "DELETE", body: { password: $("#deletePassword").value } });
  // Аккаунт Endemion ID: сначала заново ввести пароль там, потом повторить удаление
  if (result.data?.reauth && confirm(`${result.data.error} Перейти ко входу?`)) {
    location.href = result.data.reauth;
    return;
  }
  if (!result.ok) return setMessage($("#settingsMessage"), result.data?.error || "Не удалось удалить аккаунт.");
  location.href = "/";
});

$("#logoutButton").addEventListener("click", async () => {
  const result = await api("/api/auth/logout", { method: "POST", body: {} });
  // Вход через Endemion ID: выход подтверждается там, и можно сразу выйти из Endemion Life
  const redirect = result.data?.redirect;
  location.href = typeof redirect === "string" && redirect.startsWith("https://") ? redirect : "/";
});

// ==================== ВКЛАДКИ ====================

const tabs = [...document.querySelectorAll("[data-tab]")];
const RENDER = { overview: renderOverview, achievements: renderAchievements, settings: renderSettings, favorites: renderFavorites };

function open(name) {
  const tab = RENDER[name] ? name : "overview";
  tabs.forEach((node) => {
    node.setAttribute("aria-selected", String(node.dataset.tab === tab));
    node.tabIndex = node.dataset.tab === tab ? 0 : -1;
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => (panel.hidden = panel.dataset.panel !== tab));
  history.replaceState(null, "", `#${tab}`);
  RENDER[tab]();
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => open(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    open(next.dataset.tab);
  });
});

/**
 * Вход через Endemion ID: имя, адрес профиля, аватар, почта и пароль общие с Endemion Life и меняются там.
 * Здесь вместо этих полей ссылка на Endemion ID. Описание, цвет и приватность остаются на сайте
 */
async function showEndemionId() {
  if (!me.viaEndemionId) return;
  const { endemionId } = await getConfig();
  if (!endemionId) return;
  document.querySelectorAll("[data-local-identity]").forEach((node) => (node.hidden = true));
  $("#passwordForm").hidden = true;
  $("#deletePasswordRow").hidden = true;
  $("#deletePassword").required = false;
  $("#endemionIdAccount").href = endemionId.account;
  $("#endemionLifeLink").href = endemionId.life;
  $("#endemionIdPanel").hidden = false;
}

async function init() {
  const user = await initHeader();
  if (!user) {
    location.replace(loginUrl());
    return;
  }
  me = (await getMe()).user;
  await showEndemionId();
  const profileResult = await api("/api/me/profile");
  if (!profileResult.ok) {
    $("#profileLoading").replaceChildren(errorBox(profileResult.data?.error || "Профиль не загрузился.", () => location.reload()));
    return;
  }
  ({ profile, settings } = profileResult.data);
  renderHead();
  $("#profileLoading").remove();
  $("#profile").hidden = false;
  // Добавить вкладку «Избранные»
  const tabsBar = document.querySelector("[data-tab]")?.closest(".tabs-bar");
  if (tabsBar && !tabsBar.querySelector("[data-tab=favorites]")) {
    const btn = el("button", null, "Избранные");
    btn.type = "button";
    btn.role = "tab";
    btn.dataset.tab = "favorites";
    btn.setAttribute("aria-selected", "false");
    tabsBar.append(btn);
    const panel = el("section", null);
    panel.dataset.panel = "favorites";
    panel.hidden = true;
    panel.innerHTML = `<div class="container"><div class="section-head"><div><h2>Избранные игры</h2></div></div><div id="profileFavoritesList"></div></div>`;
    document.querySelector("main").append(panel);
  }
  open(location.hash.slice(1));
}

init();
