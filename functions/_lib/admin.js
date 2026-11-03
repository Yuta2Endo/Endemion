// Админка: проверка прав, разбор данных тайтлов и глав, страницы в R2.
// Права проверяются в каждом обработчике /api/admin/*: интерфейсу админки сервер не доверяет

import { verifyPassword } from "./crypto.js";
import { reauthUrl, recentlyAuthenticated } from "./endemionId.js";
import { clientIp, error, json } from "./http.js";
import { chapterPrefix, pageKey } from "./pages.js";
import { isLimited, recordAttempt, RETRY_AFTER_SECONDS } from "./rateLimit.js";
import { hasRole } from "./roles.js";
import { currentUser } from "./session.js";
import { getChapter, getTitle, parseId, searchColumns, TYPES } from "./titles.js";
import { PASSWORD_MAX } from "./validate.js";

export const MAX_PAGES = 500;
export const MAX_PAGE_BYTES = 15 * 1024 * 1024;
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

const RELEASE = ["ongoing", "completed"];
const COLOR = /^#[0-9a-f]{6}$/i;

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

/** Тайтл из адреса /api/admin/titles/:id/... или ответ 404 */
export async function findTitle(env, params) {
  const id = parseId(params.id);
  const title = id ? await getTitle(env, id) : null;
  return title ? { title } : { response: error("Тайтл не найден.", 404) };
}

/** Тайтл и глава из адреса /api/admin/titles/:id/chapters/:number/... или ответ 404 */
export async function findChapter(env, params) {
  const found = await findTitle(env, params);
  if (found.response) return found;
  const number = parseId(params.number);
  const chapter = number ? await getChapter(env, found.title.id, number) : null;
  return chapter ? { title: found.title, chapter } : { response: error("Глава не найдена.", 404) };
}

/** Однострочный текст: без управляющих символов и лишних пробелов */
function clean(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * Карточка тайтла из формы админки. Обложка собирается из трёх цветов на сервере:
 * CSS от пользователя в страницы не попадает
 */
export function parseTitle(body) {
  const title = clean(body.title);
  if (!title || title.length > 120) return { problem: "Название: от 1 до 120 символов." };
  if (!TYPES[body.type]) return { problem: "Выберите тип: манга, манхва или маньхуа." };
  if (!RELEASE.includes(body.status)) return { problem: "Выберите статус выпуска." };
  if (!Number.isInteger(body.year) || body.year < 1900 || body.year > 2100) return { problem: "Год: целое число от 1900 до 2100." };
  if (typeof body.rating !== "number" || !Number.isFinite(body.rating) || body.rating < 0 || body.rating > 10) {
    return { problem: "Рейтинг: число от 0 до 10." };
  }

  const genres = Array.isArray(body.genres) ? [...new Set(body.genres.map(clean).filter(Boolean))] : [];
  if (genres.length < 1 || genres.length > 8) return { problem: "Жанры: от 1 до 8." };
  if (genres.some((genre) => genre.length > 30)) return { problem: "Название жанра не длиннее 30 символов." };

  const author = clean(body.author);
  if (!author || author.length > 120) return { problem: "Автор: от 1 до 120 символов." };
  const translator = clean(body.translator);
  if (!translator || translator.length > 120) return { problem: "Перевод: от 1 до 120 символов." };
  const symbol = clean(body.symbol);
  const symbolLength = [...symbol].length;
  if (symbolLength < 1 || symbolLength > 3) return { problem: "Символ обложки: от 1 до 3 знаков." };

  const colors = Array.isArray(body.colors) ? body.colors : [];
  if (colors.length !== 3 || !colors.every((color) => typeof color === "string" && COLOR.test(color))) {
    return { problem: "Цвета обложки: три цвета в формате #rrggbb." };
  }
  const [c0, c1, c2] = colors.map((color) => color.toLowerCase());

  const description = clean(body.description);
  if (!description || description.length > 2000) return { problem: "Описание: от 1 до 2000 символов." };

  const originalTitle = clean(body.originalTitle);
  if (originalTitle.length > 160) return { problem: "Оригинальное название не длиннее 160 символов." };

  let releaseDay = null;
  if (body.releaseDay !== null && body.releaseDay !== undefined && body.releaseDay !== "") {
    if (!Number.isInteger(body.releaseDay) || body.releaseDay < 0 || body.releaseDay > 6) return { problem: "День выхода: от 0 (вс) до 6 (сб)." };
    releaseDay = body.releaseDay;
  }

  return {
    title: {
      title,
      originalTitle,
      releaseDay: body.status === "ongoing" ? releaseDay : null,
      type: body.type,
      year: body.year,
      status: body.status,
      rating: Math.round(body.rating * 10) / 10,
      genres,
      author,
      translator,
      symbol,
      poster: `linear-gradient(145deg, ${c0}, ${c1} 55%, ${c2})`,
      description
    }
  };
}

/** Значения для INSERT и UPDATE в порядке столбцов TITLE_COLUMNS. Строки поиска пересчитываются при каждом сохранении */
export const TITLE_COLUMNS = [
  "title", "original_title", "type", "year", "status", "rating", "genres", "author", "translator", "symbol", "poster", "description",
  "release_day", "search_text", "search_title", "search_author", "search_genres"
];

export function titleValues(title) {
  const search = searchColumns(title);
  const values = {
    ...title,
    original_title: title.originalTitle,
    release_day: title.releaseDay,
    genres: JSON.stringify(title.genres),
    ...search
  };
  return TITLE_COLUMNS.map((name) => values[name]);
}

/** Https-ссылки на легальные источники: [{ name, url, kind }] */
export function parseSources(value) {
  if (value === undefined) return { sources: null };
  if (!Array.isArray(value) || value.length > 10) return { problem: "Источники: не больше 10." };
  const sources = [];
  for (const item of value) {
    const name = clean(item?.name);
    const url = clean(item?.url);
    const kind = item?.kind || "official";
    if (!name || name.length > 80) return { problem: "Название источника: от 1 до 80 символов." };
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {}
    if (!parsed || parsed.protocol !== "https:" || url.length > 500) return { problem: `Ссылка источника «${name}» должна начинаться с https://.` };
    if (!["official", "publisher", "store", "licensed"].includes(kind)) return { problem: "Неизвестный вид источника." };
    sources.push({ name, url: parsed.href, kind });
  }
  return { sources };
}

/** Данные главы из формы. releasedAt: null — сейчас (новая глава) или без изменений (правка) */
export function parseChapter(body) {
  const name = clean(body.name);
  if (name.length > 120) return { problem: "Название главы не длиннее 120 символов." };

  let volume = null;
  if (body.volume !== null && body.volume !== undefined) {
    if (!Number.isInteger(body.volume) || body.volume < 1 || body.volume > 999) return { problem: "Том: целое число от 1 до 999." };
    volume = body.volume;
  }

  if (typeof body.sideStory !== "boolean") return { problem: "Некорректная пометка экстры." };

  let releasedAt = null;
  if (body.releasedAt !== null && body.releasedAt !== undefined && body.releasedAt !== "") {
    // Дата должна существовать: 2026-02-31 не пройдёт, потому что Date перенесёт её на март
    const valid = typeof body.releasedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.releasedAt) &&
      !Number.isNaN(Date.parse(body.releasedAt)) && new Date(body.releasedAt).toISOString().slice(0, 10) === body.releasedAt;
    if (!valid) return { problem: "Дата выхода в формате ГГГГ-ММ-ДД." };
    releasedAt = `${body.releasedAt} 12:00:00`;
  }

  return { chapter: { name: name || null, volume, sideStory: body.sideStory ? 1 : 0, releasedAt } };
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

/** Номер первой страницы версии, которой нет в R2, или 0, если загружены все */
export async function missingPage(bucket, titleId, chapter, version, count) {
  const BATCH = 25;
  for (let start = 1; start <= count; start += BATCH) {
    const numbers = Array.from({ length: Math.min(BATCH, count - start + 1) }, (_, i) => start + i);
    const heads = await Promise.all(numbers.map((page) => bucket.head(pageKey(titleId, chapter, version, page))));
    const index = heads.findIndex((head) => !head);
    if (index >= 0) return numbers[index];
  }
  return 0;
}

/**
 * Удалить файлы страниц в R2 по префиксу. keep(key) — какие ключи оставить.
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

/** После публикации нужны только страницы 1..count новой версии: старые версии и лишние файлы черновика удаляются */
export function deleteOldPages(bucket, titleId, chapter, version, count) {
  const prefix = chapterPrefix(titleId, chapter);
  return deletePages(bucket, prefix, (key) => {
    const [keyVersion, page] = key.slice(prefix.length).split("/").map(Number);
    return keyVersion === version && page >= 1 && page <= count;
  });
}
