// Админка портала: игры со скриншотами, публикации студии, категории форума, настройки сайта.
// Только администратор: права проверяются в каждом обработчике. Каждый экспорт — маршрут, адреса в src/worker.js

import { deletePages, imageType, MAX_COVER_BYTES, requireAdmin } from "../_lib/admin.js";
import { audit } from "../_lib/audit.js";
import { error, json, readJson } from "../_lib/http.js";
import {
  FORUM_SECTIONS, GAME_STATUSES, getGame, getPost, getSettings, listGameMedia, listGames, listPosts, POST_KINDS, POST_STATUSES, SLUG, toCategory
} from "../_lib/studio.js";
import { announceRelease, formatAnnouncement, pendingReleases, previewRelease, releaseFromPost, releaseProblems } from "../_lib/telegram-announce.js";
import { cleanLine, cleanText, intParam, lengthProblem, parseId } from "../_lib/validate.js";
import { gameCoverKey, gameShotKey, postImageKey } from "../media.js";

const MAX_SHOTS = 20;
const SECTION_KEYS = FORUM_SECTIONS.map(([key]) => key);
const isUnique = (err) => String(err).includes("UNIQUE");

function slugProblem(slug, max) {
  if (typeof slug !== "string" || slug.length < 2 || slug.length > max || !SLUG.test(slug)) {
    return `Адрес: от 2 до ${max} символов, латиница в нижнем регистре, цифры и дефисы.`;
  }
  return null;
}

/** Https-ссылка или null. Другие схемы (javascript:, http:) не принимаются */
function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Файл картинки из тела запроса: размер и тип проверяются по самому файлу */
async function readImage(env, request) {
  if (!env.PAGES) return { response: error("Хранилище картинок не подключено.", 500) };
  const length = Number(request.headers.get("Content-Length"));
  if (!length || length > MAX_COVER_BYTES) return { response: error("Картинка должна быть не больше 5 МБ.", 413) };
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) return { response: error("Картинка должна быть не больше 5 МБ.", 413) };
  const type = imageType(buffer);
  if (!type) return { response: error("Нужна картинка JPEG, PNG, WebP или AVIF.", 415) };
  return { buffer, type };
}

/** Игра из адреса или ответ 404 */
async function findGame(env, params) {
  const id = parseId(params.id);
  const game = id ? await getGame(env, id) : null;
  return game ? { game } : { response: error("Игра не найдена.", 404) };
}

/** Публикация из адреса или ответ 404 */
async function findPost(env, params) {
  const id = parseId(params.id);
  const post = id ? await getPost(env, id) : null;
  return post ? { post } : { response: error("Публикация не найдена.", 404) };
}

// ==================== ИГРЫ ====================

function parseGame(body) {
  if (!body) return { problem: "Некорректные данные." };
  const slugIssue = slugProblem(body.slug, 60);
  if (slugIssue) return { problem: slugIssue };
  const title = cleanLine(body.title);
  const tagline = cleanLine(body.tagline ?? "");
  const description = cleanText(body.description ?? "");
  const platforms = cleanLine(body.platforms ?? "");
  const roadmap = cleanText(body.roadmap ?? "");
  const knownIssues = cleanText(body.knownIssues ?? "");
  const problem = lengthProblem(title, "Название", 2, 80) || lengthProblem(tagline, "Короткое описание", 0, 200) ||
    lengthProblem(description, "Описание", 0, 10000) || lengthProblem(platforms, "Платформы", 0, 200) ||
    lengthProblem(roadmap, "Планы", 0, 5000) || lengthProblem(knownIssues, "Известные проблемы", 0, 5000);
  if (problem) return { problem };
  const status = body.status || null;
  if (status && !GAME_STATUSES.includes(status)) return { problem: "Неизвестный статус игры." };
  const websiteUrl = cleanLine(body.websiteUrl ?? "");
  if (websiteUrl && !httpsUrl(websiteUrl)) return { problem: "Сайт игры должен начинаться с https://." };
  const position = body.position ?? 0;
  if (!Number.isInteger(position) || position < 0 || position > 9999) return { problem: "Порядок: целое число от 0 до 9999." };
  return {
    game: {
      slug: body.slug, title, tagline, description, status, platforms, websiteUrl, roadmap, knownIssues, position,
      isUpcoming: body.isUpcoming === true ? 1 : 0,
      published: body.published === true ? 1 : 0
    }
  };
}

export const adminGames = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    return json({ games: await listGames(env, { withHidden: true }), statuses: GAME_STATUSES });
  },
  async onRequestPost({ request, env }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const { game, problem } = parseGame(await readJson(request, 30_000));
    if (problem) return error(problem);
    let id;
    try {
      const result = await env.DB.prepare(
        `INSERT INTO games (slug, title, tagline, description, status, platforms, website_url, roadmap, known_issues, is_upcoming, published, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(game.slug, game.title, game.tagline, game.description, game.status, game.platforms, game.websiteUrl, game.roadmap, game.knownIssues, game.isUpcoming, game.published, game.position).run();
      id = result.meta.last_row_id;
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${game.slug}» уже занят.`, 409);
      throw err;
    }
    // У каждой игры своя категория на форуме, как у игр из миграции. Занятый адрес категории не мешает создать игру
    await env.DB.prepare(
      "INSERT INTO forum_categories (slug, section, title, game_id, position) SELECT ?, 'games', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM forum_categories WHERE slug = ?)"
    ).bind(game.slug, game.title, id, game.position, game.slug).run();
    await audit(env, user, "game.create", `«${game.title}» (#${id})`);
    return json({ game: await getGame(env, id) }, 201);
  }
};

export const adminGame = {
  async onRequestGet({ request, env, params }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    return json({ game: found.game, media: await listGameMedia(env, found.game.id) });
  },
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    const { game, problem } = parseGame(await readJson(request, 30_000));
    if (problem) return error(problem);
    const statements = [
      env.DB.prepare(
        `UPDATE games SET slug = ?, title = ?, tagline = ?, description = ?, status = ?, platforms = ?, website_url = ?, roadmap = ?, known_issues = ?,
         is_upcoming = ?, published = ?, position = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(game.slug, game.title, game.tagline, game.description, game.status, game.platforms, game.websiteUrl, game.roadmap, game.knownIssues, game.isUpcoming, game.published, game.position, found.game.id)
    ];
    // Главная игра хранится по адресу: при смене адреса настройка должна идти за ней
    if (game.slug !== found.game.slug) {
      statements.push(env.DB.prepare("UPDATE site_settings SET value = ?, updated_at = datetime('now') WHERE key = 'featured_game' AND value = ?").bind(game.slug, found.game.slug));
    }
    try {
      await env.DB.batch(statements);
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${game.slug}» уже занят.`, 409);
      throw err;
    }
    await audit(env, user, "game.update", `«${game.title}» (#${found.game.id})`);
    return json({ game: await getGame(env, found.game.id) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    const settings = await getSettings(env);
    if (settings.featuredGame === found.game.slug) return error("Эта игра показана на главной. Сначала выберите другую в настройках сайта.", 409);
    // Категория форума и публикации остаются: у них только снимается связь с игрой (ON DELETE SET NULL)
    await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(found.game.id).run();
    await deletePages(env.PAGES, `games/${found.game.id}/`);
    await audit(env, user, "game.delete", `«${found.game.title}» (#${found.game.id})`);
    return json({ ok: true });
  }
};

export const adminGameCover = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    const image = await readImage(env, request);
    if (image.response) return image.response;
    const { game } = found;
    const version = (game.coverVersion || 0) + 1;
    await env.PAGES.put(gameCoverKey(game.id, version), image.buffer, { httpMetadata: { contentType: image.type } });
    // Условие на прежнюю версию: две загрузки из разных вкладок не перепутают файлы
    const result = await env.DB.prepare("UPDATE games SET cover_version = ?, updated_at = datetime('now') WHERE id = ? AND cover_version IS ?")
      .bind(version, game.id, game.coverVersion).run();
    if (!result.meta.changes) {
      await env.PAGES.delete(gameCoverKey(game.id, version));
      return error("Обложку только что изменили. Обновите страницу.", 409);
    }
    if (game.coverVersion) await env.PAGES.delete(gameCoverKey(game.id, game.coverVersion));
    await audit(env, user, "game.cover", `«${game.title}» (#${game.id})`);
    return json({ game: await getGame(env, game.id) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    await env.DB.prepare("UPDATE games SET cover_version = NULL, updated_at = datetime('now') WHERE id = ?").bind(found.game.id).run();
    await deletePages(env.PAGES, `games/${found.game.id}/cover/`);
    await audit(env, user, "game.coverDelete", `«${found.game.title}» (#${found.game.id})`);
    return json({ game: await getGame(env, found.game.id) });
  }
};

export const adminGameMedia = {
  /** Тело запроса — файл картинки, подпись в ?caption= */
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    const caption = cleanLine(new URL(request.url).searchParams.get("caption") || "");
    const problem = lengthProblem(caption, "Подпись", 0, 200);
    if (problem) return error(problem);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM game_media WHERE game_id = ?").bind(found.game.id).first();
    if (n >= MAX_SHOTS) return error(`У игры может быть не больше ${MAX_SHOTS} скриншотов.`, 409);
    const image = await readImage(env, request);
    if (image.response) return image.response;
    const result = await env.DB.prepare("INSERT INTO game_media (game_id, caption, content_type, position) VALUES (?, ?, ?, ?)")
      .bind(found.game.id, caption, image.type, n + 1).run();
    const mediaId = result.meta.last_row_id;
    try {
      await env.PAGES.put(gameShotKey(found.game.id, mediaId), image.buffer, { httpMetadata: { contentType: image.type } });
    } catch (err) {
      await env.DB.prepare("DELETE FROM game_media WHERE id = ?").bind(mediaId).run();
      throw err;
    }
    await audit(env, user, "game.shot", `«${found.game.title}» (#${found.game.id})`);
    return json({ media: await listGameMedia(env, found.game.id) }, 201);
  }
};

export const adminGameMediaItem = {
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findGame(env, params);
    if (found.response) return found.response;
    const mediaId = parseId(params.mediaId);
    const row = mediaId ? await env.DB.prepare("SELECT id FROM game_media WHERE id = ? AND game_id = ?").bind(mediaId, found.game.id).first() : null;
    if (!row) return error("Скриншот не найден.", 404);
    await env.DB.prepare("DELETE FROM game_media WHERE id = ?").bind(mediaId).run();
    if (env.PAGES) await env.PAGES.delete(gameShotKey(found.game.id, mediaId));
    await audit(env, user, "game.shotDelete", `«${found.game.title}» (#${found.game.id})`);
    return json({ media: await listGameMedia(env, found.game.id) });
  }
};

// ==================== ПУБЛИКАЦИИ СТУДИИ ====================

async function parsePost(env, body) {
  if (!body) return { problem: "Некорректные данные." };
  const slugIssue = slugProblem(body.slug, 80);
  if (slugIssue) return { problem: slugIssue };
  if (!POST_KINDS.includes(body.kind)) return { problem: "Неизвестный вид публикации." };
  if (!POST_STATUSES.includes(body.status)) return { problem: "Неизвестный статус публикации." };
  const title = cleanLine(body.title);
  const summary = cleanLine(body.summary ?? "");
  const text = cleanText(body.body ?? "");
  const version = cleanLine(body.version ?? "");
  const problem = lengthProblem(title, "Заголовок", 3, 160) || lengthProblem(summary, "Краткое описание", 0, 400) || lengthProblem(text, "Текст", 0, 50000) ||
    lengthProblem(version, "Версия", 0, 40);
  if (problem) return { problem };
  if (body.status === "published" && !text) return { problem: "Нельзя опубликовать пустой текст: сохраните как черновик." };
  let gameId = null;
  if (body.gameId !== null && body.gameId !== undefined && body.gameId !== "") {
    gameId = parseId(body.gameId);
    const game = gameId ? await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(gameId).first() : null;
    if (!game) return { problem: "Игра не найдена." };
  }
  return { post: { slug: body.slug, kind: body.kind, status: body.status, title, summary, body: text, gameId, version } };
}

export const adminPosts = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const params = new URL(request.url).searchParams;
    const status = params.get("status") || null;
    if (status && !POST_STATUSES.includes(status)) return error("Неизвестный статус.");
    const limit = intParam(params.get("limit"), 50, 1, 100);
    const offset = intParam(params.get("offset"), 0, 0, 1_000_000);
    if (limit === null || offset === null) return error("Некорректные limit или offset.");
    return json(await listPosts(env, { status, limit, offset }));
  },
  async onRequestPost({ request, env }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const { post, problem } = await parsePost(env, await readJson(request, 60_000));
    if (problem) return error(problem);
    let id;
    try {
      const result = await env.DB.prepare(
        `INSERT INTO studio_posts (slug, kind, status, title, summary, body, game_id, author_id, version, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') END)`
      ).bind(post.slug, post.kind, post.status, post.title, post.summary, post.body, post.gameId, user.id, post.version, post.status).run();
      id = result.meta.last_row_id;
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${post.slug}» уже занят.`, 409);
      throw err;
    }
    await audit(env, user, "post.create", `«${post.title}» (#${id})`);
    return json({ post: await getPost(env, id) }, 201);
  }
};

export const adminPost = {
  async onRequestGet({ request, env, params }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findPost(env, params);
    if (found.response) return found.response;
    return json({ post: found.post });
  },
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findPost(env, params);
    if (found.response) return found.response;
    const { post, problem } = await parsePost(env, await readJson(request, 60_000));
    if (problem) return error(problem);
    try {
      // Дата ставится при первой публикации и дальше не меняется: снятие с публикации и возврат не двигают запись в ленте
      await env.DB.prepare(
        `UPDATE studio_posts SET slug = ?, kind = ?, status = ?, title = ?, summary = ?, body = ?, game_id = ?, version = ?,
         published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, datetime('now')) ELSE published_at END,
         updated_at = datetime('now') WHERE id = ?`
      ).bind(post.slug, post.kind, post.status, post.title, post.summary, post.body, post.gameId, post.version, post.status, found.post.id).run();
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${post.slug}» уже занят.`, 409);
      throw err;
    }
    await audit(env, user, found.post.status === post.status ? "post.update" : `post.${post.status}`, `«${post.title}» (#${found.post.id})`);
    return json({ post: await getPost(env, found.post.id) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findPost(env, params);
    if (found.response) return found.response;
    await env.DB.prepare("DELETE FROM studio_posts WHERE id = ?").bind(found.post.id).run();
    await deletePages(env.PAGES, `posts/${found.post.id}/`);
    await audit(env, user, "post.delete", `«${found.post.title}» (#${found.post.id})`);
    return json({ ok: true });
  }
};

export const adminPostImage = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findPost(env, params);
    if (found.response) return found.response;
    const image = await readImage(env, request);
    if (image.response) return image.response;
    const { post } = found;
    const version = (post.imageVersion || 0) + 1;
    await env.PAGES.put(postImageKey(post.id, version), image.buffer, { httpMetadata: { contentType: image.type } });
    const result = await env.DB.prepare("UPDATE studio_posts SET image_version = ?, updated_at = datetime('now') WHERE id = ? AND image_version IS ?")
      .bind(version, post.id, post.imageVersion).run();
    if (!result.meta.changes) {
      await env.PAGES.delete(postImageKey(post.id, version));
      return error("Картинку только что изменили. Обновите страницу.", 409);
    }
    if (post.imageVersion) await env.PAGES.delete(postImageKey(post.id, post.imageVersion));
    await audit(env, user, "post.image", `«${post.title}» (#${post.id})`);
    return json({ post: await getPost(env, post.id) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const found = await findPost(env, params);
    if (found.response) return found.response;
    await env.DB.prepare("UPDATE studio_posts SET image_version = NULL, updated_at = datetime('now') WHERE id = ?").bind(found.post.id).run();
    await deletePages(env.PAGES, `posts/${found.post.id}/`);
    await audit(env, user, "post.imageDelete", `«${found.post.title}» (#${found.post.id})`);
    return json({ post: await getPost(env, found.post.id) });
  }
};

// ==================== КАТЕГОРИИ ФОРУМА ====================

/** Все категории для админки, включая категории неопубликованных игр */
async function allCategories(env) {
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.slug, c.section, c.title, c.description, c.staff_only, c.position, c.game_id, g.slug AS game_slug,
       (SELECT COUNT(*) FROM threads th WHERE th.category_id = c.id AND th.deleted_at IS NULL) AS topics,
       (SELECT COUNT(*) FROM threads th WHERE th.category_id = c.id) AS all_topics
     FROM forum_categories c LEFT JOIN games g ON g.id = c.game_id ORDER BY c.section, c.position, c.id`
  ).all()).results;
  return rows.map((row) => ({ ...toCategory(row), gameId: row.game_id, position: row.position, allTopics: row.all_topics }));
}

async function parseCategory(env, body) {
  if (!body) return { problem: "Некорректные данные." };
  const slugIssue = slugProblem(body.slug, 60);
  if (slugIssue) return { problem: slugIssue };
  if (!SECTION_KEYS.includes(body.section)) return { problem: "Неизвестный раздел форума." };
  const title = cleanLine(body.title);
  const description = cleanLine(body.description ?? "");
  const problem = lengthProblem(title, "Название", 2, 80) || lengthProblem(description, "Описание", 0, 300);
  if (problem) return { problem };
  const position = body.position ?? 0;
  if (!Number.isInteger(position) || position < 0 || position > 9999) return { problem: "Порядок: целое число от 0 до 9999." };
  let gameId = null;
  if (body.gameId !== null && body.gameId !== undefined && body.gameId !== "") {
    gameId = parseId(body.gameId);
    const game = gameId ? await env.DB.prepare("SELECT id FROM games WHERE id = ?").bind(gameId).first() : null;
    if (!game) return { problem: "Игра не найдена." };
  }
  return { category: { slug: body.slug, section: body.section, title, description, gameId, position, staffOnly: body.staffOnly === true ? 1 : 0 } };
}

export const adminCategories = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    return json({ categories: await allCategories(env) });
  },
  async onRequestPost({ request, env }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const { category: c, problem } = await parseCategory(env, await readJson(request));
    if (problem) return error(problem);
    try {
      await env.DB.prepare("INSERT INTO forum_categories (slug, section, title, description, game_id, staff_only, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(c.slug, c.section, c.title, c.description, c.gameId, c.staffOnly, c.position).run();
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${c.slug}» уже занят.`, 409);
      throw err;
    }
    await audit(env, user, "forum.create", `«${c.title}»`);
    return json({ categories: await allCategories(env) }, 201);
  }
};

export const adminCategory = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT slug FROM forum_categories WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Категория не найдена.", 404);
    const { category: c, problem } = await parseCategory(env, await readJson(request));
    if (problem) return error(problem);
    // Сюда попадают темы без выбранной категории: её адрес менять нельзя
    if (row.slug === "general" && c.slug !== "general") return error("Адрес основной категории менять нельзя.", 409);
    try {
      await env.DB.prepare("UPDATE forum_categories SET slug = ?, section = ?, title = ?, description = ?, game_id = ?, staff_only = ?, position = ? WHERE id = ?")
        .bind(c.slug, c.section, c.title, c.description, c.gameId, c.staffOnly, c.position, id).run();
    } catch (err) {
      if (isUnique(err)) return error(`Адрес «${c.slug}» уже занят.`, 409);
      throw err;
    }
    await audit(env, user, "forum.update", `«${c.title}» (#${id})`);
    return json({ categories: await allCategories(env) });
  },
  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT slug, title FROM forum_categories WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Категория не найдена.", 404);
    if (row.slug === "general") return error("Основную категорию удалить нельзя.", 409);
    // Темы пользователей не должны терять раздел. Считаются и удалённые: их может восстановить модератор
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM threads WHERE category_id = ?").bind(id).first();
    if (n > 0) return error("В категории есть темы. Сначала перенесите их в другую категорию.", 409);
    await env.DB.prepare("DELETE FROM forum_categories WHERE id = ?").bind(id).run();
    await audit(env, user, "forum.delete", `«${row.title}» (#${id})`);
    return json({ categories: await allCategories(env) });
  }
};

// ==================== НАСТРОЙКИ САЙТА ====================

function parseSocialLinks(value) {
  if (!Array.isArray(value) || value.length > 10) return { problem: "Ссылки на соцсети: не больше 10." };
  const links = [];
  for (const item of value) {
    const label = cleanLine(item?.label);
    const url = cleanLine(item?.url);
    if (!label || [...label].length > 40) return { problem: "Название соцсети: от 1 до 40 символов." };
    if (!httpsUrl(url)) return { problem: `Ссылка «${label}» должна начинаться с https://.` };
    links.push({ label, url });
  }
  return { links };
}

export const adminSiteSettings = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    return json({ settings: await getSettings(env), games: await listGames(env, { upcoming: false }) });
  },
  async onRequestPut({ request, env }) {
    const { user, response } = await requireAdmin(env, request);
    if (response) return response;
    const body = await readJson(request, 20_000);
    if (!body) return error("Некорректные данные.");
    const featured = typeof body.featuredGame === "string" ? body.featuredGame : "";
    if (featured) {
      const game = SLUG.test(featured) ? await env.DB.prepare("SELECT id FROM games WHERE slug = ? AND published = 1").bind(featured).first() : null;
      if (!game) return error("На главной можно показать только опубликованную игру.");
    }
    const { links, problem } = parseSocialLinks(body.socialLinks ?? []);
    if (problem) return error(problem);
    const aboutText = cleanText(body.aboutText ?? "");
    const aboutProblem = lengthProblem(aboutText, "Текст о студии", 0, 5000);
    if (aboutProblem) return error(aboutProblem);
    const upsert = (key, value) => env.DB.prepare(
      "INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    ).bind(key, value);
    await env.DB.batch([upsert("featured_game", featured), upsert("social_links", JSON.stringify(links)), upsert("about_text", aboutText)]);
    await audit(env, user, "settings.update", "настройки сайта");
    return json({ settings: await getSettings(env) });
  }
};

// ==================== АНОНСЫ В ТЕЛЕГРАМ ====================

/** Предварительный просмотр текста анонса без отправки. */
export const adminPostTelegramPreview = {
  async onRequestGet({ request, env, params }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const result = id ? await previewRelease(env, id) : { ok: false, error: "Публикация не найдена.", notFound: true };
    if (!result.ok) {
      if (result.problems) return json({ ok: false, problems: result.problems }, 400);
      if (result.notFound) return error(result.error, 404);
      return error(result.error, 400);
    }
    return json({ ok: true, text: result.text, release: result.release });
  }
};

/** Явная публикация анонса в канал (только при TELEGRAM_PUBLISH=1). dryRun = true — без отправки. */
export const adminPostTelegramPublish = {
  async onRequestPost({ request, env, params }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const body = await readJson(request) || {};
    const result = await announceRelease(env, id, { dryRun: body.dryRun === true });
    if (!result.ok) {
      if (result.configure) return json(result, 409);
      if (result.notFound) return json(result, 404);
      return json(result, 400);
    }
    return json(result, result.duplicate ? 200 : 201);
  }
};

/** Опубликованные обновления игр, ещё не отправленные в Телеграм. */
export const adminTelegramPending = {
  async onRequestGet({ request, env }) {
    const { response } = await requireAdmin(env, request);
    if (response) return response;
    return json({ pending: await pendingReleases(env) });
  }
};
