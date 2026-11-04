// Ответы в темах форума ENDEMION COMMUNITY. Ответы на ответы — одним уровнем вложенности:
// root_id — корневой комментарий ветки, parent_id — на какой именно комментарий ответ (для «ответ @имя»).
// Удалённый комментарий остаётся заглушкой без текста, чтобы ветка не рассыпалась

import { commentLink } from "./moderation.js";

// Комментарии к разделам, удалённым 2026-11-04 (тайтлы, подборки, энциклопедия), остались в базе, но сайт их не показывает
export const TARGET_TYPES = ["thread"];
export const REACTIONS = { like: "👍", fire: "🔥", heart: "❤️", laugh: "😂", wow: "😮", sad: "😢" };
export const COMMENT_MAX = 3000;
export const PAGE = 20;

/** Существует ли цель и можно ли её комментировать. Возвращает { ownerId, label } или null */
export async function loadCommentTarget(env, type, id) {
  if (type !== "thread") return null;
  const row = await env.DB.prepare("SELECT user_id, subject FROM threads WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  return row ? { ownerId: row.user_id, label: `«${row.subject}»` } : null;
}

const COMMENT_SELECT = `SELECT c.id, c.user_id, c.target_type, c.target_id, c.parent_id, c.root_id, c.body, c.spoiler, c.created_at,
  c.edited_at, c.deleted_at, u.name AS author_name, u.role AS author_role, p.username AS author_username,
  p.avatar_version AS author_avatar, p.avatar_color AS author_color, pu.name AS parent_name,
  (SELECT json_group_object(kind, n) FROM (SELECT kind, COUNT(*) AS n FROM comment_reactions WHERE comment_id = c.id GROUP BY kind)) AS reactions,
  (SELECT json_group_array(kind) FROM comment_reactions WHERE comment_id = c.id AND user_id = ?) AS mine,
  (SELECT COUNT(*) FROM comments r WHERE r.root_id = c.id) AS replies
FROM comments c
LEFT JOIN users u ON u.id = c.user_id
LEFT JOIN user_profiles p ON p.user_id = c.user_id
LEFT JOIN comments pc ON pc.id = c.parent_id
LEFT JOIN users pu ON pu.id = pc.user_id`;

export function toComment(row, viewer) {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    parentId: row.parent_id,
    rootId: row.root_id,
    body: deleted ? "" : row.body,
    spoiler: row.spoiler === 1,
    deleted,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    author: deleted || !row.user_id ? null : {
      id: row.user_id,
      name: row.author_name,
      username: row.author_username,
      role: row.author_role,
      avatar: row.author_avatar ? `/avatars/${row.user_id}?v=${row.author_avatar}` : null,
      avatarColor: row.author_color || "violet"
    },
    replyTo: row.parent_id && row.parent_id !== row.root_id ? row.parent_name : null,
    reactions: JSON.parse(row.reactions || "{}"),
    myReactions: JSON.parse(row.mine || "[]"),
    replies: row.replies,
    canEdit: Boolean(viewer && !deleted && viewer.id === row.user_id),
    canDelete: Boolean(viewer && !deleted && (viewer.id === row.user_id || viewer.isModerator))
  };
}

/**
 * Корневые комментарии цели с первыми ответами. sort: new или top (по числу реакций).
 * Ответы на корневые комментарии отдаются целиком до 50 штук, дальше — по запросу ветки
 */
export async function listComments(env, viewer, type, id, { offset = 0, sort = "new" } = {}) {
  const order = sort === "top"
    ? "(SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id) DESC, c.id DESC"
    : "c.id DESC";
  const viewerId = viewer?.id ?? 0;
  const [roots, count] = await env.DB.batch([
    env.DB.prepare(`${COMMENT_SELECT} WHERE c.target_type = ? AND c.target_id = ? AND c.root_id IS NULL
      AND (c.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comments r WHERE r.root_id = c.id AND r.deleted_at IS NULL))
      ORDER BY ${order} LIMIT ? OFFSET ?`).bind(viewerId, type, id, PAGE, offset),
    env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL").bind(type, id)
  ]);
  const rootIds = roots.results.map((row) => row.id);
  let replies = [];
  if (rootIds.length) {
    const result = await env.DB.prepare(`${COMMENT_SELECT} WHERE c.root_id IN (${rootIds.map(() => "?").join(", ")})
      ORDER BY c.id LIMIT 500`).bind(viewerId, ...rootIds).all();
    replies = result.results;
  }
  const byRoot = new Map();
  for (const row of replies) {
    const list = byRoot.get(row.root_id) || [];
    if (list.length < 50) list.push(toComment(row, viewer));
    byRoot.set(row.root_id, list);
  }
  return {
    comments: roots.results.map((row) => ({ ...toComment(row, viewer), thread: byRoot.get(row.id) || [] })),
    total: count.results[0].n,
    hasMore: roots.results.length === PAGE
  };
}

export async function getComment(env, viewer, id) {
  const row = await env.DB.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).bind(viewer?.id ?? 0, id).first();
  return row ? toComment(row, viewer) : null;
}

export async function rawComment(env, id) {
  return env.DB.prepare("SELECT id, user_id, target_type, target_id, parent_id, root_id, deleted_at FROM comments WHERE id = ?").bind(id).first();
}

export { commentLink };
