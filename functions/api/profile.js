// ENDEMION ID: свой профиль (настройки, приватность, аватар, достижения)
// и публичные профили других читателей (/api/users/:username), подписки.
// Каждый экспорт — маршрут в формате Pages Functions, адреса перечислены в src/worker.js

import { checkAchievements, listAchievements } from "../_lib/achievements.js";
import { imageType } from "../_lib/admin.js";
import { error, json, readJson } from "../_lib/http.js";
import { notifyStatement } from "../_lib/notifications.js";
import { takeAction } from "../_lib/limits.js";
import {
  AVATAR_COLORS, avatarKey, canSeeProfile, communityStats, MAX_AVATAR_BYTES, profileByUserId, profileByUsername,
  toProfile, toSettings
} from "../_lib/profiles.js";
import { requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { cleanText, intParam, lengthProblem, parseId, USERNAME } from "../_lib/validate.js";
import { notFound } from "../_lib/html.js";

// Имена профилей, которые нельзя занять: они похожи на служебные адреса или на представителей сайта
const RESERVED = new Set(["admin", "administrator", "moderator", "endemion", "support", "system", "root", "api", "help", "official"]);

// ==================== СВОЙ ПРОФИЛЬ ====================

/** /api/me/profile — настройки профиля, приватности и уведомлений */
export const meProfile = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const row = await profileByUserId(env, user.id);
    return json({ profile: toProfile(row), settings: toSettings(row) });
  },

  async onRequestPatch({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");

    const sets = [];
    const binds = [];
    if ("username" in body) {
      // Адрес профиля аккаунта Endemion ID приходит оттуда (preferred_username)
      if (user.viaEndemionId) return error("Адрес профиля меняется в Endemion ID.", 409);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!USERNAME.test(username)) return error("Имя профиля: от 3 до 24 символов, латиница, цифры и «_».");
      if (RESERVED.has(username.toLowerCase()) && !user.isAdmin) return error("Это имя занято.", 409);
      const taken = await env.DB.prepare("SELECT user_id FROM user_profiles WHERE username = ? AND user_id <> ?").bind(username, user.id).first();
      if (taken) return error("Это имя занято.", 409);
      sets.push("username = ?");
      binds.push(username);
    }
    if ("bio" in body) {
      const bio = cleanText(body.bio);
      const problem = lengthProblem(bio, "Описание", 0, 500);
      if (problem) return error(problem);
      sets.push("bio = ?");
      binds.push(bio);
    }
    if ("avatarColor" in body) {
      if (!AVATAR_COLORS.includes(body.avatarColor)) return error("Неизвестный цвет аватара.");
      sets.push("avatar_color = ?");
      binds.push(body.avatarColor);
    }
    const flags = {
      isPublic: "is_public", showActivity: "show_activity"
    };
    for (const [key, column] of Object.entries(flags)) {
      if (!(key in body)) continue;
      if (typeof body[key] !== "boolean") return error("Некорректная настройка приватности.");
      sets.push(`${column} = ?`);
      binds.push(body[key] ? 1 : 0);
    }
    if ("notify" in body) {
      const notify = body.notify;
      if (!notify || typeof notify !== "object") return error("Некорректные настройки уведомлений.");
      const columns = { replies: "notify_replies", follows: "notify_follows", achievements: "notify_achievements" };
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in notify)) continue;
        if (typeof notify[key] !== "boolean") return error("Некорректные настройки уведомлений.");
        sets.push(`${column} = ?`);
        binds.push(notify[key] ? 1 : 0);
      }
    }
    if (!sets.length) return error("Нечего сохранять.");

    try {
      await env.DB.prepare(`UPDATE user_profiles SET ${sets.join(", ")}, updated_at = datetime('now') WHERE user_id = ?`)
        .bind(...binds, user.id).run();
    } catch (err) {
      // Два человека одновременно заняли одно имя: второй упирается в UNIQUE
      if (String(err).includes("UNIQUE")) return error("Это имя занято.", 409);
      throw err;
    }
    const row = await profileByUserId(env, user.id);
    return json({ profile: toProfile(row), settings: toSettings(row) });
  }
};

/** /api/me/avatar — загрузить аватар (тело — картинка до 2 МБ) или убрать */
export const meAvatar = {
  async onRequestPut({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    if (!env.PAGES) return error("Хранилище картинок не подключено.", 500);
    // Аватар аккаунта Endemion ID общий для обоих сайтов и загружается в Endemion ID
    if (user.viaEndemionId) return error("Аватар меняется в Endemion ID.", 409);
    const limited = await takeAction(env, user.id, "avatar");
    if (limited) return limited;

    const length = Number(request.headers.get("Content-Length"));
    if (!length || length > MAX_AVATAR_BYTES) return error("Аватар должен быть не больше 2 МБ.", 413);
    const buffer = await request.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_AVATAR_BYTES) return error("Аватар должен быть не больше 2 МБ.", 413);
    const type = imageType(buffer);
    if (!type) return error("Аватар должен быть картинкой JPEG, PNG, WebP или AVIF.", 415);

    const row = await env.DB.prepare("SELECT avatar_version FROM user_profiles WHERE user_id = ?").bind(user.id).first();
    const previous = row?.avatar_version || null;
    const version = (previous || 0) + 1;
    await env.PAGES.put(avatarKey(user.id, version), buffer, { httpMetadata: { contentType: type } });
    const result = await env.DB.prepare("UPDATE user_profiles SET avatar_version = ? WHERE user_id = ? AND avatar_version IS ?")
      .bind(version, user.id, previous).run();
    if (!result.meta.changes) {
      await env.PAGES.delete(avatarKey(user.id, version));
      return error("Аватар только что изменили. Обновите страницу.", 409);
    }
    if (previous) await env.PAGES.delete(avatarKey(user.id, previous));
    return json({ avatar: `/avatars/${user.id}?v=${version}` });
  },

  async onRequestDelete({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const row = await env.DB.prepare("SELECT avatar_version FROM user_profiles WHERE user_id = ?").bind(user.id).first();
    await env.DB.prepare("UPDATE user_profiles SET avatar_version = NULL WHERE user_id = ?").bind(user.id).run();
    if (row?.avatar_version && env.PAGES) await env.PAGES.delete(avatarKey(user.id, row.avatar_version));
    return json({ avatar: null });
  }
};

/** GET /avatars/:id — картинка аватара из хранилища */
export const avatarImage = {
  async onRequestGet({ params, env, request }) {
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT avatar_version, avatar_url FROM user_profiles WHERE user_id = ?").bind(id).first() : null;
    if (!row?.avatar_version) return notFound(env, request);
    // Аватар из Endemion ID: сайт забирает картинку сам, браузер обращается только к своему адресу (CSP img-src 'self')
    if (row.avatar_url) return endemionAvatar(env, request, row);
    if (!env.PAGES) return notFound(env, request);
    const object = await env.PAGES.get(avatarKey(id, row.avatar_version));
    const type = object?.httpMetadata?.contentType;
    if (!object || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type)) return notFound(env, request);
    const current = new URL(request.url).searchParams.get("v") === String(row.avatar_version);
    return new Response(object.body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(object.size),
        "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
      }
    });
  }
};

/**
 * Картинка аватара из Endemion ID. Адрес в avatar_url сохраняется, только если он начинается с адреса провайдера
 * (applyClaims в endemionId.js), поэтому чужой сервер так не запросить. Тип картинки проверяется по первым байтам
 */
async function endemionAvatar(env, request, row) {
  const issuer = env.ENDEMION_ID_ISSUER ? new URL(env.ENDEMION_ID_ISSUER).origin : "";
  if (!issuer || !row.avatar_url.startsWith(`${issuer}/avatars/`)) return notFound(env, request);
  let response;
  try {
    response = await fetch(row.avatar_url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  } catch {
    return notFound(env, request);
  }
  if (!response.ok) return notFound(env, request);
  const buffer = await response.arrayBuffer();
  const type = buffer.byteLength <= MAX_AVATAR_BYTES ? imageType(buffer) : null;
  if (!type) return notFound(env, request);
  const current = new URL(request.url).searchParams.get("v") === String(row.avatar_version);
  return new Response(buffer, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    }
  });
}

/** GET /api/me/achievements — все достижения с отметкой полученных */
export const meAchievements = {
  async onRequestGet({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    return json({ achievements: await listAchievements(env, user.id) });
  }
};

// ==================== ЧУЖИЕ ПРОФИЛИ ====================

/** Профиль по имени из адреса и право его смотреть */
async function loadProfile(env, request, params) {
  const viewer = await currentUser(env, request);
  const row = await profileByUsername(env, params.username);
  if (!row) return { response: error("Профиль не найден.", 404) };
  return { viewer, row, visible: canSeeProfile(row, viewer), own: viewer?.id === row.id };
}

/** GET /api/users/:username — публичный профиль: описание, статистика, достижения, подписка */
export const userProfile = {
  async onRequestGet({ request, env, params }) {
    const { viewer, row, visible, own, response } = await loadProfile(env, request, params);
    if (response) return response;
    const profile = toProfile(row);
    const follow = viewer && !own
      ? await env.DB.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?").bind(viewer.id, row.id).first()
      : null;
    if (!visible) {
      // Приватный профиль: только имя и аватар
      return json({ profile: { ...profile, bio: "" }, private: true, own, following: Boolean(follow) });
    }
    const [stats, achievements] = await Promise.all([communityStats(env, row.id), listAchievements(env, row.id)]);
    return json({
      profile,
      private: false,
      own,
      following: Boolean(follow),
      stats,
      achievements: achievements.filter((item) => item.earnedAt),
      achievementsTotal: achievements.length
    });
  }
};

/** GET /api/users/:username/follows?kind=followers|following — подписчики и подписки */
export const userFollows = {
  async onRequestGet({ request, env, params }) {
    const { row, visible, response } = await loadProfile(env, request, params);
    if (response) return response;
    if (!visible) return error("Профиль скрыт.", 403);
    const kind = new URL(request.url).searchParams.get("kind") === "following" ? "following" : "followers";
    const [mine, other] = kind === "followers" ? ["followee_id", "follower_id"] : ["follower_id", "followee_id"];
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, p.username, p.avatar_version, p.avatar_color FROM follows f
       JOIN users u ON u.id = f.${other} JOIN user_profiles p ON p.user_id = u.id
       WHERE f.${mine} = ? AND u.blocked_at IS NULL ORDER BY f.created_at DESC LIMIT 100`
    ).bind(row.id).all();
    return json({
      kind,
      users: results.map((item) => ({
        id: item.id, name: item.name, username: item.username, avatarColor: item.avatar_color,
        avatar: item.avatar_version ? `/avatars/${item.id}?v=${item.avatar_version}` : null
      }))
    });
  }
};

/** /api/users/:username/follow — подписаться (PUT) или отписаться (DELETE) */
export const userFollow = {
  async onRequestPut({ request, env, params }) {
    const { viewer, row, response } = await loadProfile(env, request, params);
    if (response) return response;
    if (!viewer) return error("Войдите в профиль.", 401);
    if (viewer.id === row.id) return error("Нельзя подписаться на себя.", 409);
    const limited = await takeAction(env, viewer.id, "follow");
    if (limited) return limited;
    const result = await env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)").bind(viewer.id, row.id).run();
    if (result.meta.changes) {
      await notifyStatement(env, {
        userId: row.id, kind: "follow", actorId: viewer.id,
        text: `${viewer.name} подписался(-ась) на вас`, link: viewer.username ? `/users/${viewer.username}` : ""
      }).run();
      await checkAchievements(env, row.id, "follow");
    }
    return json({ following: true });
  },

  async onRequestDelete({ request, env, params }) {
    const { viewer, row, response } = await loadProfile(env, request, params);
    if (response) return response;
    if (!viewer) return error("Войдите в профиль.", 401);
    await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(viewer.id, row.id).run();
    return json({ following: false });
  }
};

/** GET /api/users?q= — поиск читателей по имени профиля или имени (только публичные профили) */
export const userSearch = {
  async onRequestGet({ request, env }) {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") || "").trim().slice(0, 40);
    const limit = intParam(params.get("limit"), 20, 1, 50);
    if (limit === null) return error("Некорректный limit.");
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, p.username, p.bio, p.avatar_version, p.avatar_color,
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
       FROM users u JOIN user_profiles p ON p.user_id = u.id
       WHERE p.is_public = 1 AND u.blocked_at IS NULL AND (p.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')
       ORDER BY followers DESC, u.id LIMIT ?`
    ).bind(pattern, pattern, limit).all();
    return json({
      users: results.map((row) => ({
        id: row.id, name: row.name, username: row.username, bio: row.bio, followers: row.followers, avatarColor: row.avatar_color,
        avatar: row.avatar_version ? `/avatars/${row.id}?v=${row.avatar_version}` : null
      }))
    });
  }
};

/**
 * GET /api/users/:username/forum — активность на форуме: число тем и ответов, последние темы и ответы.
 * Скрыта, если профиль приватный или пользователь выключил показ активности (кроме владельца и модераторов)
 */
export const userForum = {
  async onRequestGet({ request, env, params }) {
    const { viewer, row, visible, own, response } = await loadProfile(env, request, params);
    if (response) return response;
    if (!visible || (!own && row.show_activity !== 1 && !viewer?.isModerator)) return error("Пользователь скрыл свою активность.", 403);
    const [counts, topics, posts] = await env.DB.batch([
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM threads WHERE user_id = ?1 AND deleted_at IS NULL) AS topics,
           (SELECT COUNT(*) FROM comments c JOIN threads th ON th.id = c.target_id
            WHERE c.user_id = ?1 AND c.target_type = 'thread' AND c.deleted_at IS NULL AND th.deleted_at IS NULL) AS posts`
      ).bind(row.id),
      env.DB.prepare(
        `SELECT th.id, th.subject, th.comments_count, th.created_at, fc.slug AS category_slug, fc.title AS category_title
         FROM threads th LEFT JOIN forum_categories fc ON fc.id = th.category_id
         WHERE th.user_id = ? AND th.deleted_at IS NULL ORDER BY th.id DESC LIMIT 5`
      ).bind(row.id),
      env.DB.prepare(
        `SELECT c.id, c.body, c.spoiler, c.created_at, th.id AS thread_id, th.subject
         FROM comments c JOIN threads th ON th.id = c.target_id
         WHERE c.user_id = ? AND c.target_type = 'thread' AND c.deleted_at IS NULL AND th.deleted_at IS NULL
         ORDER BY c.id DESC LIMIT 5`
      ).bind(row.id)
    ]);
    return json({
      topicsCount: counts.results[0].topics,
      postsCount: counts.results[0].posts,
      topics: topics.results.map((t) => ({
        id: t.id, subject: t.subject, replies: t.comments_count, createdAt: t.created_at,
        category: t.category_slug ? { slug: t.category_slug, title: t.category_title } : null
      })),
      posts: posts.results.map((p) => ({
        id: p.id, excerpt: p.spoiler === 1 ? "" : p.body.slice(0, 200), spoiler: p.spoiler === 1, createdAt: p.created_at,
        thread: { id: p.thread_id, subject: p.subject }
      }))
    });
  }
};
