// Проверка данных от пользователя. Те же правила есть в браузере, но доверять можно только серверу

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const PASSWORD_MIN = 8;
// PBKDF2 считает хеш от всего пароля: длинный пароль замедлил бы сервер
export const PASSWORD_MAX = 128;
const EMAIL_MAX = 254;

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateEmail(email) {
  if (!email || email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Введите корректную электронную почту.";
  }
  return null;
}

export function normalizeName(value) {
  // Убираем управляющие символы и лишние пробелы
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
}

export function validateName(name) {
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return `Имя должно содержать от ${NAME_MIN} до ${NAME_MAX} символов.`;
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return `Пароль должен содержать минимум ${PASSWORD_MIN} символов.`;
  }
  if (password.length > PASSWORD_MAX) return `Пароль не длиннее ${PASSWORD_MAX} символов.`;
  return null;
}

export const STATUSES = ["reading", "planned", "completed", "on_hold", "dropped"];

/**
 * Многострочный текст от пользователя: без управляющих символов (кроме переноса строки), не больше двух пустых строк подряд.
 * HTML не вырезается: при выводе текст всегда экранируется (textContent или escapeHtml)
 */
export function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Однострочный текст: без управляющих символов и лишних пробелов */
export function cleanLine(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** Строка в пределах длины или текст ошибки */
export function lengthProblem(value, label, min, max) {
  const length = [...value].length;
  if (length < min || length > max) return min > 0 ? `${label}: от ${min} до ${max} символов.` : `${label}: не длиннее ${max} символов.`;
  return null;
}

/** Целое число из адреса в пределах [min, max]; пусто — значение по умолчанию; иначе null */
export function intParam(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export const USERNAME = /^[a-zA-Z0-9_]{3,24}$/;
