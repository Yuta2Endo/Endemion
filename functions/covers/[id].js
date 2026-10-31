// GET /covers/:id — обложка тайтла из R2. Нужна в каталоге, на странице тайтла и в превью ссылок (og:image)

import { notFound } from "../_lib/html.js";
import { coverKey } from "../_lib/pages.js";
import { getTitle, parseId } from "../_lib/titles.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export async function onRequestGet({ params, env, request }) {
  const id = parseId(params.id);
  const title = id && env.DB ? await getTitle(env, id) : null;
  if (!title?.coverVersion || !env.PAGES) return notFound(env, request);

  const object = await env.PAGES.get(coverKey(title.id, title.coverVersion));
  const type = object?.httpMetadata?.contentType;
  if (!object || !IMAGE_TYPES.has(type)) return notFound(env, request);

  // Адрес с текущей версией не меняется никогда: его можно кешировать надолго
  const current = new URL(request.url).searchParams.get("v") === String(title.coverVersion);
  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(object.size),
      ETag: object.httpEtag,
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    }
  });
}
