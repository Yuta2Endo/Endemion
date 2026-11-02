// ENDEMION ID — свой профиль: статистика чтения, любимые жанры, полка по статусам, достижения,
// настройки профиля, аватар, приватность, смена пароля, выход и удаление аккаунта

import {
  api, avatar, button, el, errorBox, formatDate, getMe, initHeader, loginUrl, stateBox, titleCard, toggleFavorite, toast
} from "./app.js";

const $ = (selector) => document.querySelector(selector);
const COLORS = ["violet", "blue", "pink", "teal", "amber", "crimson"];
const MAX_AVATAR = 2 * 1024 * 1024;

let me = null;
let profile = null;
let settings = null;
let favoriteGenres = [];
let allGenres = [];
let libraryFilter = "reading";
let library = new Map();

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
  handle.href = `/u/${encodeURIComponent(profile.username)}`;
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
    statBox(stats.chapters, "глав прочитано"),
    statBox(stats.completed, "тайтлов дочитано"),
    statBox(stats.reading, "читаю сейчас"),
    statBox(stats.planned, "в планах"),
    statBox(stats.favorites, "в избранном"),
    statBox(stats.reviews, `оценок${stats.averageScore ? ` · ср. ${stats.averageScore}` : ""}`),
    statBox(stats.comments, "комментариев"),
    statBox(`${stats.followers} / ${stats.following}`, "подписчики / подписки"),
    statBox(stats.achievements, "достижений")
  );

  const bars = $("#genreBars");
  if (!stats.topGenres.length) {
    bars.replaceChildren(el("p", "muted small", "Добавьте тайтлы на полку — здесь появятся жанры, которые вы читаете чаще всего."));
  } else {
    const max = stats.topGenres[0].count;
    bars.replaceChildren(...stats.topGenres.map((genre) => {
      const row = el("div", "genre-bar");
      const progress = el("div", "t-progress");
      const fill = el("span");
      fill.style.width = `${Math.round((genre.count / max) * 100)}%`;
      progress.append(fill);
      row.append(el("span", null, genre.name), progress, el("span", "muted", String(genre.count)));
      return row;
    }));
  }
  $("#favoriteGenres").replaceChildren(...(favoriteGenres.length
    ? favoriteGenres.map((name) => el("span", "tag is-strong", name))
    : [el("p", "muted small", "Не выбраны. Выберите их во вкладке «Настройки».")]));

  const favorites = await api("/api/titles?tab=favorites&limit=12&sort=updated");
  const grid = $("#favoritesGrid");
  if (!favorites.ok) return grid.replaceChildren(errorBox("Избранное не загрузилось."));
  grid.replaceChildren(...(favorites.data.titles.length
    ? favorites.data.titles.map((title) => titleCard(title, { library: library.get(title.id), onFavorite: toggleFavorite }))
    : [stateBox({ icon: "♡", text: "В избранном пока пусто. Нажмите ♡ на карточке тайтла.", action: { href: "/catalog", text: "Открыть каталог" } })]));
}

// ==================== ПОЛКА ====================

const EMPTY_TEXT = {
  reading: "Здесь появятся тайтлы, которые вы читаете. Отметьте прочитанную главу на странице тайтла.",
  planned: "Добавьте тайтлы, которые хотите прочитать: статус «В планах» на странице тайтла.",
  completed: "Пока ничего не дочитано.",
  on_hold: "Отложенных тайтлов нет.",
  dropped: "Брошенных тайтлов нет.",
  favorites: "В избранном пока пусто."
};

async function renderLibrary() {
  const list = $("#libraryList");
  $("#libraryTabs").querySelectorAll("[data-filter]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.filter === libraryFilter)));
  const result = await api(`/api/titles?tab=${libraryFilter}&limit=100&sort=updated`);
  if (!result.ok) return list.replaceChildren(errorBox(result.data?.error || "Полка не загрузилась.", renderLibrary));
  if (!result.data.titles.length) {
    return list.replaceChildren(stateBox({ icon: "📚", text: EMPTY_TEXT[libraryFilter], action: { href: "/catalog", text: "Открыть каталог" } }));
  }
  list.replaceChildren(...result.data.titles.map((title) => titleCard(title, { library: library.get(title.id), onFavorite: toggleFavorite })));
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
  const chosen = new Set(favoriteGenres);
  $("#genrePicker").replaceChildren(...allGenres.map((genre) => {
    const chip = button(genre.name, "chip", () => {
      const pressed = chip.getAttribute("aria-pressed") === "true";
      if (!pressed && $("#genrePicker").querySelectorAll('[aria-pressed="true"]').length >= 10) return toast("Можно выбрать до 10 жанров.");
      chip.setAttribute("aria-pressed", String(!pressed));
    }, { pressed: chosen.has(genre.name) });
    chip.dataset.genre = genre.name;
    return chip;
  }));
  const privacy = $("#privacyForm");
  privacy.elements.namedItem("isPublic").checked = settings.isPublic;
  privacy.elements.namedItem("showLibrary").checked = settings.showLibrary;
  privacy.elements.namedItem("showActivity").checked = settings.showActivity;
}

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#profileMessage");
  const name = $("#newName").value.trim();
  if (name !== me.name) {
    const renamed = await api("/api/me", { method: "PATCH", body: { name } });
    if (!renamed.ok) return setMessage(message, renamed.data?.error || "Не удалось сохранить имя.");
    me.name = renamed.data.user.name;
  }
  const color = $("#profileForm").querySelector('input[name="avatarColor"]:checked')?.value || profile.avatarColor;
  const saved = await api("/api/me/profile", { method: "PATCH", body: { username: $("#username").value.trim(), bio: $("#bio").value, avatarColor: color } });
  if (!saved.ok) return setMessage(message, saved.data?.error || "Не удалось сохранить профиль.");
  profile = saved.data.profile;
  settings = saved.data.settings;
  const genres = [...$("#genrePicker").querySelectorAll('[aria-pressed="true"]')].map((chip) => chip.dataset.genre);
  const genreResult = await api("/api/me/genres", { method: "PUT", body: { genres } });
  if (!genreResult.ok) return setMessage(message, genreResult.data?.error || "Жанры не сохранились.");
  favoriteGenres = genreResult.data.genres;
  renderHead();
  setMessage(message, "Профиль сохранён.", true);
});

$("#privacyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(["isPublic", "showLibrary", "showActivity"].map((key) => [key, form.elements.namedItem(key).checked]));
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
  if (!confirm("Удалить аккаунт, полку, оценки и подборки? Это нельзя отменить.")) return;
  const result = await api("/api/me", { method: "DELETE", body: { password: $("#deletePassword").value } });
  if (!result.ok) return setMessage($("#settingsMessage"), result.data?.error || "Не удалось удалить аккаунт.");
  location.href = "/";
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: {} });
  location.href = "/";
});

// ==================== ВКЛАДКИ ====================

const tabs = [...document.querySelectorAll("[data-tab]")];
const RENDER = { overview: renderOverview, library: renderLibrary, achievements: renderAchievements, settings: renderSettings };

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

$("#libraryTabs").addEventListener("click", (event) => {
  const chip = event.target instanceof Element ? event.target.closest("[data-filter]") : null;
  if (!(chip instanceof HTMLElement)) return;
  libraryFilter = chip.dataset.filter;
  renderLibrary();
});

async function init() {
  const user = await initHeader();
  if (!user) {
    location.replace(loginUrl());
    return;
  }
  me = (await getMe()).user;
  const [profileResult, taxonomy, entries] = await Promise.all([api("/api/me/profile"), api("/api/taxonomy"), api("/api/library")]);
  if (!profileResult.ok) {
    $("#profileLoading").replaceChildren(errorBox(profileResult.data?.error || "Профиль не загрузился.", () => location.reload()));
    return;
  }
  ({ profile, settings, genres: favoriteGenres } = profileResult.data);
  allGenres = taxonomy.ok ? taxonomy.data.genres : [];
  library = new Map((entries.ok ? entries.data.items : []).map((item) => [item.titleId, item]));
  renderHead();
  $("#profileLoading").remove();
  $("#profile").hidden = false;
  open(location.hash.slice(1));
}

init();
