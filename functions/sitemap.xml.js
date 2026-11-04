// GET /sitemap.xml — главная, разделы энциклопедии, произведения из списков пользователей, разделы читалки и её тайтлы.
// Каталог энциклопедии в базу целиком не загружается: остальные страницы поисковики находят по ссылкам

import { escapeHtml } from "./_lib/html.js";
import { listTitles } from "./_lib/titles.js";

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const titles = env.DB ? await listTitles(env, "id") : [];
  // Не больше 40 000 адресов в одном файле: предел протокола — 50 000
  const entries = env.DB
    ? (await env.DB.prepare("SELECT kind, ext_id, slug, refreshed_at FROM entries ORDER BY refreshed_at DESC LIMIT 40000").all()).results
    : [];

  // Портал студии: опубликованные игры и публикации. Черновики в карту не попадают
  const games = env.DB ? (await env.DB.prepare("SELECT slug, updated_at FROM games WHERE published = 1 ORDER BY position").all()).results : [];
  const posts = env.DB
    ? (await env.DB.prepare("SELECT slug, updated_at FROM studio_posts WHERE status IN ('published', 'archived') ORDER BY published_at DESC LIMIT 5000").all()).results
    : [];

  const urls = [
    { loc: `${origin}/` },
    ...["games", "studio", "about", "community", "terms"].map((path) => ({ loc: `${origin}/${path}` })),
    ...games.map((g) => ({ loc: `${origin}/games/${g.slug}`, lastmod: g.updated_at })),
    ...posts.map((p) => ({ loc: `${origin}/studio/${p.slug}`, lastmod: p.updated_at })),
    { loc: `${origin}/encyclopedia` },
    ...["anime", "manga", "characters", "people", "studios", "seasons", "rankings"].map((path) => ({ loc: `${origin}/${path}` })),
    ...entries.map((row) => ({ loc: `${origin}/${row.kind}/${row.ext_id}${row.slug ? `-${row.slug}` : ""}`, lastmod: new Date(row.refreshed_at).toISOString() })),
    // Разделы читалки, открытые без входа. Pulse и профиль — личные, их в карте нет
    ...["reading", "catalog", "nexus", "oracle", "arena"].map((path) => ({ loc: `${origin}/${path}` })),
    { loc: `${origin}/privacy` },
    { loc: `${origin}/copyright` },
    ...titles.map((t) => ({ loc: `${origin}/title/${t.id}`, lastmod: t.updatedAt }))
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
