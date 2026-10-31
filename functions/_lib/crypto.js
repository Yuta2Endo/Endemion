// Хеширование паролей и токенов через Web Crypto (есть в Workers без зависимостей)

// Workers ограничивают PBKDF2 сотней тысяч итераций
export const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;

const encoder = new TextEncoder();

export function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

/** Хеш пароля с уникальной солью: pbkdf2$итерации$соль$хеш */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Сравнение без утечки по времени: время не зависит от того, где байты разошлись */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
  return equalBytes(actual, fromBase64(hash));
}

/** Случайный токен сессии для cookie */
export function newToken() {
  return toHex(randomBytes(32));
}

/** SHA-256 токена: в базе хранится он, а не сам токен */
export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(new Uint8Array(digest));
}
