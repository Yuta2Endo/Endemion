// Админка: проверка прав, подтверждение паролем, проверка картинок, удаление файлов из хранилища.
// Права проверяются в каждом обработчике /api/admin/*: интерфейсу админки сервер не доверяет

import { verifyPassword } from "./crypto.js";
import { reauthUrl, recentlyAuthenticated } from "./endemionId.js";
import { clientIp, error, json } from "./http.js";
import { isLimited, recordAttempt, RETRY_AFTER_SECONDS } from "./rateLimit.js";
import { hasRole } from "./roles.js";
import { currentUser } from "./session.js";
import { PASSWORD_MAX } from "./validate.js";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Администратор текущей сессии или готовый ответ с ошибкой */
export async function requireAdmin(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { response: error("Войдите в профиль.", 401) };
  if (!hasRole(user, "admin")) return { response: error("Нужны права администратора.", 403) };
  return { user };
}

/**
 * Пароль администратора для опасных действий: выдача и снятие прав, удаление аккаунта.
 * Украденная сессия без пароля их не выполнит. Неудачные попытки ограничены, как при входе.
 * Возвращает ответ с ошибкой или null, если пароль верный
 */
export async function confirmPassword(env, request, user, password) {
  // Вход через Endemion ID: пароля на сайте нет, вместо него нужен свежий вход в Endemion ID (не старше 10 минут)
  if (user.viaEndemionId) {
    if (recentlyAuthenticated(user)) return null;
    return json({ error: "Подтвердите, что это вы: войдите в Endemion ID ещё раз и сразу повторите действие.", reauth: reauthUrl("/admin") }, 403);
  }
  const ip = clientIp(request);
  if (await isLimited(env, ip, user.email)) {
    return error("Слишком много неудачных попыток. Попробуйте через 15 минут.", 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });
  }
  if (typeof password === "string" && password && password.length <= PASSWORD_MAX) {
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first();
    if (row && (await verifyPassword(password, row.password_hash))) return null;
  }
  await recordAttempt(env, ip, user.email);
  return error("Неверный пароль.", 403);
}

/** Тип картинки по первым байтам файла. Заголовку Content-Type от клиента не доверяем */
export function imageType(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return null;
}

/**
 * Удалить файлы в хранилище по префиксу. keep(key) — какие ключи оставить.
 * Без keep удаляется всё под префиксом
 * @param {any} bucket
 * @param {string} prefix
 * @param {(key: string) => boolean} [keep]
 */
export async function deletePages(bucket, prefix, keep = () => false) {
  if (!bucket) return;
  let cursor;
  do {
    const list = await bucket.list({ prefix, cursor });
    const keys = list.objects.map((object) => object.key).filter((key) => !keep(key));
    if (keys.length) await bucket.delete(keys);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
