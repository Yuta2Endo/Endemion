// ENDEMION COMMUNITY: отзывы и оценки, комментарии с ответами, реакции, обсуждения и теории, подборки, жалобы.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js.
// Защита от спама: лимиты частоты (functions/_lib/limits.js), проверка ссылок и повторов, запрет для заглушённых модератором

import { checkAchievements } from "../_lib/achievements.js";
import {
  COMMENT_MAX, getComment, listComments, loadCommentTarget, rawComment, REACTIONS, TARGET_TYPES
} from "../_lib/comments.js";
import { error, json, readJson } from "../_lib/http.js";
import { isDuplicate, spamProblem, takeAction } from "../_lib/limits.js";
import { commentLink, REPORT_REASONS, REPORT_TARGETS, loadTarget, moderationStatement } from "../_lib/moderation.js";
import { notifyStatement } from "../_lib/notifications.js";
import { getReview, listReviews } from "../_lib/reviews.js";
import { mutedProblem, requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { getTitle, getTitlesByIds, parseId } from "../_lib/titles.js";
import { cleanLine, cleanText, intParam, lengthProblem } from "../_lib/validate.js";

/** Вошедший пользователь, который может писать, или ответ с ошибкой */
async function requireWriter(env, request) {
  const { user, response } = await requireUser(env, request);
  if (response) return { response };
  const muted = mutedProblem(user);
  if (muted) return { response: error(muted, 403) };
  return { user };
}

/** Текст сообщения или ответ с ошибкой */
function readBody(value, label, min, max) {
  const text = cleanText(value);
  const problem = lengthProblem(text, label, min, max) || spamProblem(text);
  return problem ? { problem } : { text };
}

// ==================== ОТЗЫВЫ ====================

/** /api/titles/:id/reviews — отзывы тайтла (GET) и своя оценка с отзывом (PUT, DELETE) */
export const titleReviews = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    if (!id || !(await getTitle(env, id))) return error("Тайтл не найден.", 404);
    const offset = intParam(new URL(request.url).searchParams.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const viewer = await currentUser(env, request);
    return json(await listReviews(env, viewer, id, { offset }));
  },

  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const id = parseId(params.id);
    if (!id || !(await getTitle(env, id))) return error("Тайтл не найден.", 404);
    const body = await readJson(request, 20_000);
    if (!body) return error("Некорректный запрос.");
    if (!Number.isInteger(body.score) || body.score < 1 || body.score > 10) return error("Оценка: целое число от 1 до 10.");
    const parsed = readBody(body.body ?? "", "Отзыв", 0, 5000);
    if (parsed.problem) return error(parsed.problem);
    if (typeof (body.spoiler ?? false) !== "boolean") return error("Некорректная пометка спойлера.");
    const limited = await takeAction(env, user.id, "review");
    if (limited) return limited;

    // Скрытый модератором отзыв автор может исправить, но снова виден он станет только после проверки
    await env.DB.prepare(
      `INSERT INTO reviews (user_id, title_id, score, body, spoiler) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, title_id) DO UPDATE SET score = excluded.score, body = excluded.body, spoiler = excluded.spoiler,
         updated_at = datetime('now')`
    ).bind(user.id, id, body.score, parsed.text, body.spoiler ? 1 : 0).run();
    const achievements = await checkAchievements(env, user.id, "review");
    const result = await listReviews(env, user, id);
    return json({ review: result.mine, summary: result.summary, achievements });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    if (!id) return error("Тайтл не найден.", 404);
    await env.DB.prepare("DELETE FROM reviews WHERE user_id = ? AND title_id = ?").bind(user.id, id).run();
    const result = await listReviews(env, user, id);
    return json({ ok: true, summary: result.summary });
  }
};

// ==================== КОММЕНТАРИИ ====================

function parseTarget(search) {
  const type = search.get("type");
  const id = parseId(search.get("id"));
  if (!TARGET_TYPES.includes(type) || !id) return null;
  return { type, id };
}

/** /api/comments?type=title&id=5 — комментарии цели (GET) и новый комментарий или ответ (POST) */
export const comments = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const target = parseTarget(search);
    if (!target) return error("Укажите, к чему комментарии.");
    if (!(await loadCommentTarget(env, target.type, target.id))) return error("Не найдено.", 404);
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const sort = search.get("sort") === "top" ? "top" : "new";
    const viewer = await currentUser(env, request);
    return json(await listComments(env, viewer, target.type, target.id, { offset, sort }));
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const body = await readJson(request, 20_000);
    if (!body) return error("Некорректный запрос.");
    if (!TARGET_TYPES.includes(body.targetType) || !Number.isInteger(body.targetId)) return error("Укажите, к чему комментарий.");
    const target = await loadCommentTarget(env, body.targetType, body.targetId);
    if (!target) return error("Не найдено.", 404);
    const parsed = readBody(body.body, "Комментарий", 1, COMMENT_MAX);
    if (parsed.problem) return error(parsed.problem);
    if (await isDuplicate(env, user.id, parsed.text)) return error("Такой комментарий уже отправлен.", 409);

    let parent = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      parent = Number.isInteger(body.parentId) ? await rawComment(env, body.parentId) : null;
      if (!parent || parent.target_type !== body.targetType || parent.target_id !== body.targetId) return error("Комментарий для ответа не найден.", 404);
      if (parent.deleted_at) return error("Нельзя ответить на удалённый комментарий.", 409);
    }
    const limited = await takeAction(env, user.id, "comment");
    if (limited) return limited;

    const row = await env.DB.prepare(
      `INSERT INTO comments (user_id, target_type, target_id, parent_id, root_id, body, spoiler) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(user.id, body.targetType, body.targetId, parent?.id ?? null, parent ? parent.root_id ?? parent.id : null,
      parsed.text, body.spoiler === true ? 1 : 0).first();

    // Уведомления: автору комментария, на который ответили, и автору обсуждения, подборки или отзыва
    const link = await commentLink(env, body.targetType, body.targetId, row.id);
    const notices = [];
    const told = new Set([user.id]);
    if (parent?.user_id && !told.has(parent.user_id)) {
      told.add(parent.user_id);
      notices.push(notifyStatement(env, { userId: parent.user_id, kind: "reply", actorId: user.id, text: `${user.name} ответил(а) на ваш комментарий`, link }));
    }
    if (target.ownerId && !told.has(target.ownerId)) {
      notices.push(notifyStatement(env, { userId: target.ownerId, kind: "reply", actorId: user.id, text: `${user.name}: новый комментарий к ${target.label}`, link }));
    }
    const statements = [...notices];
    if (body.targetType === "thread") {
      statements.push(env.DB.prepare(
        "UPDATE threads SET comments_count = comments_count + 1, last_activity_at = datetime('now') WHERE id = ?"
      ).bind(body.targetId));
    }
    if (statements.length) await env.DB.batch(statements);

    const achievements = await checkAchievements(env, user.id, "comment");
    return json({ comment: await getComment(env, user, row.id), achievements }, 201);
  }
};

/** /api/comments/:id — правка своего комментария (PATCH) и удаление (DELETE: автор или модератор) */
export const comment = {
  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await rawComment(env, id) : null;
    if (!row || row.deleted_at) return error("Комментарий не найден.", 404);
    if (row.user_id !== user.id) return error("Можно править только свои комментарии.", 403);
    const body = await readJson(request, 20_000);
    const parsed = readBody(body?.body, "Комментарий", 1, COMMENT_MAX);
    if (parsed.problem) return error(parsed.problem);
    await env.DB.prepare("UPDATE comments SET body = ?, spoiler = ?, edited_at = datetime('now') WHERE id = ?")
      .bind(parsed.text, body.spoiler === true ? 1 : 0, id).run();
    return json({ comment: await getComment(env, user, id) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await rawComment(env, id) : null;
    if (!row || row.deleted_at) return error("Комментарий не найден.", 404);
    const own = row.user_id === user.id;
    if (!own && !user.isModerator) return error("Удалять можно только свои комментарии.", 403);

    const statements = [
      env.DB.prepare("UPDATE comments SET body = '', deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").bind(user.id, id),
      env.DB.prepare("DELETE FROM comment_reactions WHERE comment_id = ?").bind(id)
    ];
    if (row.target_type === "thread") {
      statements.push(env.DB.prepare("UPDATE threads SET comments_count = MAX(comments_count - 1, 0) WHERE id = ?").bind(row.target_id));
    }
    if (!own) {
      statements.push(moderationStatement(env, user, { action: "comment.delete", targetType: "comment", targetId: id }));
      statements.push(env.DB.prepare(
        "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE target_type = 'comment' AND target_id = ? AND status = 'open'"
      ).bind(user.id, id));
      if (row.user_id) statements.push(notifyStatement(env, { userId: row.user_id, kind: "moderation", text: "Модератор удалил ваш комментарий за нарушение правил." }));
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
};

/** /api/comments/:id/reactions — поставить (PUT { kind }) или снять (DELETE { kind }) реакцию */
export const commentReactions = {
  async onRequestPut({ request, env, params }) {
    return react(request, env, params, true);
  },
  async onRequestDelete({ request, env, params }) {
    return react(request, env, params, false);
  }
};

async function react(request, env, params, add) {
  const { user, response } = await requireUser(env, request);
  if (response) return response;
  const id = parseId(params.id);
  const row = id ? await rawComment(env, id) : null;
  if (!row || row.deleted_at) return error("Комментарий не найден.", 404);
  const body = await readJson(request);
  if (!body || !REACTIONS[body.kind]) return error("Неизвестная реакция.");
  if (add) {
    const limited = await takeAction(env, user.id, "reaction");
    if (limited) return limited;
    await env.DB.prepare("INSERT OR IGNORE INTO comment_reactions (comment_id, user_id, kind) VALUES (?, ?, ?)").bind(id, user.id, body.kind).run();
  } else {
    await env.DB.prepare("DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND kind = ?").bind(id, user.id, body.kind).run();
  }
  const updated = await getComment(env, user, id);
  return json({ reactions: updated.reactions, myReactions: updated.myReactions });
}

// ==================== ОБСУЖДЕНИЯ И ТЕОРИИ ====================

const THREAD_SELECT = `SELECT th.id, th.user_id, th.title_id, th.kind, th.subject, th.body, th.spoiler, th.comments_count, th.created_at,
  th.last_activity_at, th.deleted_at, u.name AS author_name, p.username AS author_username, p.avatar_version, p.avatar_color,
  t.title AS title_name
FROM threads th LEFT JOIN users u ON u.id = th.user_id LEFT JOIN user_profiles p ON p.user_id = th.user_id
LEFT JOIN titles t ON t.id = th.title_id`;

function toThread(row, viewer, full = false) {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    body: full ? row.body : row.body.slice(0, 280),
    spoiler: row.spoiler === 1,
    comments: row.comments_count,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    title: row.title_id ? { id: row.title_id, title: row.title_name } : null,
    author: row.user_id ? {
      id: row.user_id, name: row.author_name, username: row.author_username, avatarColor: row.avatar_color || "violet",
      avatar: row.avatar_version ? `/avatars/${row.user_id}?v=${row.avatar_version}` : null
    } : null,
    canEdit: Boolean(viewer && viewer.id === row.user_id),
    canDelete: Boolean(viewer && (viewer.id === row.user_id || viewer.isModerator))
  };
}

/** /api/threads — лента обсуждений (GET ?kind=&title=&q=&offset=) и новое обсуждение или теория (POST) */
export const threads = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const where = ["th.deleted_at IS NULL"];
    const binds = [];
    const kind = search.get("kind");
    if (kind) {
      if (!["discussion", "theory"].includes(kind)) return error("Неизвестный вид обсуждения.");
      where.push("th.kind = ?");
      binds.push(kind);
    }
    const titleId = search.get("title") ? parseId(search.get("title")) : null;
    if (titleId) {
      where.push("th.title_id = ?");
      binds.push(titleId);
    }
    const query = cleanLine(search.get("q") || "").slice(0, 80);
    if (query) {
      where.push("th.subject LIKE ? ESCAPE '\\'");
      binds.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const order = search.get("sort") === "new" ? "th.id DESC" : "th.last_activity_at DESC, th.id DESC";
    const viewer = await currentUser(env, request);
    const [list, count] = await env.DB.batch([
      env.DB.prepare(`${THREAD_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 20 OFFSET ?`).bind(...binds, offset),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM threads th WHERE ${where.join(" AND ")}`).bind(...binds)
    ]);
    return json({ threads: list.results.map((row) => toThread(row, viewer)), total: count.results[0].n });
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const body = await readJson(request, 40_000);
    if (!body) return error("Некорректный запрос.");
    if (!["discussion", "theory"].includes(body.kind)) return error("Выберите: обсуждение или теория.");
    const subject = cleanLine(body.subject);
    const subjectProblem = lengthProblem(subject, "Заголовок", 3, 140) || spamProblem(subject);
    if (subjectProblem) return error(subjectProblem);
    const parsed = readBody(body.body, "Текст", 1, 10_000);
    if (parsed.problem) return error(parsed.problem);
    let titleId = null;
    if (body.titleId !== undefined && body.titleId !== null) {
      titleId = parseId(body.titleId);
      if (!titleId || !(await getTitle(env, titleId))) return error("Тайтл не найден.", 404);
    }
    const limited = await takeAction(env, user.id, "thread");
    if (limited) return limited;
    const row = await env.DB.prepare(
      "INSERT INTO threads (user_id, title_id, kind, subject, body, spoiler) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(user.id, titleId, body.kind, subject, parsed.text, body.spoiler === true ? 1 : 0).first();
    const achievements = await checkAchievements(env, user.id, "thread");
    const saved = await env.DB.prepare(`${THREAD_SELECT} WHERE th.id = ?`).bind(row.id).first();
    return json({ thread: toThread(saved, user, true), achievements }, 201);
  }
};

/** /api/threads/:id — обсуждение целиком (GET), правка автором (PATCH), удаление автором или модератором (DELETE) */
export const thread = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare(`${THREAD_SELECT} WHERE th.id = ?`).bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    const viewer = await currentUser(env, request);
    return json({ thread: toThread(row, viewer, true) });
  },

  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id, deleted_at FROM threads WHERE id = ?").bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    if (row.user_id !== user.id) return error("Править можно только свои обсуждения.", 403);
    const body = await readJson(request, 40_000);
    if (!body) return error("Некорректный запрос.");
    const subject = cleanLine(body.subject);
    const subjectProblem = lengthProblem(subject, "Заголовок", 3, 140) || spamProblem(subject);
    if (subjectProblem) return error(subjectProblem);
    const parsed = readBody(body.body, "Текст", 1, 10_000);
    if (parsed.problem) return error(parsed.problem);
    await env.DB.prepare("UPDATE threads SET subject = ?, body = ?, spoiler = ? WHERE id = ?")
      .bind(subject, parsed.text, body.spoiler === true ? 1 : 0, id).run();
    const saved = await env.DB.prepare(`${THREAD_SELECT} WHERE th.id = ?`).bind(id).first();
    return json({ thread: toThread(saved, user, true) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id, deleted_at FROM threads WHERE id = ?").bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    const own = row.user_id === user.id;
    if (!own && !user.isModerator) return error("Удалять можно только свои обсуждения.", 403);
    const statements = [env.DB.prepare("UPDATE threads SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").bind(user.id, id)];
    if (!own) {
      statements.push(moderationStatement(env, user, { action: "thread.delete", targetType: "thread", targetId: id }));
      if (row.user_id) statements.push(notifyStatement(env, { userId: row.user_id, kind: "moderation", text: "Модератор удалил ваше обсуждение за нарушение правил." }));
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
};

// ==================== ПОДБОРКИ ====================

const COLLECTION_SELECT = `SELECT c.id, c.user_id, c.name, c.description, c.is_public, c.featured, c.hidden_at, c.created_at, c.updated_at,
  u.name AS author_name, p.username AS author_username,
  (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS size
FROM collections c JOIN users u ON u.id = c.user_id LEFT JOIN user_profiles p ON p.user_id = c.user_id`;

function toCollection(row, viewer) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isPublic: row.is_public === 1,
    featured: row.featured === 1,
    hidden: row.hidden_at !== null,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: row.user_id, name: row.author_name, username: row.author_username },
    canEdit: Boolean(viewer && viewer.id === row.user_id)
  };
}

/** Подборка, которую viewer может видеть, или null */
async function visibleCollection(env, viewer, id) {
  const row = id ? await env.DB.prepare(`${COLLECTION_SELECT} WHERE c.id = ?`).bind(id).first() : null;
  if (!row) return null;
  const own = viewer?.id === row.user_id;
  if (!own && !viewer?.isModerator && (row.is_public !== 1 || row.hidden_at)) return null;
  return row;
}

function parseCollection(body) {
  const name = cleanLine(body.name);
  const nameProblem = lengthProblem(name, "Название подборки", 2, 80) || spamProblem(name);
  if (nameProblem) return { problem: nameProblem };
  const description = cleanText(body.description ?? "");
  const problem = lengthProblem(description, "Описание", 0, 1000) || spamProblem(description);
  if (problem) return { problem };
  if (typeof (body.isPublic ?? true) !== "boolean") return { problem: "Некорректная настройка видимости." };
  return { collection: { name, description, isPublic: body.isPublic !== false } };
}

/** /api/collections — подборки (GET ?user=username | ?mine=1 | ?title=id) и новая подборка (POST) */
export const collections = {
  async onRequestGet({ request, env }) {
    const search = new URL(request.url).searchParams;
    const viewer = await currentUser(env, request);
    const where = [];
    const binds = [];
    if (search.get("mine") === "1") {
      if (!viewer) return error("Войдите в профиль.", 401);
      where.push("c.user_id = ?");
      binds.push(viewer.id);
    } else {
      where.push("c.is_public = 1 AND c.hidden_at IS NULL");
      const username = search.get("user");
      if (username) {
        where.push("p.username = ?");
        binds.push(username);
      }
    }
    const titleId = search.get("title") ? parseId(search.get("title")) : null;
    if (titleId) {
      where.push("EXISTS (SELECT 1 FROM collection_items ci WHERE ci.collection_id = c.id AND ci.title_id = ?)");
      binds.push(titleId);
    }
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    const { results } = await env.DB.prepare(
      `${COLLECTION_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.featured DESC, c.updated_at DESC LIMIT 24 OFFSET ?`
    ).bind(...binds, offset).all();
    const previews = await Promise.all(results.map((row) =>
      env.DB.prepare("SELECT title_id FROM collection_items WHERE collection_id = ? ORDER BY position, added_at LIMIT 4").bind(row.id).all()));
    const ids = previews.flatMap((preview) => preview.results.map((item) => item.title_id));
    const titles = new Map((await getTitlesByIds(env, ids)).map((title) => [title.id, title]));
    return json({
      collections: results.map((row, i) => ({
        ...toCollection(row, viewer),
        preview: previews[i].results.map((item) => titles.get(item.title_id)).filter(Boolean)
          .map((title) => ({ id: title.id, title: title.title, symbol: title.symbol, poster: title.poster, cover: title.cover }))
      }))
    });
  },

  async onRequestPost({ request, env }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    const { collection: parsed, problem } = parseCollection(body);
    if (problem) return error(problem);
    const limited = await takeAction(env, user.id, "collection");
    if (limited) return limited;
    const row = await env.DB.prepare("INSERT INTO collections (user_id, name, description, is_public) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(user.id, parsed.name, parsed.description, parsed.isPublic ? 1 : 0).first();
    const saved = await env.DB.prepare(`${COLLECTION_SELECT} WHERE c.id = ?`).bind(row.id).first();
    return json({ collection: toCollection(saved, user) }, 201);
  }
};

/** /api/collections/:id — подборка с тайтлами (GET), правка (PATCH) и удаление (DELETE) владельцем */
export const collection = {
  async onRequestGet({ request, env, params }) {
    const viewer = await currentUser(env, request);
    const row = await visibleCollection(env, viewer, parseId(params.id));
    if (!row) return error("Подборка не найдена.", 404);
    const { results } = await env.DB.prepare(
      "SELECT title_id, note FROM collection_items WHERE collection_id = ? ORDER BY position, added_at"
    ).bind(row.id).all();
    const titles = await getTitlesByIds(env, results.map((item) => item.title_id));
    const notes = new Map(results.map((item) => [item.title_id, item.note]));
    return json({ collection: toCollection(row, viewer), items: titles.map((title) => ({ title, note: notes.get(title.id) })) });
  },

  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id FROM collections WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Подборка не найдена.", 404);
    if (row.user_id !== user.id) return error("Это чужая подборка.", 403);
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    const { collection: parsed, problem } = parseCollection(body);
    if (problem) return error(problem);
    await env.DB.prepare("UPDATE collections SET name = ?, description = ?, is_public = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(parsed.name, parsed.description, parsed.isPublic ? 1 : 0, id).run();
    const saved = await env.DB.prepare(`${COLLECTION_SELECT} WHERE c.id = ?`).bind(id).first();
    return json({ collection: toCollection(saved, user) });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id FROM collections WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Подборка не найдена.", 404);
    if (row.user_id !== user.id) return error("Это чужая подборка.", 403);
    await env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
};

/** /api/collections/:id/items — добавить тайтл (PUT { titleId, note }) или убрать (DELETE { titleId }) */
export const collectionItems = {
  async onRequestPut({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id FROM collections WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Подборка не найдена.", 404);
    if (row.user_id !== user.id) return error("Это чужая подборка.", 403);
    const body = await readJson(request);
    const titleId = body ? parseId(body.titleId) : null;
    if (!titleId || !(await getTitle(env, titleId))) return error("Тайтл не найден.", 404);
    const note = cleanLine(body.note ?? "");
    const problem = lengthProblem(note, "Заметка", 0, 300) || spamProblem(note);
    if (problem) return error(problem);
    const size = await env.DB.prepare("SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?").bind(id).first();
    if (size.n >= 100) return error("В подборке не больше 100 тайтлов.", 409);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO collection_items (collection_id, title_id, note, position) VALUES (?, ?, ?, ?)
         ON CONFLICT (collection_id, title_id) DO UPDATE SET note = excluded.note`
      ).bind(id, titleId, note, size.n),
      env.DB.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").bind(id)
    ]);
    const achievements = await checkAchievements(env, user.id, "collection");
    return json({ ok: true, achievements });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id FROM collections WHERE id = ?").bind(id).first() : null;
    if (!row) return error("Подборка не найдена.", 404);
    if (row.user_id !== user.id) return error("Это чужая подборка.", 403);
    const body = await readJson(request);
    const titleId = body ? parseId(body.titleId) : null;
    if (!titleId) return error("Тайтл не найден.", 404);
    await env.DB.prepare("DELETE FROM collection_items WHERE collection_id = ? AND title_id = ?").bind(id, titleId).run();
    return json({ ok: true });
  }
};

// ==================== ЖАЛОБЫ ====================

/** POST /api/reports — пожаловаться на комментарий, отзыв, обсуждение, подборку, профиль или турнир */
export const reports = {
  async onRequestPost({ request, env }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;
    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");
    if (!REPORT_TARGETS.includes(body.targetType) || !Number.isInteger(body.targetId)) return error("Укажите, на что жалоба.");
    if (!REPORT_REASONS[body.reason]) return error("Выберите причину жалобы.");
    const details = cleanText(body.details ?? "");
    const problem = lengthProblem(details, "Подробности", 0, 1000);
    if (problem) return error(problem);
    const target = await loadTarget(env, body.targetType, body.targetId);
    if (!target) return error("Не найдено.", 404);
    if (target.owner_id === user.id) return error("Нельзя пожаловаться на себя.", 409);
    const limited = await takeAction(env, user.id, "report");
    if (limited) return limited;
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)"
    ).bind(user.id, body.targetType, body.targetId, body.reason, details).run();
    return json({ ok: true, duplicate: !result.meta.changes }, result.meta.changes ? 201 : 200);
  }
};

/** GET /api/reviews/:id — один отзыв (для страницы с комментариями к нему) */
export const review = {
  async onRequestGet({ request, env, params }) {
    const viewer = await currentUser(env, request);
    const id = parseId(params.id);
    const found = id ? await getReview(env, viewer, id) : null;
    if (!found || (found.hidden && !viewer?.isModerator)) return error("Отзыв не найден.", 404);
    return json({ review: found });
  }
};
