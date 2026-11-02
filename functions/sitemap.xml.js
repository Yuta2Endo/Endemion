// GET /sitemap.xml — главная, открытые разделы, политика и страницы всех тайтлов из D1

import { escapeHtml } from "./_lib/html.js";
import { listTitles } from "./_lib/titles.js";

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const titles = env.DB ? await listTitles(env, "id") : [];

  const urls = [
    { loc: `${origin}/`, lastmod: titles.map((t) => t.updatedAt).sort().at(-1) },
    // Разделы платформы, открытые без входа. Pulse и профиль — личные, их в карте нет
    ...["catalog", "nexus", "oracle", "community", "arena"].map((path) => ({ loc: `${origin}/${path}` })),
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
