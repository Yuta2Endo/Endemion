// Жалоба правообладателя (/copyright). Поля проверяет сервер, здесь только подсказки до отправки

import { api, getConfig } from "./app.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#complaintForm");
const submit = $("#complaintSubmit");
const message = $("#complaintMessage");

let turnstileWidget = null;

$("#complaintLinks").placeholder = `${location.origin}/title/1\n${location.origin}/read/1/3`;

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}

function validate(data) {
  if (data.name.length < 2) return "Укажите имя или название заявителя.";
  if (!data.email || !$("#complaintEmail").checkValidity()) return "Введите корректную электронную почту.";
  if (data.rightholder.length < 2) return "Укажите правообладателя.";
  if (!data.work) return "Укажите произведение.";
  if (!data.links.trim()) return "Укажите хотя бы одну ссылку на страницу Endemion.";
  if (data.description.trim().length < 20) return "Опишите, на чём основаны права: хотя бы 20 символов.";
  if (!data.statement) return "Подтвердите достоверность сведений.";
  return null;
}

// ==================== TURNSTILE ====================

async function initTurnstile() {
  const { turnstileSiteKey: siteKey } = await getConfig();
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
  const data = {
    name: $("#complaintName").value.trim(),
    email: $("#complaintEmail").value.trim(),
    rightholder: $("#complaintRightholder").value.trim(),
    work: $("#complaintWork").value.trim(),
    links: $("#complaintLinks").value,
    description: $("#complaintDescription").value,
    statement: $("#complaintStatement").checked
  };
  const problem = validate(data);
  if (problem) return showMessage(problem);

  submit.disabled = true;
  showMessage("");
  const result = await api("/api/complaints", { method: "POST", body: { ...data, turnstileToken: turnstileToken() } });
  submit.disabled = false;
  // Токен Turnstile одноразовый: для следующей отправки нужен новый
  resetTurnstile();

  if (!result.ok) return showMessage(result.data?.error || "Не удалось отправить жалобу. Попробуйте ещё раз.");
  form.reset();
  showMessage(`Жалоба №${result.data.id} принята. Мы рассмотрим её и ответим на ${data.email}.`, true);
});

initTurnstile();
