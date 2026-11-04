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

export const POST_KINDS = ["news", "devlog", "update", "roadmap", "announcement"];
export const POST_KIND_LABELS = {
  news: "Новости",
  devlog: "Devlog",
  update: "Обновление",
  roadmap: "Roadmap",
  announcement: "Анонс"
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

export function statusBadge(status) {
  const key = status && GAME_STATUS_LABELS[status] ? status : "unknown";
  return `<span class="badge status-${key}">${e(GAME_STATUS_LABELS[status] || "Статус не указан")}</span>`;
}

/** Обложка игры или заглушка с явной подписью: временная картинка не выдаётся за игровой ассет */
export function gameArt(game, { eager = false } = {}) {
  if (game.coverUrl) {
    return `<img src="${e(game.coverUrl)}" alt="Обложка ${e(game.title)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" width="1280" height="720">`;
  }
  return `<div class="placeholder-art" role="img" aria-label="Обложка ${e(game.title)} ещё не загружена"><strong>${e(game.title)}</strong><small>Обложка скоро появится</small></div>`;
}

export function gameCard(game) {
  const meta = game.platforms.length ? `<span>${e(game.platforms.join(" · "))}</span>` : `<span>Платформы не указаны</span>`;
  return `<article class="card">
      <div class="card-media">${gameArt(game)}${statusBadge(game.status)}</div>
      <div class="card-body">
        <h3 class="card-title"><a href="/games/${e(game.slug)}">${e(game.title)}</a></h3>
        <p class="card-text">${e(game.tagline || "Описание появится позже.")}</p>
        <div class="card-meta">${meta}</div>
      </div>
    </article>`;
}

export function postCard(post) {
  const media = post.imageUrl
    ? `<div class="card-media"><img src="${e(post.imageUrl)}" alt="" loading="lazy" decoding="async" width="1280" height="720"></div>`
    : "";
  return `<article class="card">
      ${media}
      <div class="card-body">
        <div class="badge-list"><span class="badge plain">${e(POST_KIND_LABELS[post.kind])}</span>${post.game ? `<span class="badge plain">${e(post.game.title)}</span>` : ""}</div>
        <h3 class="card-title"><a href="/studio/${e(post.slug)}">${e(post.title)}</a></h3>
        ${post.summary ? `<p class="card-text">${e(post.summary)}</p>` : ""}
        <div class="card-meta"><time datetime="${e(isoDate(post.publishedAt || post.createdAt))}">${e(formatDate(post.publishedAt || post.createdAt))}</time>${post.author ? `<span>${e(post.author.name)}</span>` : ""}</div>
      </div>
    </article>`;
}

export function threadRow(thread) {
  const marks = `${thread.pinned ? '<span class="pin-mark" title="Закреплена" aria-label="Закреплена">📌</span>' : ""}${thread.locked ? '<span class="lock-mark" title="Закрыта" aria-label="Закрыта">🔒</span>' : ""}`;
  const author = thread.author
    ? (thread.author.username ? `<a href="/users/${e(thread.author.username)}">${e(thread.author.name)}</a>` : e(thread.author.name))
    : "Удалённый пользователь";
  return `<div class="list-row">
      <div>
        <h3>${marks}<a href="/community/thread/${thread.id}">${e(thread.subject)}</a></h3>
        <div class="card-meta">
          ${thread.category ? `<span class="badge plain">${e(thread.category.title)}</span>` : ""}
          <span>${author}</span>
          <span>Активность: <time datetime="${e(isoDate(thread.lastActivityAt))}">${e(formatDate(thread.lastActivityAt, true))}</time></span>
        </div>
      </div>
      <div class="list-count"><strong>${thread.replies}</strong> ${pluralReplies(thread.replies)}</div>
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
  ["general", "Общее"],
  ["games", "Игры"],
  ["development", "Разработка"],
  ["community", "Сообщество"]
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
export function categoryIndex(categories) {
  return FORUM_SECTIONS.map(([key, label]) => {
    const items = categories.filter((c) => c.section === key);
    if (!items.length) return "";
    return `<section class="forum-section" aria-labelledby="forum-${key}">
        <h2 class="forum-section-title" id="forum-${key}">${e(label)}</h2>
        <div class="list-panel">${items.map((c) => `<div class="list-row">
          <div>
            <h3><a href="/community/c/${e(c.slug)}">${e(c.title)}</a>${c.staffOnly ? ' <span class="badge plain">Команда</span>' : ""}</h3>
            ${c.description ? `<p class="card-text">${e(c.description)}</p>` : ""}
            <div class="card-meta">${c.lastActivityAt ? `<span>Активность: <time datetime="${e(isoDate(c.lastActivityAt))}">${e(formatDate(c.lastActivityAt, true))}</time></span>` : "<span>Тем пока нет</span>"}</div>
          </div>
          <div class="list-count"><strong>${c.topics}</strong> ${pluralTopics(c.topics)}</div>
        </div>`).join("")}</div>
      </section>`;
  }).join("");
}
