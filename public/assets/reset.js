// Восстановление пароля. Без ссылки из письма — запрос письма, по ссылке — новый пароль.
// Правила пароля проверяет сервер, здесь только подсказки до отправки

import { api, getConfig } from "./app.js";

const $ = (selector) => document.querySelector(selector);
const forgotForm = $("#forgotForm");
const resetForm = $("#resetForm");
const message = $("#resetMessage");

const TOKEN_KEY = "endemion:reset-token";
let turnstileWidget = null;

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}

function appendLink(text, href, onClick) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  if (onClick) link.addEventListener("click", onClick);
  message.append(" ", link);
  return link;
}

// Токен из письма убирается из адреса, чтобы не остаться в истории браузера.
// До смены пароля он лежит в sessionStorage этой вкладки: после обновления страницы форма не пропадёт
function saveToken(value) {
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
    return true;
  } catch {
    return false;
  }
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// ==================== ЗАПРОС ПИСЬМА ====================

function turnstileToken() {
  return turnstileWidget !== null && window.turnstile ? window.turnstile.getResponse(turnstileWidget) : undefined;
}

function resetTurnstile() {
  if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
}

async function initForgot() {
  forgotForm.hidden = false;
  const config = await getConfig();
  if (!config.passwordReset) {
    showMessage("Восстановление пароля пока недоступно.");
    forgotForm.querySelector("button").disabled = true;
    return;
  }

  const siteKey = config.turnstileSiteKey;
  if (!siteKey) return;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => {
    turnstileWidget = window.turnstile.render("#turnstile", { sitekey: siteKey, theme: "dark", language: "ru" });
  };
  document.head.append(script);
}

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#forgotEmail");
  const email = input.value.trim();
  if (!email || !input.checkValidity()) return showMessage("Введите корректную электронную почту.");

  const button = forgotForm.querySelector("button");
  button.disabled = true;
  const result = await api("/api/auth/forgot", { method: "POST", body: { email, turnstileToken: turnstileToken() } });
  button.disabled = false;
  // Токен Turnstile одноразовый: для следующей отправки нужен новый
  resetTurnstile();

  if (!result.ok) return showMessage(result.data?.error || "Не удалось отправить письмо. Попробуйте ещё раз.");
  showMessage(result.data.message, true);
  // Только на локальном сервере с MAIL_DEV_MODE=1: письмо не отправляется, ссылка приходит в ответе
  if (result.data.devLink) appendLink("Открыть ссылку из письма (режим разработки)", result.data.devLink).id = "devLink";
});

// ==================== НОВЫЙ ПАРОЛЬ ====================

function initReset(token) {
  $("#resetTitle").textContent = "Новый пароль";
  $("#resetDescription").textContent =
    "Придумайте новый пароль. После сохранения вы войдёте в профиль, а на других устройствах нужно будет войти заново.";
  resetForm.hidden = false;
  $("#newPassword").focus();

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#newPassword").value;
    if (password.length < 8) return showMessage("Пароль должен содержать минимум 8 символов.");
    if (password !== $("#confirmPassword").value) return showMessage("Пароли не совпадают.");

    const button = resetForm.querySelector("button");
    button.disabled = true;
    const result = await api("/api/auth/reset", { method: "POST", body: { token, password } });
    if (result.ok) {
      clearToken();
      location.href = "/profile";
      return;
    }
    button.disabled = false;
    showMessage(result.data?.error || "Не удалось сохранить пароль. Попробуйте ещё раз.");
    // Пароль уже проверен выше, поэтому ошибка сервера почти всегда значит, что ссылка устарела
    appendLink("Запросить новую ссылку", "/reset", clearToken);
  });
}

// ==================== СТАРТ ====================

let token = new URLSearchParams(location.search).get("token");
if (token) {
  if (saveToken(token)) history.replaceState(null, "", "/reset");
} else {
  token = readToken();
}

if (token) initReset(token);
else initForgot();
