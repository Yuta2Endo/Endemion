// Хеши паролей. Новые — scrypt с теми же параметрами, что в Endemion Life.
// Перенесённые с Endemion — PBKDF2-SHA256 в формате pbkdf2$итерации$соль$хеш (base64), см. functions/_lib/crypto.js сайта.
// Старый хеш проверяется при входе и сразу заменяется на scrypt

import { pbkdf2, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const pbkdf2Async = promisify(pbkdf2);

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// scrypt требует 128 * N * r байт: 32 МБ при этих параметрах
const MAX_MEMORY = 64 * 1024 * 1024;
// Верхние границы параметров из базы: защита от строки, которая заставит считать часами
const MAX_PBKDF2_ITERATIONS = 1_000_000;
const MAX_SCRYPT_N = 2 ** 17;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

async function verifyScrypt(password, parts) {
  if (parts.length !== 6) return false;
  const [, n, r, p, saltText, keyText] = parts;
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY };
  if (!(options.N > 1 && options.N <= MAX_SCRYPT_N && options.r > 0 && options.r <= 16 && options.p > 0 && options.p <= 4)) return false;
  const expected = Buffer.from(keyText, "base64url");
  if (expected.length !== KEY_BYTES) return false;
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltText, "base64url"), expected.length, options);
  return timingSafeEqual(key, expected);
}

async function verifyPbkdf2(password, parts) {
  if (parts.length !== 4) return false;
  const [, iterationsText, saltText, hashText] = parts;
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
  const expected = Buffer.from(hashText, "base64");
  if (expected.length !== KEY_BYTES) return false;
  // Сайт хеширует пароль без NFKC (Web Crypto, TextEncoder) — здесь так же, иначе старые пароли не подойдут
  const key = await pbkdf2Async(password, Buffer.from(saltText, "base64"), iterations, expected.length, "sha256");
  return timingSafeEqual(key, expected);
}

/** Подходит ли пароль к хешу и нужно ли заменить хеш на scrypt с текущими параметрами */
export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  try {
    if (parts[0] === "scrypt") {
      const ok = await verifyScrypt(password, parts);
      return { ok, rehash: ok && (Number(parts[1]) !== N || Number(parts[2]) !== R || Number(parts[3]) !== P) };
    }
    if (parts[0] === "pbkdf2") {
      const ok = await verifyPbkdf2(password, parts);
      return { ok, rehash: ok };
    }
  } catch {
    // Повреждённая строка в базе: пароль просто не подходит
  }
  return { ok: false, rehash: false };
}

// Хеш для входа с несуществующей почтой: время ответа то же, что для настоящего аккаунта
export const DUMMY_HASH = ["scrypt", N, R, P, Buffer.alloc(SALT_BYTES, 7).toString("base64url"), Buffer.alloc(KEY_BYTES, 7).toString("base64url")].join("$");
