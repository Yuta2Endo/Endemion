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

export const STATUSES = ["planned", "reading", "completed", "dropped"];
