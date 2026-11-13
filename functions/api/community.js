// ENDEMION COMMUNITY: темы форума, ответы с реакциями, закрепление и закрытие тем, жалобы.
// Каждый экспорт — маршрут, адреса перечислены в src/worker.js.
// Защита от спама: лимиты частоты (functions/_lib/limits.js), проверка ссылок и повторов, запрет для заглушённых модератором

import { checkAchievements } from "../_lib/achievements.js";
import {
  COMMENT_MAX, getComment, listComments, loadCommentTarget, rawComment, REACTIONS, TARGET_TYPES
} from "../_lib/comments.js";
import { error, json, readJson } from "../_lib/http.js";
import { isDuplicate, spamProblem, takeAction } from "../_lib/limits.js";
import { commentLink, REPORT_REASONS, REPORT_TARGETS, loadTarget, moderationStatement } from "../_lib/moderation.js";
import { mentionStatements, notifyStatement } from "../_lib/notifications.js";
import { mutedProblem, requireRole, requireUser } from "../_lib/roles.js";
import { currentUser } from "../_lib/session.js";
import { cleanLine, cleanText, intParam, lengthProblem, parseId } from "../_lib/validate.js";

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
    // В закрытую тему отвечают только модераторы и админы
    if (body.targetType === "thread" && !user.isModerator) {
      const lock = await env.DB.prepare("SELECT locked_at FROM threads WHERE id = ?").bind(body.targetId).first();
      if (lock?.locked_at) return error("Тема закрыта, новые ответы не принимаются.", 409);
    }
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
      // Подписчики темы узнают об ответе, кроме тех, кому уведомление уже ушло (автор темы, автор ответа)
      const subscribers = (await env.DB.prepare(
        "SELECT user_id FROM thread_subscriptions WHERE thread_id = ?"
      ).bind(body.targetId).all()).results;
      for (const subscriber of subscribers) {
        if (told.has(subscriber.user_id)) continue;
        told.add(subscriber.user_id);
        statements.push(notifyStatement(env, {
          userId: subscriber.user_id, kind: "reply", actorId: user.id, link,
          text: `${user.name}: новый ответ в теме ${target.label}`
        }));
      }
    }
    statements.push(...await mentionStatements(env, { text: parsed.text, actor: user, link, told }));
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
    if (parsed.text !== row.body) await saveRevision(env, "comment", id, { body: row.body }, user.id);
    await env.DB.prepare("UPDATE comments SET body = ?, spoiler = ?, edited_at = datetime('now') WHERE id = ?")
      .bind(parsed.text, body.spoiler === true ? 1 : 0, id).run();
    const link = await commentLink(env, row.target_type, row.target_id, id);
    const mentions = await mentionStatements(env, { text: parsed.text, actor: user, link, told: new Set([user.id]) });
    if (mentions.length) await env.DB.batch(mentions);
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

const THREAD_SELECT = `SELECT th.id, th.user_id, th.kind, th.subject, th.body, th.spoiler, th.comments_count, th.created_at,
  th.last_activity_at, th.deleted_at, th.hidden_at, th.category_id, th.pinned_at, th.locked_at, u.name AS author_name, u.role AS author_role,
  p.username AS author_username, p.avatar_version, p.avatar_color,
  fc.slug AS category_slug, fc.title AS category_title
FROM threads th LEFT JOIN users u ON u.id = th.user_id LEFT JOIN user_profiles p ON p.user_id = th.user_id
LEFT JOIN forum_categories fc ON fc.id = th.category_id`;

function toThread(row, viewer, full = false) {
  const locked = Boolean(row.locked_at);
  // Скрытую после жалоб тему видит целиком только модератор; остальным отдаём заголовок и причину
  const hidden = Boolean(row.hidden_at);
  const masked = hidden && !viewer?.isModerator;
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    body: masked ? "" : full ? row.body : row.body.slice(0, 280),
    spoiler: row.spoiler === 1,
    hidden,
    comments: row.comments_count,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    pinned: Boolean(row.pinned_at),
    locked,
    category: row.category_id ? { id: row.category_id, slug: row.category_slug, title: row.category_title } : null,
    author: row.user_id ? {
      id: row.user_id, name: row.author_name, username: row.author_username, role: row.author_role, avatarColor: row.avatar_color || "violet",
      avatar: row.avatar_version ? `/avatars/${row.user_id}?v=${row.avatar_version}` : null
    } : null,
    // Закрытую тему автор не правит: её содержимое зафиксировал модератор
    canEdit: Boolean(viewer && !masked && viewer.id === row.user_id && (!locked || viewer.isModerator)),
    canDelete: Boolean(viewer && (viewer.id === row.user_id || viewer.isModerator)),
    canModerate: Boolean(viewer?.isModerator)
  };
}

/** Категория форума для новой темы: существующая, а в категорию «только для команды» пишут модераторы и админы */
async function threadCategory(env, user, value) {
  if (value === undefined || value === null || value === "") {
    const general = await env.DB.prepare("SELECT id FROM forum_categories WHERE slug = 'general'").first();
    return { id: general?.id ?? null };
  }
  const id = typeof value === "string" && !/^\d+$/.test(value)
    ? (await env.DB.prepare("SELECT id FROM forum_categories WHERE slug = ?").bind(value).first())?.id
    : parseId(value);
  const row = id ? await env.DB.prepare("SELECT id, staff_only FROM forum_categories WHERE id = ?").bind(id).first() : null;
  if (!row) return { problem: error("Категория не найдена.", 404) };
  if (row.staff_only === 1 && !user.isModerator) return { problem: error("В этой категории публикует только команда Endemion.", 403) };
  return { id: row.id };
}

/** /api/threads — лента обсуждений (GET ?kind=&category=&q=&offset=) и новое обсуждение или теория (POST) */
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
    const categorySlug = search.get("category");
    if (categorySlug) {
      const category = await env.DB.prepare("SELECT id FROM forum_categories WHERE slug = ?").bind(categorySlug.slice(0, 60)).first();
      if (!category) return error("Категория не найдена.", 404);
      where.push("th.category_id = ?");
      binds.push(category.id);
    }
    const query = cleanLine(search.get("q") || "").slice(0, 80);
    if (query) {
      // Поиск по заголовку и тексту темы
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(th.subject LIKE ? ESCAPE '\\' OR th.body LIKE ? ESCAPE '\\')");
      binds.push(pattern, pattern);
    }
    const offset = intParam(search.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    // В категории закреплённые темы идут первыми; в общей ленте закрепление не поднимает тему
    const pinnedFirst = categorySlug ? "th.pinned_at IS NULL, " : "";
    const order = search.get("sort") === "new" ? `${pinnedFirst}th.id DESC` : `${pinnedFirst}th.last_activity_at DESC, th.id DESC`;
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
    const category = await threadCategory(env, user, body.category);
    if (category.problem) return category.problem;
    const limited = await takeAction(env, user.id, "thread");
    if (limited) return limited;
    const row = await env.DB.prepare(
      "INSERT INTO threads (user_id, kind, subject, body, spoiler, category_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(user.id, body.kind, subject, parsed.text, body.spoiler === true ? 1 : 0, category.id).first();
    // Автор темы подписан на ответы в ней
    await env.DB.prepare("INSERT OR IGNORE INTO thread_subscriptions (user_id, thread_id) VALUES (?, ?)").bind(user.id, row.id).run();
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
    const thread = toThread(row, viewer, true);
    thread.subscribed = viewer
      ? Boolean(await env.DB.prepare("SELECT 1 AS n FROM thread_subscriptions WHERE user_id = ? AND thread_id = ?").bind(viewer.id, id).first())
      : false;
    thread.revisions = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM content_revisions WHERE target_type = 'thread' AND target_id = ?"
    ).bind(id).first()).n;
    return json({ thread });
  },

  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireWriter(env, request);
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT user_id, deleted_at, locked_at FROM threads WHERE id = ?").bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    if (row.user_id !== user.id) return error("Править можно только свои обсуждения.", 403);
    if (row.locked_at && !user.isModerator) return error("Тема закрыта модератором, править её нельзя.", 409);
    const body = await readJson(request, 40_000);
    if (!body) return error("Некорректный запрос.");
    const subject = cleanLine(body.subject);
    const subjectProblem = lengthProblem(subject, "Заголовок", 3, 140) || spamProblem(subject);
    if (subjectProblem) return error(subjectProblem);
    const parsed = readBody(body.body, "Текст", 1, 10_000);
    if (parsed.problem) return error(parsed.problem);
    const previous = await env.DB.prepare("SELECT subject, body FROM threads WHERE id = ?").bind(id).first();
    if (previous.subject !== subject || previous.body !== parsed.text) await saveRevision(env, "thread", id, previous, user.id);
    await env.DB.prepare("UPDATE threads SET subject = ?, body = ?, spoiler = ? WHERE id = ?")
      .bind(subject, parsed.text, body.spoiler === true ? 1 : 0, id).run();
    const mentions = await mentionStatements(env, {
      text: `${subject}\n${parsed.text}`, actor: user, link: `/community/thread/${id}`, told: new Set([user.id])
    });
    if (mentions.length) await env.DB.batch(mentions);
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

/**
 * PATCH /api/threads/:id/moderation — закрепить, закрыть или перенести тему (модераторы и админы).
 * Тело: { pinned?: boolean, locked?: boolean, category?: slug }. Каждое действие пишется в журнал модерации
 */
export const threadModeration = {
  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireRole(env, request, "moderator");
    if (response) return response;
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT id, user_id, deleted_at, pinned_at, locked_at, category_id FROM threads WHERE id = ?").bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    const body = await readJson(request, 2_000);
    if (!body) return error("Некорректный запрос.");
    const sets = [];
    const binds = [];
    const actions = [];
    for (const [key, column, on, off] of [["pinned", "pinned_at", "thread.pin", "thread.unpin"], ["locked", "locked_at", "thread.lock", "thread.unlock"]]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean") return error("Некорректный запрос.");
      if (body[key] === Boolean(row[column])) continue;
      sets.push(body[key] ? `${column} = datetime('now')` : `${column} = NULL`);
      actions.push(body[key] ? on : off);
    }
    if (body.category !== undefined) {
      if (typeof body.category !== "string") return error("Некорректный запрос.");
      const category = await threadCategory(env, user, body.category);
      if (category.problem) return category.problem;
      if (category.id !== row.category_id) {
        sets.push("category_id = ?");
        binds.push(category.id);
        actions.push("thread.move");
      }
    }
    if (sets.length) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE threads SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id),
        ...actions.map((action) => moderationStatement(env, user, { action, targetType: "thread", targetId: id }))
      ]);
    }
    const saved = await env.DB.prepare(`${THREAD_SELECT} WHERE th.id = ?`).bind(id).first();
    return json({ thread: toThread(saved, user, true) });
  }
};

// На запись хранится до 20 последних версий: старше удаляются
const REVISIONS_KEEP = 20;

async function saveRevision(env, type, id, { subject = null, body }, editorId) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO content_revisions (target_type, target_id, subject, body, edited_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(type, id, subject, body.slice(0, 10_000), editorId),
    env.DB.prepare(
      `DELETE FROM content_revisions WHERE target_type = ? AND target_id = ? AND id NOT IN
         (SELECT id FROM content_revisions WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT ?)`
    ).bind(type, id, type, id, REVISIONS_KEEP)
  ]);
}

/** PUT/DELETE /api/threads/:id/subscription — подписаться на ответы в теме или отписаться */
export const threadSubscription = {
  async onRequestPut({ request, env, params }) {
    return setSubscription(request, env, params, true);
  },
  async onRequestDelete({ request, env, params }) {
    return setSubscription(request, env, params, false);
  }
};

async function setSubscription(request, env, params, on) {
  const { user, response } = await requireUser(env, request);
  if (response) return response;
  const id = parseId(params.id);
  const row = id ? await env.DB.prepare("SELECT deleted_at FROM threads WHERE id = ?").bind(id).first() : null;
  if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
  if (on) {
    await env.DB.prepare("INSERT OR IGNORE INTO thread_subscriptions (user_id, thread_id) VALUES (?, ?)").bind(user.id, id).run();
  } else {
    await env.DB.prepare("DELETE FROM thread_subscriptions WHERE user_id = ? AND thread_id = ?").bind(user.id, id).run();
  }
  return json({ subscribed: on });
}

/** GET /api/threads/:id/revisions — прежние версии темы: новее первыми. Видят все, тема не удалена */
export const threadRevisions = {
  async onRequestGet({ env, params }) {
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT deleted_at FROM threads WHERE id = ?").bind(id).first() : null;
    if (!row || row.deleted_at) return error("Обсуждение не найдено.", 404);
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.subject, r.body, r.created_at, u.name AS editor_name, p.username AS editor_username
       FROM content_revisions r LEFT JOIN users u ON u.id = r.edited_by LEFT JOIN user_profiles p ON p.user_id = r.edited_by
       WHERE r.target_type = 'thread' AND r.target_id = ? ORDER BY r.id DESC LIMIT 20`
    ).bind(id).all();
    return json({
      revisions: results.map((revision) => ({
        id: revision.id, subject: revision.subject, body: revision.body, createdAt: revision.created_at,
        editor: revision.editor_name ? { name: revision.editor_name, username: revision.editor_username } : null
      }))
    });
  }
};

// ==================== ЖАЛОБЫ ====================

// Со скольких разных жалоб на один объект зовём модераторов. Само содержимое не скрываем:
// решение принимает человек, автоматика только привлекает внимание
const REPORT_ALERT = 3;

const REPORT_LABEL = { comment: "ответ", thread: "тема", user: "профиль" };

// С этого числа разных жалоб содержимое прячется само: модератор может вернуть,
// поэтому автоматика не удаляет, а временно скрывает.
const HIDE_AFTER_REPORTS = 5;

/** Рассылает уведомление всем админам и модераторам */
async function notifyModerators(env, text, link = "/admin") {
  const { results } = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('admin', 'moderator') AND blocked_at IS NULL"
  ).all();
  if (!results.length) return;
  await env.DB.batch(results.map((row) => notifyStatement(env, {
    userId: row.id,
    kind: "moderation",
    text,
    link
  })));
}

/** После третьей жалобы пишем всем модераторам и админам — дальше молчим, чтобы не спамить */
async function alertModerators(env, targetType, targetId) {
  const fresh = await env.DB.prepare(
    "SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'"
  ).bind(targetType, targetId).first();
  if (fresh.n !== REPORT_ALERT) return;
  await notifyModerators(env, `Жалобы на ${REPORT_LABEL[targetType] || "материал"}: ${fresh.n}. Проверьте в админке.`);
}

/**
 * Пятая жалоба скрывает ответ или тему до решения модератора.
 * Скрытие обратимое: hidden_at снимается кнопкой в админке, данные остаются.
 * @param {any} env
 * @param {string} targetType
 * @param {number} targetId
 */
async function autoHide(env, targetType, targetId) {
  if (targetType !== "comment" && targetType !== "thread") return;
  const fresh = await env.DB.prepare(
    "SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'"
  ).bind(targetType, targetId).first();
  if (fresh.n < HIDE_AFTER_REPORTS) return;
  const table = targetType === "comment" ? "comments" : "threads";
  const hidden = await env.DB.prepare(
    `UPDATE ${table} SET hidden_at = datetime('now') WHERE id = ? AND hidden_at IS NULL AND deleted_at IS NULL`
  ).bind(targetId).run();
  if (hidden.meta.changes !== 1) return;
  await env.DB.prepare(
    "INSERT INTO moderation_actions (moderator_name, action, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?)"
  ).bind("Автоматически", "hide", targetType, targetId, `Скрыто после ${fresh.n} жалоб`).run();
  await notifyModerators(env, `${REPORT_LABEL[targetType]} скрыт после ${fresh.n} жалоб. Проверьте и верните, если жалобы не по делу.`);
}

/** POST /api/reports — пожаловаться на ответ, тему форума или профиль */
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
    if (result.meta.changes) {
      await alertModerators(env, body.targetType, body.targetId);
      await autoHide(env, body.targetType, body.targetId);
    }
    return json({ ok: true, duplicate: !result.meta.changes }, result.meta.changes ? 201 : 200);
  }
};

