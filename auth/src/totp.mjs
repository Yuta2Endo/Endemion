// Коды двухфакторной защиты: TOTP (RFC 6238, SHA-1, 30 секунд, 6 цифр) и одноразовые запасные коды.
// Секрет и запасные коды в базе только в виде scrypt-хеша не хранятся: секрет нужен, чтобы посчитать код,
// поэтому он шифруется ключом cookie (AES-256-GCM). Запасные коды хранятся как SHA-256

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP = 30;
const DIGITS = 6;
const WINDOW = 1;
const CODE_RE = /^\d{6}$/;
const BACKUP_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{5}/g).map((chunk) => b32[parseInt(chunk, 2)]).join("");
}

function decodeSecret(secret) {
  const clean = String(secret || "").toUpperCase().replace(/=+$/, "");
  if (!clean || [...clean].some((char) => !b32.includes(char))) return null;
  const bits = [...clean].map((char) => b32.indexOf(char).toString(2).padStart(5, "0")).join("");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = decodeSecret(secret);
  if (!key) return null;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentCode(secret, now = Date.now()) {
  return hotp(secret, Math.floor(now / 1000 / STEP));
}

/** Код подходит к секрету в окне ±1 шаг и не использовался в этом же шаге раньше */
export function verifyTotp(secret, code, { now = Date.now(), lastStep = 0 } = {}) {
  if (!CODE_RE.test(String(code || ""))) return null;
  const step = Math.floor(now / 1000 / STEP);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const candidate = step + delta;
    if (candidate <= lastStep) continue;
    const expected = hotp(secret, candidate);
    if (expected && timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return candidate;
  }
  return null;
}

export function otpauthUrl(secret, email) {
  const label = encodeURIComponent(`Endemion:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Endemion&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

export function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").slice(0, 8).toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export const hashBackup = (code) => createHash("sha256").update(String(code).toUpperCase()).digest("hex");

export function normalizeCode(value) {
  const clean = String(value || "").trim().toUpperCase().replace(/\s/g, "");
  if (CODE_RE.test(clean)) return clean;
  return BACKUP_RE.test(clean) ? clean : "";
}

function keyFrom(cookieKey) {
  return createHash("sha256").update(`totp:${cookieKey}`).digest();
}

export function encryptSecret(secret, cookieKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(cookieKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload, cookieKey) {
  const [iv, tag, data] = String(payload || "").split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(cookieKey), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
