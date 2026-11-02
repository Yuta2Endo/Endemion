// Отзывы и оценки: одна оценка от 1 до 10 на пользователя и тайтл, текст необязателен.
// Рейтинг читателей в каталоге считается только по этим оценкам (functions/_lib/titles.js)

const REVIEW_SELECT = `SELECT r.id, r.user_id, r.title_id, r.score, r.body, r.spoiler, r.created_at, r.updated_at, r.hidden_at,
  u.name AS author_name, p.username AS author_username, p.avatar_version AS author_avatar, p.avatar_color AS author_color,
  (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'review' AND c.target_id = r.id AND c.deleted_at IS NULL) AS comments
FROM reviews r JOIN users u ON u.id = r.user_id LEFT JOIN user_profiles p ON p.user_id = r.user_id`;

export function toReview(row, viewer) {
  return {
    id: row.id,
    titleId: row.title_id,
    score: row.score,
    body: row.body,
    spoiler: row.spoiler === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hidden: row.hidden_at !== null,
    comments: row.comments,
    author: {
      id: row.user_id,
      name: row.author_name,
      username: row.author_username,
      avatar: row.author_avatar ? `/avatars/${row.user_id}?v=${row.author_avatar}` : null,
      avatarColor: row.author_color || "violet"
    },
    canEdit: Boolean(viewer && viewer.id === row.user_id),
    canModerate: Boolean(viewer?.isModerator)
  };
}

/** Отзывы тайтла с текстом (оценки без текста только считаются) и распределение оценок */
export async function listReviews(env, viewer, titleId, { offset = 0, limit = 10 } = {}) {
  const [list, count, histogram, mine] = await env.DB.batch([
    env.DB.prepare(`${REVIEW_SELECT} WHERE r.title_id = ? AND r.hidden_at IS NULL AND r.body <> '' ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .bind(titleId, limit, offset),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reviews WHERE title_id = ? AND hidden_at IS NULL AND body <> ''").bind(titleId),
    env.DB.prepare("SELECT score, COUNT(*) AS n FROM reviews WHERE title_id = ? AND hidden_at IS NULL GROUP BY score").bind(titleId),
    env.DB.prepare(`${REVIEW_SELECT} WHERE r.title_id = ? AND r.user_id = ?`).bind(titleId, viewer?.id ?? 0)
  ]);
  const distribution = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 0]));
  let votes = 0;
  let sum = 0;
  for (const row of histogram.results) {
    distribution[row.score] = row.n;
    votes += row.n;
    sum += row.score * row.n;
  }
  return {
    reviews: list.results.map((row) => toReview(row, viewer)),
    total: count.results[0].n,
    summary: { votes, average: votes ? Math.round((sum / votes) * 10) / 10 : null, distribution },
    mine: mine.results[0] ? toReview(mine.results[0], viewer) : null
  };
}

export async function getReview(env, viewer, id) {
  const row = await env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`).bind(id).first();
  return row ? toReview(row, viewer) : null;
}
