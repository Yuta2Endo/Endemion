// GET /sitemap.xml — страницы портала: главная, игры, публикации студии, форум, правовые страницы.
// Черновики игр и публикаций в карту не попадают

import { escapeHtml } from "./_lib/html.js";

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const games = env.DB ? (await env.DB.prepare("SELECT slug, updated_at FROM games WHERE published = 1 ORDER BY position").all()).results : [];
  const posts = env.DB
    ? (await env.DB.prepare("SELECT slug, updated_at FROM studio_posts WHERE status IN ('published', 'archived') ORDER BY published_at DESC LIMIT 5000").all()).results
    : [];
  const categories = env.DB
    ? (await env.DB.prepare(
      "SELECT c.slug FROM forum_categories c LEFT JOIN games g ON g.id = c.game_id WHERE c.game_id IS NULL OR g.published = 1 ORDER BY c.position"
    ).all()).results
    : [];

  const urls = [
    { loc: `${origin}/` },
    ...["games", "studio", "about", "community", "terms", "privacy", "copyright"].map((path) => ({ loc: `${origin}/${path}` })),
    ...games.map((g) => ({ loc: `${origin}/games/${g.slug}`, lastmod: g.updated_at })),
    ...posts.map((p) => ({ loc: `${origin}/studio/${p.slug}`, lastmod: p.updated_at })),
    ...categories.map((c) => ({ loc: `${origin}/community/c/${c.slug}` }))
  ];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(({ loc, lastmod }) =>
        `  <url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</url>`)
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }
  });
}
