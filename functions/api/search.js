// GET /api/search?q= — общий поиск по сайту: темы форума, ответы, игры и публикации студии.
// Черновики игр и публикаций, удалённые темы и ответы, ответы в удалённых темах в выдачу не попадают

import { json, error } from "../_lib/http.js";
import { cleanLine, intParam } from "../_lib/validate.js";

const LIMIT = 5;

function patternOf(query) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Фрагмент текста вокруг совпадения: чтобы в выдаче было видно, где нашлось */
function snippet(text, query) {
  const source = (text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const at = source.toLowerCase().indexOf(query.toLowerCase());
  const from = Math.max(0, (at < 0 ? 0 : at) - 40);
  const cut = source.slice(from, from + 140);
  return `${from > 0 ? "…" : ""}${cut}${from + 140 < source.length ? "…" : ""}`;
}

export const search = {
  async onRequestGet({ request, env }) {
    const params = new URL(request.url).searchParams;
    const query = cleanLine(params.get("q") || "").slice(0, 80);
    const offset = intParam(params.get("offset"), 0, 0, 100_000);
    if (offset === null) return error("Некорректный offset.");
    if ([...query].length < 2) return json({ query, threads: [], comments: [], games: [], posts: [] });

    const pattern = patternOf(query);
    const [threads, comments, games, posts] = await env.DB.batch([
      env.DB.prepare(
        `SELECT th.id, th.subject, th.body, th.comments_count, c.slug AS category_slug, c.title AS category_title
         FROM threads th LEFT JOIN forum_categories c ON c.id = th.category_id
         WHERE th.deleted_at IS NULL AND (th.subject LIKE ? ESCAPE '\\' OR th.body LIKE ? ESCAPE '\\')
         ORDER BY th.last_activity_at DESC, th.id DESC LIMIT ? OFFSET ?`
      ).bind(pattern, pattern, LIMIT, offset),
      env.DB.prepare(
        `SELECT cm.id, cm.body, th.id AS thread_id, th.subject AS thread_subject
         FROM comments cm JOIN threads th ON th.id = cm.target_id AND cm.target_type = 'thread'
         WHERE cm.deleted_at IS NULL AND th.deleted_at IS NULL AND cm.body LIKE ? ESCAPE '\\'
         ORDER BY cm.created_at DESC, cm.id DESC LIMIT ? OFFSET ?`
      ).bind(pattern, LIMIT, offset),
      env.DB.prepare(
        `SELECT slug, title, tagline, description FROM games
         WHERE published = 1 AND (title LIKE ? ESCAPE '\\' OR tagline LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
         ORDER BY position, id LIMIT ? OFFSET ?`
      ).bind(pattern, pattern, pattern, LIMIT, offset),
      env.DB.prepare(
        `SELECT slug, title, summary, body, kind FROM studio_posts
         WHERE status IN ('published', 'archived') AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
         ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`
      ).bind(pattern, pattern, pattern, LIMIT, offset)
    ]);

    return json({
      query,
      threads: threads.results.map((row) => ({
        id: row.id,
        subject: row.subject,
        snippet: snippet(row.body, query),
        comments: row.comments_count,
        category: row.category_slug ? { slug: row.category_slug, title: row.category_title } : null,
        url: `/community/thread/${row.id}`
      })),
      comments: comments.results.map((row) => ({
        id: row.id,
        snippet: snippet(row.body, query),
        thread: { id: row.thread_id, subject: row.thread_subject },
        url: `/community/thread/${row.thread_id}#comment-${row.id}`
      })),
      games: games.results.map((row) => ({
        slug: row.slug,
        title: row.title,
        snippet: snippet(row.tagline || row.description, query),
        url: `/games/${row.slug}`
      })),
      posts: posts.results.map((row) => ({
        slug: row.slug,
        title: row.title,
        kind: row.kind,
        snippet: snippet(row.summary || row.body, query),
        url: `/studio/${row.slug}`
      }))
    });
  }
};
