// GET /api/games/:slug/reviews — публичные отзывы к игре со средней оценкой и количеством
// POST /api/games/:slug/reviews/add — добавить отзыв (только для авторизованных)
// PATCH /api/games/:slug/reviews/:review_id — отредактировать свой отзыв
// DELETE /api/games/:slug/reviews/:review_id — удалить свой отзыв

import { error, json, readJson } from "../../_lib/http.js";
import { requireUser } from "../../_lib/roles.js";
import { takeAction } from "../../_lib/limits.js";
import { cleanText, intParam, parseId } from "../../_lib/validate.js";
import {
  getGameBySlug, listGameReviews, getGameReview, addGameReview,
  updateGameReview, deleteGameReview, getGameReviewStats
} from "../../_lib/studio.js";

const REVIEW_BODY_MAX = 5000;

async function gameIdFromSlug(env, slug) {
  const row = await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first();
  return row ? row.id : null;
}

/** GET /api/games/:slug/reviews — публичные отзывы со статистикой */
export const gameReviews = {
  async onRequestGet({ env, params }) {
    const game = await getGameBySlug(env, params.slug);
    if (!game || !game.published) return error("Игра не найдена.", 404);

    const [reviews, stats] = await Promise.all([
      listGameReviews(env, game.id),
      getGameReviewStats(env, game.id)
    ]);

    return json({
      game: { id: game.id, slug: game.slug, title: game.title },
      stats: {
        avgScore: stats.avgScore,
        reviewCount: stats.reviewCount
      },
      reviews: reviews.map((r) => ({
        id: r.id,
        score: r.score,
        body: r.body,
        spoiler: r.spoiler,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        author: {
          id: r.author.id,
          name: r.author.name,
          username: r.author.username,
          avatar: r.author.avatar_version ? `/avatars/${r.author.id}?v=${r.author.avatar_version}` : null,
          avatarColor: r.author.avatarColor || "violet"
        }
      }))
    });
  }
};

/** POST /api/games/:slug/reviews/add — добавить отзыв */
export const gameReviewAdd = {
  async onRequestPost({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;

    const game = await getGameBySlug(env, params.slug);
    if (!game || !game.published) return error("Игра не найдена.", 404);

    const limited = await takeAction(env, user.id, "comment");
    if (limited) return limited;

    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");

    const score = intParam(body.score, null, 1, 10);
    if (score === null) return error("Оценка должна быть от 1 до 10.", 400);

    const text = cleanText(body.body ?? "");
    if (text.length > REVIEW_BODY_MAX) return error("Отзыв слишком длинный.", 400);

    const spoiler = body.spoiler === true || body.spoiler === "true" || body.spoiler === 1;

    const existing = await getGameReview(env, user.id, game.id);
    if (existing) return error("Вы уже оставили отзыв к этой игре.", 409);

    const reviewId = await addGameReview(env, user.id, game.id, score, text, spoiler);
    if (!reviewId) return error("Вы уже оставили отзыв к этой игре.", 409);
    return json({ id: reviewId, score, body: text, spoiler }, 201);
  }
};

/** PATCH /api/games/:slug/reviews/:review_id — отредактировать свой отзыв
 *  DELETE /api/games/:slug/reviews/:review_id — удалить свой отзыв */
export const gameReviewUpdateDelete = {
  async onRequestPatch({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;

    const reviewId = parseId(params.review_id);
    if (!reviewId) return error("Некорректный идентификатор отзыва.", 400);

    const existing = await env.DB.prepare(
      "SELECT user_id FROM game_reviews WHERE id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)"
    ).bind(reviewId, params.slug).first();
    if (!existing) return error("Отзыв не найден.", 404);
    if (existing.user_id !== user.id) return error("Нельзя редактировать чужой отзыв.", 403);

    const limited = await takeAction(env, user.id, "comment");
    if (limited) return limited;

    const body = await readJson(request);
    if (!body) return error("Некорректный запрос.");

    const score = body.score !== undefined ? intParam(body.score, null, 1, 10) : null;
    if (score === null && body.score !== undefined) return error("Оценка должна быть от 1 до 10.", 400);

    const text = body.body !== undefined ? cleanText(body.body) : null;
    if (text !== null && text.length > REVIEW_BODY_MAX) return error("Отзыв слишком длинный.", 400);

    const spoiler = body.spoiler !== undefined ? (body.spoiler === true || body.spoiler === "true" || body.spoiler === 1) : null;

    const gameId = await gameIdFromSlug(env, params.slug);
    const current = await getGameReview(env, user.id, gameId);
    if (!current) return error("Отзыв не найден.", 404);

    await updateGameReview(
      env,
      reviewId,
      user.id,
      score !== null ? score : current.score,
      text !== null ? text : current.body,
      spoiler !== null ? spoiler : current.spoiler
    );

    return json({
      id: reviewId,
      score: score !== null ? score : current.score,
      body: text !== null ? text : current.body,
      spoiler: spoiler !== null ? spoiler : current.spoiler
    });
  },

  async onRequestDelete({ request, env, params }) {
    const { user, response } = await requireUser(env, request);
    if (response) return response;

    const reviewId = parseId(params.review_id);
    if (!reviewId) return error("Некорректный идентификатор отзыва.", 400);

    const existing = await env.DB.prepare(
      "SELECT user_id FROM game_reviews WHERE id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)"
    ).bind(reviewId, params.slug).first();
    if (!existing) return error("Отзыв не найден.", 404);
    if (existing.user_id !== user.id) return error("Нельзя удалить чужой отзыв.", 403);

    await deleteGameReview(env, reviewId, user.id);
    return json({ id: reviewId, deleted: true });
  }
};
