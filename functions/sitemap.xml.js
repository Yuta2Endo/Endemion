// GET /sitemap.xml — главная, политика и страницы всех тайтлов из D1

import { escapeHtml } from "./_lib/html.js";
import { listTitles } from "./_lib/titles.js";

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const titles = env.DB ? await listTitles(env, "id") : [];

  const urls = [
    { loc: `${origin}/`, lastmod: titles.map((t) => t.updatedAt).sort().at(-1) },
    { loc: `${origin}/privacy` },
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
