// GET /robots.txt — адрес карты сайта должен быть полным, поэтому файл собирается из домена запроса

export function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /auth",
    "Disallow: /profile",
    "Disallow: /admin",
    "Disallow: /reset",
    "Disallow: /mylist",
    "Disallow: /search",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    ""
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }
  });
}
