// Портал Endemion Studio: игры, публикации студии, превью форума и настройки сайта (таблицы из migrations/0020_studio.sql).
// Страницы собираются на сервере (functions/studio.js), разметка карточек — здесь. Текст из базы всегда экранируется

import { escapeHtml as e } from "./html.js";

export const GAME_STATUSES = ["in_development", "prototype", "released", "planned"];
export const GAME_STATUS_LABELS = {
  in_development: "В разработке",
  prototype: "Прототип",
  released: "Вышла",
  planned: "Запланирована"
};
export const GAME_STATUS_LABELS_EN = {
  in_development: "In development",
  prototype: "Prototype",
  released: "Released",
  planned: "Planned"
};

export const POST_KINDS = ["news", "devlog", "update", "roadmap", "announcement"];
export const POST_KIND_LABELS = {
  news: "Новости",
  devlog: "Devlog",
  update: "Обновление",
  roadmap: "Roadmap",
  announcement: "Анонс"
};
export const POST_KIND_LABELS_EN = {
  news: "News",
  devlog: "Devlog",
  update: "Update",
  roadmap: "Roadmap",
  announcement: "Announcement"
};
export const POST_STATUSES = ["draft", "published", "archived"];

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ==================== ИГРЫ ====================

export function toGame(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    status: row.status,
    platforms: row.platforms ? row.platforms.split(",").map((p) => p.trim()).filter(Boolean) : [],
    websiteUrl: row.website_url,
    roadmap: row.roadmap,
    knownIssues: row.known_issues,
    coverUrl: row.cover_version ? `/media/games/${row.id}/cover?v=${row.cover_version}` : null,
    coverVersion: row.cover_version,
    isUpcoming: row.is_upcoming === 1,
    published: row.published === 1,
    position: row.position,
    updatedAt: row.updated_at
  };
}

/**
 * Игры по порядку. upcoming: true — только будущие, false — только каталог, undefined — все. Черновики — только withHidden
 * @param {any} env
 * @param {{ upcoming?: boolean, withHidden?: boolean }} [options]
 */
export async function listGames(env, { upcoming = undefined, withHidden = false } = {}) {
  const where = [];
  if (!withHidden) where.push("published = 1");
  if (upcoming !== undefined) where.push(`is_upcoming = ${upcoming ? 1 : 0}`);
  const sql = `SELECT * FROM games${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY position, id`;
  return (await env.DB.prepare(sql).all()).results.map(toGame);
}

/**
 * Игры с фильтрацией, поиском, сортировкой и пагинацией.
 * Возвращает { games, total }.
 * @param {any} env
 * @param {{ status?: string, platform?: string, search?: string, sort?: string, limit?: number, offset?: number }} [options]
 */
export async function listGamesFiltered(env, {
  status = undefined,
  platform = undefined,
  search = undefined,
  sort = "position",
  limit = undefined,
  offset = undefined
} = {}) {
  const where = ["published = 1"];
  const binds = [];
  if (status) { where.push("status = ?"); binds.push(status); }
  if (platform) { where.push("platforms LIKE ?"); binds.push(`%${platform}%`); }
  if (search) {
    where.push("(title LIKE ? OR tagline LIKE ? OR description LIKE ?)");
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  let orderBy = "position, id";
  if (sort === "title_asc") orderBy = "title COLLATE NOCASE, id";
  else if (sort === "title_desc") orderBy = "title COLLATE NOCASE DESC, id";
  else if (sort === "newest") orderBy = "created_at DESC, id";
  else if (sort === "oldest") orderBy = "created_at ASC, id";

  const whereClause = where.join(" AND ");
  const limitSql = limit !== undefined ? ` LIMIT ${Number(limit)}${offset !== undefined ? ` OFFSET ${Number(offset)}` : ""}` : "";
  const rows = await env.DB.prepare(
    `SELECT * FROM games WHERE ${whereClause} ORDER BY ${orderBy}${limitSql}`
  ).bind(...binds).all();

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM games WHERE ${whereClause}`).bind(...binds).all();

  return {
    games: rows.results.map(toGame),
    total: countRow.results[0].n
  };
}

export async function getGameBySlug(env, slug) {
  const row = await env.DB.prepare("SELECT * FROM games WHERE slug = ?").bind(slug).first();
  return row ? toGame(row) : null;
}

export async function getGame(env, id) {
  const row = await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(id).first();
  return row ? toGame(row) : null;
}

export async function listGameMedia(env, gameId) {
  const rows = (await env.DB.prepare("SELECT id, caption, position FROM game_media WHERE game_id = ? ORDER BY position, id").bind(gameId).all()).results;
  return rows.map((row) => ({ id: row.id, caption: row.caption, position: row.position, url: `/media/games/${gameId}/shots/${row.id}` }));
}

// ==================== ПУБЛИКАЦИИ ====================

const POST_SELECT = `SELECT sp.*, u.name AS author_name, pr.username AS author_username, g.slug AS game_slug, g.title AS game_title
FROM studio_posts sp LEFT JOIN users u ON u.id = sp.author_id LEFT JOIN user_profiles pr ON pr.user_id = sp.author_id
LEFT JOIN games g ON g.id = sp.game_id`;

export function toPost(row, full = false) {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    body: full ? row.body : undefined,
    imageUrl: row.image_version ? `/media/posts/${row.id}?v=${row.image_version}` : null,
    imageVersion: row.image_version,
    game: row.game_id ? { id: row.game_id, slug: row.game_slug, title: row.game_title } : null,
    author: row.author_id ? { name: row.author_name, username: row.author_username } : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Публикации. status: 'published' (лента), 'archived' (история разработки) или null — все (админка).
 * kinds — список видов, gameId — только по игре
 */
export async function listPosts(env, { status = "published", kinds = null, gameId = null, limit = 10, offset = 0 } = {}) {
  const where = [];
  const binds = [];
  if (status) {
    where.push("sp.status = ?");
    binds.push(status);
  }
  if (kinds?.length) {
    where.push(`sp.kind IN (${kinds.map(() => "?").join(", ")})`);
    binds.push(...kinds);
  }
  if (gameId) {
    where.push("sp.game_id = ?");
    binds.push(gameId);
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const [list, count] = await env.DB.batch([
    env.DB.prepare(`${POST_SELECT}${clause} ORDER BY COALESCE(sp.published_at, sp.created_at) DESC, sp.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM studio_posts sp${clause}`).bind(...binds)
  ]);
  return { posts: list.results.map((row) => toPost(row)), total: count.results[0].n };
}

export async function getPostBySlug(env, slug) {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE sp.slug = ?`).bind(slug).first();
  return row ? toPost(row, true) : null;
}

export async function getPost(env, id) {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE sp.id = ?`).bind(id).first();
  return row ? toPost(row, true) : null;
}

// ==================== ФОРУМ: ПРЕВЬЮ ====================

/** Последние темы форума для главной и страницы игры. categoryIds — только из этих категорий */
export async function recentThreads(env, { limit = 6, categoryIds = null } = {}) {
  const where = ["th.deleted_at IS NULL"];
  const binds = [];
  if (categoryIds) {
    if (!categoryIds.length) return [];
    where.push(`th.category_id IN (${categoryIds.map(() => "?").join(", ")})`);
    binds.push(...categoryIds);
  }
  const rows = (await env.DB.prepare(
    `SELECT th.id, th.subject, th.comments_count, th.last_activity_at, th.pinned_at, th.locked_at,
       c.slug AS category_slug, c.title AS category_title, u.name AS author_name, p.username AS author_username
     FROM threads th LEFT JOIN forum_categories c ON c.id = th.category_id
     LEFT JOIN users u ON u.id = th.user_id LEFT JOIN user_profiles p ON p.user_id = th.user_id
     WHERE ${where.join(" AND ")} ORDER BY th.last_activity_at DESC, th.id DESC LIMIT ?`
  ).bind(...binds, limit).all()).results;
  return rows.map(toThreadPreview);
}

export function toThreadPreview(row) {
  return {
    id: row.id,
    subject: row.subject,
    replies: row.comments_count,
    lastActivityAt: row.last_activity_at,
    pinned: Boolean(row.pinned_at),
    locked: Boolean(row.locked_at),
    category: row.category_slug ? { slug: row.category_slug, title: row.category_title } : null,
    author: row.author_name ? { name: row.author_name, username: row.author_username } : null
  };
}

export async function gameCategoryIds(env, gameId) {
  return (await env.DB.prepare("SELECT id FROM forum_categories WHERE game_id = ?").bind(gameId).all()).results.map((r) => r.id);
}

export async function gameCategory(env, gameId) {
  return env.DB.prepare("SELECT slug, title FROM forum_categories WHERE game_id = ? ORDER BY position LIMIT 1").bind(gameId).first();
}

// ==================== НАСТРОЙКИ ====================

export async function getSettings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM site_settings").all()).results;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let socialLinks = [];
  try {
    const parsed = JSON.parse(map.social_links || "[]");
    if (Array.isArray(parsed)) socialLinks = parsed.filter((l) => l && typeof l.label === "string" && /^https:\/\//.test(l.url));
  } catch {}
  return { featuredGame: map.featured_game || "", socialLinks, aboutText: map.about_text || "" };
}

// ==================== РАЗМЕТКА ====================

/** Дата из SQLite (UTC, «2026-11-04 10:00:00») по-русски */
export function formatDate(value, withTime = false) {
  if (!value) return "";
  const date = new Date(`${String(value).replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  });
}

export function isoDate(value) {
  return value ? `${String(value).replace(" ", "T")}Z` : "";
}

/**
 * Текст публикации или описания: абзацы через пустую строку, переносы строк, заголовки «## », списки «- ».
 * HTML из текста не проходит: всё экранируется
 */
export function richText(text) {
  if (!text) return "";
  return String(text).replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      return `<ul>${lines.map((l) => `<li>${e(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
    }
    if (/^## /.test(block)) return `<h3>${e(block.slice(3).trim())}</h3>`;
    return `<p>${lines.map((l) => e(l)).join("<br>")}</p>`;
  }).join("\n");
}

export function statusBadge(status, lang = "ru") {
  const labels = lang === "en" ? GAME_STATUS_LABELS_EN : GAME_STATUS_LABELS;
  const key = status && labels[status] ? status : "unknown";
  return `<span class="badge status-${key}">${e(labels[status] || (lang === "en" ? "Status not set" : "Статус не указан"))}</span>`;
}

/** Обложка игры или заглушка с явной подписью: временная картинка не выдаётся за игровой ассет */
export function gameArt(game, { eager = false, lang = "ru" } = {}) {
  const cover = lang === "en" ? "Cover" : "Обложка";
  if (game.coverUrl) {
    return `<img src="${e(game.coverUrl)}" alt="${cover} ${e(game.title)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" width="1280" height="720">`;
  }
  const soon = lang === "en" ? "Cover coming soon" : "Обложка скоро появится";
  return `<div class="placeholder-art" role="img" aria-label="${cover} ${e(game.title)}"><strong>${e(game.title)}</strong><small>${soon}</small></div>`;
}

export function gameCard(game, lang = "ru") {
  const meta = game.platforms.length ? `<span>${e(game.platforms.join(" · "))}</span>` : `<span>${lang === "en" ? "Platforms not set" : "Платформы не указаны"}</span>`;
  return `<article class="card">
      <div class="card-media">${gameArt(game, { lang })}${statusBadge(game.status, lang)}</div>
      <div class="card-body">
        <h3 class="card-title"><a href="/games/${e(game.slug)}">${e(game.title)}</a></h3>
        <p class="card-text">${e(game.tagline || (lang === "en" ? "Description coming later." : "Описание появится позже."))}</p>
        <div class="card-meta">${meta}</div>
      </div>
    </article>`;
}

export function postCard(post, lang = "ru") {
  const media = post.imageUrl
    ? `<div class="card-media"><img src="${e(post.imageUrl)}" alt="" loading="lazy" decoding="async" width="1280" height="720"></div>`
    : "";
  return `<article class="card">
      ${media}
      <div class="card-body">
        <div class="badge-list"><span class="badge plain">${e((lang === "en" ? POST_KIND_LABELS_EN : POST_KIND_LABELS)[post.kind])}</span>${post.game ? `<span class="badge plain">${e(post.game.title)}</span>` : ""}</div>
        <h3 class="card-title"><a href="/studio/${e(post.slug)}">${e(post.title)}</a></h3>
        ${post.summary ? `<p class="card-text">${e(post.summary)}</p>` : ""}
        <div class="card-meta"><time datetime="${e(isoDate(post.publishedAt || post.createdAt))}">${e(formatDate(post.publishedAt || post.createdAt))}</time>${post.author ? `<span>${e(post.author.name)}</span>` : ""}</div>
      </div>
    </article>`;
}

export function threadRow(thread, lang = "ru") {
  const en = lang === "en";
  const pinned = en ? "Pinned" : "Закреплена";
  const locked = en ? "Locked" : "Закрыта";
  const marks = `${thread.pinned ? `<span class="pin-mark" title="${pinned}" aria-label="${pinned}">📌</span>` : ""}${thread.locked ? `<span class="lock-mark" title="${locked}" aria-label="${locked}">🔒</span>` : ""}`;
  const author = thread.author
    ? (thread.author.username ? `<a href="/users/${e(thread.author.username)}">${e(thread.author.name)}</a>` : e(thread.author.name))
    : (en ? "Deleted user" : "Удалённый пользователь");
  return `<div class="list-row">
      <div>
        <h3>${marks}<a href="/community/thread/${thread.id}">${e(thread.subject)}</a></h3>
        <div class="card-meta">
          ${thread.category ? `<span class="badge plain">${e(thread.category.title)}</span>` : ""}
          <span>${author}</span>
          <span>${en ? "Activity" : "Активность"}: <time datetime="${e(isoDate(thread.lastActivityAt))}">${e(formatDate(thread.lastActivityAt, true))}</time></span>
        </div>
      </div>
      <div class="list-count"><strong>${thread.replies}</strong> ${en ? (thread.replies === 1 ? "reply" : "replies") : pluralReplies(thread.replies)}</div>
    </div>`;
}

export function pluralReplies(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "ответ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ответа";
  return "ответов";
}

export function emptyCard(title, text, action = "") {
  return `<div class="empty-card"><strong>${e(title)}</strong><p>${e(text)}</p>${action}</div>`;
}

// ==================== ФОРУМ: КАТЕГОРИИ ====================

export const FORUM_SECTIONS = [
  ["general", "Общее", "General"],
  ["games", "Игры", "Games"],
  ["development", "Разработка", "Development"],
  ["community", "Сообщество", "Community"]
];
export const FORUM_PAGE = 20;

/** Категории форума по разделам: число тем и последняя активность (удалённые темы не считаются) */
export async function listCategories(env) {
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.slug, c.section, c.title, c.description, c.staff_only, c.position, g.slug AS game_slug,
       (SELECT COUNT(*) FROM threads th WHERE th.category_id = c.id AND th.deleted_at IS NULL) AS topics,
       (SELECT MAX(th.last_activity_at) FROM threads th WHERE th.category_id = c.id AND th.deleted_at IS NULL) AS last_activity_at
     FROM forum_categories c LEFT JOIN games g ON g.id = c.game_id
     WHERE c.game_id IS NULL OR g.published = 1
     ORDER BY c.position, c.id`
  ).all()).results;
  return rows.map(toCategory);
}

export function toCategory(row) {
  return {
    id: row.id,
    slug: row.slug,
    section: row.section,
    title: row.title,
    description: row.description,
    staffOnly: row.staff_only === 1,
    gameSlug: row.game_slug || null,
    topics: row.topics ?? 0,
    lastActivityAt: row.last_activity_at || null
  };
}

export async function getCategoryBySlug(env, slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  const row = await env.DB.prepare(
    `SELECT c.*, g.slug AS game_slug, g.published AS game_published FROM forum_categories c LEFT JOIN games g ON g.id = c.game_id WHERE c.slug = ?`
  ).bind(slug).first();
  if (!row || (row.game_id && row.game_published !== 1)) return null;
  return toCategory(row);
}

/** Темы категории: закреплённые первыми, затем по активности. query — поиск по заголовку и тексту */
export async function categoryThreads(env, categoryId, { page = 1, query = "" } = {}) {
  const where = ["th.category_id = ?", "th.deleted_at IS NULL"];
  const binds = [categoryId];
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(th.subject LIKE ? ESCAPE '\\' OR th.body LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern);
  }
  const clause = where.join(" AND ");
  const [list, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT th.id, th.subject, th.comments_count, th.last_activity_at, th.pinned_at, th.locked_at,
         c.slug AS category_slug, c.title AS category_title, u.name AS author_name, p.username AS author_username
       FROM threads th LEFT JOIN forum_categories c ON c.id = th.category_id
       LEFT JOIN users u ON u.id = th.user_id LEFT JOIN user_profiles p ON p.user_id = th.user_id
       WHERE ${clause} ORDER BY th.pinned_at IS NULL, th.last_activity_at DESC, th.id DESC LIMIT ? OFFSET ?`
    ).bind(...binds, FORUM_PAGE, (page - 1) * FORUM_PAGE),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM threads th WHERE ${clause}`).bind(...binds)
  ]);
  return { threads: list.results.map(toThreadPreview), total: count.results[0].n };
}

export function pluralTopics(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "тема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "темы";
  return "тем";
}

/** Блок категорий форума по разделам: для /community */
export function categoryIndex(categories, lang = "ru") {
  const en = lang === "en";
  return FORUM_SECTIONS.map(([key, label, labelEn]) => {
    const items = categories.filter((c) => c.section === key);
    if (!items.length) return "";
    return `<section class="forum-section" aria-labelledby="forum-${key}">
        <h2 class="forum-section-title" id="forum-${key}">${e(en ? labelEn : label)}</h2>
        <div class="list-panel">${items.map((c) => `<div class="list-row">
          <div>
            <h3><a href="/community/c/${e(c.slug)}">${e(c.title)}</a>${c.staffOnly ? ` <span class="badge plain">${en ? "Team" : "Команда"}</span>` : ""}</h3>
            ${c.description ? `<p class="card-text">${e(c.description)}</p>` : ""}
            <div class="card-meta">${c.lastActivityAt ? `<span>${en ? "Activity" : "Активность"}: <time datetime="${e(isoDate(c.lastActivityAt))}">${e(formatDate(c.lastActivityAt, true))}</time></span>` : `<span>${en ? "No topics yet" : "Тем пока нет"}</span>`}</div>
          </div>
          <div class="list-count"><strong>${c.topics}</strong> ${en ? (c.topics === 1 ? "topic" : "topics") : pluralTopics(c.topics)}</div>
        </div>`).join("")}</div>
      </section>`;
  }).join("");
}

// ==================== ИЗБРАННЫЕ ИГРЫ ====================

/** Любимые игры пользователя с данными из каталога */
export async function listGameLibrary(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.tagline, g.status, g.platforms, g.cover_version, g.is_upcoming
     FROM game_library l JOIN games g ON g.id = l.game_id
     WHERE l.user_id = ? ORDER BY l.created_at DESC`
  ).bind(userId).all();
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    status: row.status,
    platforms: row.platforms ? row.platforms.split(",").map((p) => p.trim()).filter(Boolean) : [],
    coverUrl: row.cover_version ? `/media/games/${row.id}/cover?v=${row.cover_version}` : null,
    isUpcoming: row.is_upcoming === 1
  }));
}

/** Добавить игру в избранное. Возвращает true, если добавлено, false, если уже было */
export async function addGameFavorite(env, userId, gameId) {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO game_library (user_id, game_id) VALUES (?, ?)"
  ).bind(userId, gameId).run();
  return result.meta.changes > 0;
}

/** Удалить игру из избранного. Возвращает true, если удалено */
export async function removeGameFavorite(env, userId, gameId) {
  const result = await env.DB.prepare(
    "DELETE FROM game_library WHERE user_id = ? AND game_id = ?"
  ).bind(userId, gameId).run();
  return result.meta.changes > 0;
}

/** Проверяет, добавлена ли игра в избранное пользователем */
export async function isGameFavorited(env, userId, gameId) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM game_library WHERE user_id = ? AND game_id = ? LIMIT 1"
  ).bind(userId, gameId).first();
  return Boolean(row);
}

// ==================== ОЦЕНКИ И ОТЗЫВЫ ИГР ====================

/** Публичные отзывы к игре (не скрытые модератором), с данными об авторе */
export async function listGameReviews(env, gameId) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.score, r.body, r.spoiler, r.created_at, r.updated_at,
           u.id AS user_id, u.name AS author_name, p.username AS author_username
     FROM game_reviews r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE r.game_id = ? AND r.hidden_at IS NULL
     ORDER BY r.created_at DESC`
  ).bind(gameId).all();
  return results.map((row) => ({
    id: row.id,
    score: row.score,
    body: row.body,
    spoiler: Boolean(row.spoiler),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.user_id,
      name: row.author_name,
      username: row.author_username || null
    }
  }));
}

/** Отзыв пользователя для игры (включая скрытый, для владельца) */
export async function getGameReview(env, userId, gameId) {
  return env.DB.prepare(
    "SELECT id, score, body, spoiler, created_at, updated_at, hidden_at FROM game_reviews WHERE user_id = ? AND game_id = ? LIMIT 1"
  ).bind(userId, gameId).first();
}

/** Добавить отзыв к игре. Возвращает id созданного отзыва */
export async function addGameReview(env, userId, gameId, score, body, spoiler) {
  const result = await env.DB.prepare(
    "INSERT INTO game_reviews (user_id, game_id, score, body, spoiler) VALUES (?, ?, ?, ?, ?)"
  ).bind(userId, gameId, score, body, spoiler ? 1 : 0).run();
  return result.meta.last_row_id;
}

/** Обновить отзыв пользователя. Возвращает true, если обновлено */
export async function updateGameReview(env, reviewId, userId, score, body, spoiler) {
  const result = await env.DB.prepare(
    "UPDATE game_reviews SET score = ?, body = ?, spoiler = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND hidden_at IS NULL"
  ).bind(score, body, spoiler ? 1 : 0, reviewId, userId).run();
  return result.meta.changes > 0;
}

/** Удалить отзыв пользователя (физическое удаление). Возвращает true, если удалено */
export async function deleteGameReview(env, reviewId, userId) {
  const result = await env.DB.prepare(
    "DELETE FROM game_reviews WHERE id = ? AND user_id = ?"
  ).bind(reviewId, userId).run();
  return result.meta.changes > 0;
}

/** Средняя оценка и количество видимых отзывов для игры */
export async function getGameReviewStats(env, gameId) {
  const row = await env.DB.prepare(
    `SELECT AVG(r.score) AS avg_score, COUNT(*) AS review_count
     FROM game_reviews r
     WHERE r.game_id = ? AND r.hidden_at IS NULL`
  ).bind(gameId).first();
  return {
    avgScore: row.avg_score ? Number(row.avg_score.toFixed(1)) : null,
    reviewCount: row.review_count
  };
}

