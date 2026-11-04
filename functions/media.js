// Картинки портала из хранилища (диск или S3 на своём сервере, R2 на Cloudflare):
// GET /media/games/:id/cover, /media/games/:id/shots/:mediaId, /media/posts/:id.
// Ключи: games/<id>/cover/<версия>, games/<id>/media/<mediaId>, posts/<id>/<версия>

import { notFound } from "./_lib/html.js";
import { parseId } from "./_lib/validate.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export const gameCoverKey = (gameId, version) => `games/${gameId}/cover/${version}`;
export const gameShotKey = (gameId, mediaId) => `games/${gameId}/media/${mediaId}`;
export const postImageKey = (postId, version) => `posts/${postId}/${version}`;

async function serve(env, request, key, immutable) {
  if (!env.PAGES) return notFound(env, request);
  const object = await env.PAGES.get(key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !IMAGE_TYPES.has(type)) return notFound(env, request);
  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(object.size),
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    }
  });
}

export const gameCover = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT cover_version, published FROM games WHERE id = ?").bind(id).first() : null;
    if (!row?.cover_version) return notFound(env, request);
    const current = new URL(request.url).searchParams.get("v") === String(row.cover_version);
    return serve(env, request, gameCoverKey(id, row.cover_version), current);
  }
};

export const gameShot = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    const mediaId = parseId(params.mediaId);
    const row = id && mediaId ? await env.DB.prepare("SELECT id FROM game_media WHERE id = ? AND game_id = ?").bind(mediaId, id).first() : null;
    if (!row) return notFound(env, request);
    // Номер скриншота не переиспользуется: файл по этому адресу не меняется
    return serve(env, request, gameShotKey(id, mediaId), true);
  }
};

export const postImage = {
  async onRequestGet({ request, env, params }) {
    const id = parseId(params.id);
    const row = id ? await env.DB.prepare("SELECT image_version, status FROM studio_posts WHERE id = ?").bind(id).first() : null;
    // Картинка черновика не отдаётся: по ней можно угадать неопубликованный анонс
    if (!row?.image_version || row.status === "draft") return notFound(env, request);
    const current = new URL(request.url).searchParams.get("v") === String(row.image_version);
    return serve(env, request, postImageKey(id, row.image_version), current);
  }
};
