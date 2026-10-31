// Профиль: данные аккаунта, библиотека по статусам, смена имени и пароля, выход и удаление

import { api, getMe, loginUrl, STATUS_LABELS, TYPE_LABELS } from "./app.js";

const profile = document.querySelector("#profile");
const list = document.querySelector("#libraryList");
const tabs = document.querySelector("#libraryTabs");
const editButton = document.querySelector("#editButton");
const editPanel = document.querySelector("#editPanel");
const settingsMessage = document.querySelector("#settingsMessage");

let filter = "favorites";
let titles = new Map();
let items = [];

const EMPTY_TEXT = {
  favorites: "В избранном пока пусто. Нажми ♡ на карточке в каталоге.",
  reading: "Здесь появятся тайтлы, которые ты читаешь. Отметь прочитанную главу на странице тайтла.",
  planned: "Добавь тайтлы, которые хочешь прочитать: статус «Буду читать» на странице тайтла.",
  completed: "Пока ничего не дочитано.",
  dropped: "Брошенных тайтлов нет."
};

function setMessage(text, success = false) {
  settingsMessage.textContent = text;
  settingsMessage.classList.toggle("success", success);
}

function renderUser(user, stats) {
  document.querySelector("#avatar").textContent = user.name.charAt(0).toUpperCase();
  document.querySelector("#profileName").textContent = user.name;
  document.querySelector("#profileEmail").textContent = user.email;
  document.querySelector("#usernameHint").value = user.email;
  document.querySelector("#newName").value = user.name;
  const since = new Date(user.createdAt.replace(" ", "T") + "Z");
  document.querySelector("#profileSince").textContent =
    `С нами с ${since.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
  document.title = `${user.name} — Endemion`;

  document.querySelector("#statFavorites").textContent = stats.favorites;
  document.querySelector("#statReading").textContent = stats.reading;
  document.querySelector("#statCompleted").textContent = stats.completed;
  document.querySelector("#statChapters").textContent = stats.chapters;
}

function renderLibrary() {
  const selected = items.filter((item) => (filter === "favorites" ? item.favorite : item.status === filter));

  if (selected.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.append(EMPTY_TEXT[filter] + " ");
    const link = document.createElement("a");
    link.href = "/#catalog";
    link.textContent = "Открыть каталог";
    empty.append(link);
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...selected
      .filter((item) => titles.has(item.titleId))
      .map((item) => {
        const title = titles.get(item.titleId);
        const card = document.createElement("a");
        card.className = "favorite-card";
        card.href = `/title/${title.id}`;
        card.style.setProperty("--poster", title.poster);

        const text = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = title.title;
        const meta = document.createElement("small");
        const parts = [TYPE_LABELS[title.type]];
        if (item.status) parts.push(STATUS_LABELS[item.status]);
        if (item.chapter > 0) parts.push(`глава ${item.chapter} из ${title.chapters}`);
        if (parts.length === 1) parts.push(title.genres.join(" · "));
        meta.textContent = parts.join(" · ");
        text.append(name, meta);
        card.append(text);
        return card;
      })
  );
}

async function refreshStats() {
  const me = await api("/api/me");
  if (me.ok && me.data.user) renderUser(me.data.user, me.data.stats);
}

async function init() {
  const me = await getMe();
  if (!me.user) {
    location.replace(loginUrl());
    return;
  }

  const [catalog, library] = await Promise.all([api("/api/titles"), api("/api/library")]);
  titles = new Map((catalog.ok ? catalog.data.titles : []).map((item) => [item.id, item]));
  items = library.ok ? library.data.items : [];

  renderUser(me.user, me.stats);
  renderLibrary();
  // Ссылка только для удобства: права на /api/admin/* проверяет сервер
  document.querySelector("#adminLink").hidden = !me.user.isAdmin;
  profile.hidden = false;
}

// ==================== СОБЫТИЯ ====================

tabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  tabs.querySelectorAll("[data-filter]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
  renderLibrary();
});

editButton.addEventListener("click", () => {
  editPanel.hidden = !editPanel.hidden;
  editButton.setAttribute("aria-expanded", String(!editPanel.hidden));
  setMessage("");
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: {} });
  location.href = "/";
});

document.querySelector("#nameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#newName").value.trim();
  const result = await api("/api/me", { method: "PATCH", body: { name } });
  if (!result.ok) return setMessage(result.data?.error || "Не удалось сохранить имя.");
  await refreshStats();
  setMessage("Имя сохранено.", true);
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.querySelector("#currentPassword").value;
  const newPassword = document.querySelector("#newPassword").value;
  if (newPassword.length < 8) return setMessage("Новый пароль должен содержать минимум 8 символов.");

  const result = await api("/api/me/password", { method: "POST", body: { currentPassword, newPassword } });
  if (!result.ok) return setMessage(result.data?.error || "Не удалось сменить пароль.");
  event.target.reset();
  setMessage("Пароль изменён. На других устройствах нужно войти заново.", true);
});

document.querySelector("#deleteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirm("Удалить аккаунт и всю библиотеку? Это нельзя отменить.")) return;
  const password = document.querySelector("#deletePassword").value;
  const result = await api("/api/me", { method: "DELETE", body: { password } });
  if (!result.ok) return setMessage(result.data?.error || "Не удалось удалить аккаунт.");
  location.href = "/";
});

init();
