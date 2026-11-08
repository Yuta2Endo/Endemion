// Анонсы обновлений игр в Telegram-канал @EndemionOfficial.
// Источник релиза — опубликованная запись студии (kind "update") из studio_posts.
// Публикация только явно, действием администратора; никогда автоматически.
// Токен бота только в переменной окружения TELEGRAM_BOT_TOKEN: не в логах, не во фронтенд, не в git.

import { sendTelegramMessage } from "./telegram.js";
import { getPost, getGame } from "./studio.js";

const DEFAULT_CHANNEL = "@EndemionOfficial";

export function channelOf(env) {
  return (env && env.TELEGRAM_CHANNEL) || DEFAULT_CHANNEL;
}

export function isPublishingAllowed(env) {
  return (env && env.TELEGRAM_PUBLISH) === "1";
}

/** Релиз из записи студии и связанной игры. */
export function releaseFromPost(post, game) {
  if (!post) return null;
  return {
    postId: post.id,
    kind: post.kind,
    status: post.status,
    version: post.version || null,
    title: post.title || "",
    notes: post.body || "",
    date: post.published_at || post.created_at || "",
    gameUrl: game && game.websiteUrl ? game.websiteUrl : null,
    gameTitle: game ? game.title : null
  };
}

/** Ошибки отсутствующих данных релиза. Пусто — достаточно данных для анонса. */
export function releaseProblems(release) {
  const problems = [];
  if (!release.title) problems.push("Заголовок выпуска не указан.");
  if (!release.notes) problems.push("Заметки к выпуску не указаны.");
  if (!release.gameUrl) problems.push("Ссылка на игру не указана.");
  return problems;
}

function formatDateRu(value) {
  if (!value) return "";
  const date = new Date(`${String(value).replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow"
  });
}

/** Текст анонса по примеру стиля Endemion. Только обычный текст (без parse_mode), символы экранировать не нужно. */
export function formatAnnouncement(release) {
  const lines = [];
  lines.push("🌌 ENDEMION LIFE — ОБНОВЛЕНИЕ");
  lines.push("");
  if (release.version) {
    lines.push(`Версия: ${release.version}`);
    lines.push("");
  }
  lines.push(release.title);
  lines.push("");
  lines.push("✨ Что нового:");
  lines.push(release.notes);
  lines.push("");
  if (release.date) {
    lines.push(`📅 ${formatDateRu(release.date)}`);
    lines.push("");
  }
  lines.push("🎮 Играть:");
  lines.push(release.gameUrl);
  lines.push("");
  lines.push("Официальный Телеграм:");
  lines.push("https://t.me/EndemionOfficial");
  return lines.join("\n");
}

/** Запись публикации для поста или null. */
export async function telegramRecord(env, postId) {
  return await env.DB.prepare("SELECT * FROM telegram_posts WHERE post_id = ?").bind(postId).first();
}

/** Установить запись в состояние pending (создать или сбросить после неудачи). */
async function setPending(env, postId, chatId) {
  const exists = await telegramRecord(env, postId);
  if (exists) {
    await env.DB.prepare(
      `UPDATE telegram_posts SET status = 'pending', chat_id = ?, message_id = NULL, error = NULL,
       attempts = 0, updated_at = datetime('now') WHERE post_id = ?`
    ).bind(chatId, postId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO telegram_posts (post_id, status, chat_id, attempts, created_at, updated_at)
       VALUES (?, 'pending', ?, 0, datetime('now'), datetime('now'))`
    ).bind(postId, chatId).run();
  }
}

/** Пометить запись как опубликованную. */
async function setPublished(env, postId, messageId) {
  await env.DB.prepare(
    `UPDATE telegram_posts SET status = 'published', message_id = ?, published_at = datetime('now'),
     updated_at = datetime('now') WHERE post_id = ?`
  ).bind(messageId, postId).run();
}

/** Пометить запись как неудачную. */
async function setFailed(env, postId, error) {
  await env.DB.prepare(
    `UPDATE telegram_posts SET status = 'failed', error = ?, attempts = attempts + 1,
     updated_at = datetime('now') WHERE post_id = ?`
  ).bind(error, postId).run();
}

/**
 * Опубликовать анонс релиза в канал Telegram.
 * dryRun = true — только сформировать текст, не отправлять и не писать в базу.
 * Возвращает { ok, messageId, error, retryAfter, duplicate, dryRun, text, postId }.
 * Неудачная отправка не создаёт дубля: запись остаётся failed и повторит попытку при следующем вызове.
 */
export async function announceRelease(env, postId, { dryRun = false } = {}) {
  const post = await getPost(env, postId);
  if (!post) return { ok: false, error: "Публикация не найдена.", postId, notFound: true };
  if (post.kind !== "update") return { ok: false, error: "Анонс доступен только для обновлений игр (kind update).", postId };
  if (post.status !== "published") return { ok: false, error: "Публикация не опубликована.", postId };

  const game = post.game && post.game.id ? await getGame(env, post.game.id) : null;
  const release = releaseFromPost(post, game);
  const problems = releaseProblems(release);
  if (problems.length) return { ok: false, error: problems.join(" "), problems, postId };

  const text = formatAnnouncement(release);
  if (dryRun) return { ok: true, dryRun: true, text, postId, release };

  const chatId = channelOf(env);
  if (!isPublishingAllowed(env)) {
    return {
      ok: false, error: "Публикация в Телеграм выключена. Задайте TELEGRAM_PUBLISH=1.",
      configure: true, postId, text
    };
  }
  if (!env || !env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false, error: "Telegram бот не настроен: задайте TELEGRAM_BOT_TOKEN.",
      configure: true, postId, text
    };
  }

  const existing = await telegramRecord(env, postId);
  if (existing && existing.status === "published") {
    return { ok: true, duplicate: true, messageId: existing.message_id, chatId: existing.chat_id, postId, text };
  }

  await setPending(env, postId, chatId);

  const result = await sendTelegramMessage(env, chatId, text);
  // Токен не попадает в логи: ошибка содержит только статус API или сообщение сети.
  if (result.ok) {
    await setPublished(env, postId, result.messageId || null);
    return { ok: true, messageId: result.messageId, chatId, postId, text };
  }
  await setFailed(env, postId, result.error || "Неизвестная ошибка Telegram API.");
  console.error(`Телеграм: анонс публикации #${postId} не доставлен: ${result.error}`);
  return { ok: false, error: result.error, retryAfter: result.retryAfter, postId, text };
}

/** Предварительный просмотр текста анонса без отправки и без записи в базу. */
export async function previewRelease(env, postId) {
  const post = await getPost(env, postId);
  if (!post) return { ok: false, error: "Публикация не найдена.", notFound: true };
  const game = post.game && post.game.id ? await getGame(env, post.game.id) : null;
  const release = releaseFromPost(post, game);
  const problems = releaseProblems(release);
  return {
    ok: problems.length === 0,
    problems,
    text: problems.length ? null : formatAnnouncement(release),
    release
  };
}

/** Список опубликованных обновлений игр, ещё не отправленных в Телеграм. */
export async function pendingReleases(env) {
  const rows = await env.DB.prepare(
    `SELECT sp.id, sp.slug, sp.title, sp.version, sp.published_at, sp.created_at,
            g.title AS game_title, g.website_url AS game_url
     FROM studio_posts sp LEFT JOIN games g ON g.id = sp.game_id
     WHERE sp.kind = 'update' AND sp.status = 'published'
       AND NOT EXISTS (SELECT 1 FROM telegram_posts tp WHERE tp.post_id = sp.id AND tp.status = 'published')
     ORDER BY sp.published_at DESC, sp.id DESC`
  ).all();
  return rows.results.map((row) => ({
    id: row.id, slug: row.slug, title: row.title, version: row.version || null,
    date: row.published_at || row.created_at, game: row.game_url ? { title: row.game_title, url: row.game_url } : null
  }));
}
