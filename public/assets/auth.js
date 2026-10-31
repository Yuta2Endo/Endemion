// Вход и регистрация через /api/auth/*. Пароль проверяет сервер, в браузере ничего не хранится

import { api, getConfig, getMe, safeNext } from "./app.js";

const form = document.querySelector("#authForm");
const loginMode = document.querySelector("#loginMode");
const registerMode = document.querySelector("#registerMode");
const nameField = document.querySelector("#nameField");
const confirmField = document.querySelector("#confirmField");
const consentField = document.querySelector("#consentField");
const nameInput = document.querySelector("#name");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const passwordHint = document.querySelector("#passwordHint");
const confirmInput = document.querySelector("#confirmPassword");
const consentInput = document.querySelector("#consent");
const submitButton = document.querySelector("#submitButton");
const formTitle = document.querySelector("#formTitle");
const formDescription = document.querySelector("#formDescription");
const formMessage = document.querySelector("#formMessage");
const forgotLink = document.querySelector("#forgotLink");

const params = new URLSearchParams(location.search);
const next = safeNext(params.get("next"));

let mode = "login";
let turnstileWidget = null;
// Восстановление пароля работает, только если на сайте настроена отправка писем
let resetAvailable = false;

// Старая версия сайта хранила пароли и сессию в браузере. Эти данные больше не нужны и небезопасны
localStorage.removeItem("endemion-users");
localStorage.removeItem("endemion-session");

function setMode(nextMode) {
  mode = nextMode;
  const isRegister = mode === "register";

  loginMode.setAttribute("aria-selected", String(!isRegister));
  registerMode.setAttribute("aria-selected", String(isRegister));

  nameField.hidden = !isRegister;
  confirmField.hidden = !isRegister;
  consentField.hidden = !isRegister;
  passwordHint.hidden = !isRegister;
  forgotLink.hidden = isRegister || !resetAvailable;

  nameInput.required = isRegister;
  confirmInput.required = isRegister;
  // Менеджер паролей предложит сохранить новый пароль при регистрации и подставит старый при входе
  passwordInput.autocomplete = isRegister ? "new-password" : "current-password";

  formTitle.textContent = isRegister ? "Создай профиль" : "С возвращением";
  formDescription.textContent = isRegister ? "Регистрация займёт меньше минуты." : "Войди в свой профиль Endemion.";
  submitButton.textContent = isRegister ? "Создать профиль" : "Войти в профиль";
  showMessage("");
  resetTurnstile();
}

function showMessage(message) {
  formMessage.textContent = message;
}

/** Проверки до отправки: те же правила сервер проверит ещё раз */
function validate() {
  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) return "Введите корректную электронную почту.";
  if (mode === "login") return passwordInput.value ? null : "Введите пароль.";

  const name = nameInput.value.trim();
  if (name.length < 2 || name.length > 40) return "Имя должно содержать от 2 до 40 символов.";
  if (passwordInput.value.length < 8) return "Пароль должен содержать минимум 8 символов.";
  if (passwordInput.value !== confirmInput.value) return "Пароли не совпадают.";
  if (!consentInput.checked) return "Нужно согласие с политикой конфиденциальности.";
  return null;
}

// ==================== TURNSTILE ====================

async function loadConfig() {
  const config = await getConfig();
  resetAvailable = config.passwordReset === true;
  forgotLink.hidden = mode === "register" || !resetAvailable;

  const siteKey = config.turnstileSiteKey || "";
  if (!siteKey) return;

  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => {
    turnstileWidget = window.turnstile.render("#turnstile", { sitekey: siteKey, theme: "dark", language: "ru" });
  };
  document.head.append(script);
}

function turnstileToken() {
  return turnstileWidget !== null && window.turnstile ? window.turnstile.getResponse(turnstileWidget) : undefined;
}

function resetTurnstile() {
  if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
}

// ==================== ОТПРАВКА ====================

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const problem = validate();
  if (problem) {
    showMessage(problem);
    return;
  }

  submitButton.disabled = true;
  showMessage("");

  const body = {
    email: emailInput.value.trim(),
    password: passwordInput.value,
    turnstileToken: turnstileToken()
  };
  if (mode === "register") {
    body.name = nameInput.value.trim();
    body.consent = consentInput.checked;
  }

  const result = await api(mode === "register" ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
  submitButton.disabled = false;

  if (result.ok) {
    location.href = next;
    return;
  }
  showMessage(result.data?.error || "Не удалось выполнить запрос. Попробуйте ещё раз.");
  // Токен Turnstile одноразовый: после неудачи нужен новый
  resetTurnstile();
});

loginMode.addEventListener("click", () => setMode("login"));
registerMode.addEventListener("click", () => setMode("register"));

// Уже вошёл — сразу в профиль
getMe().then(({ user }) => {
  if (user) location.replace(next);
});

if (params.get("mode") === "register") setMode("register");
loadConfig();
