// HTML-страницы из Functions. Файл _headers на ответы Functions не действует, поэтому заголовки ставятся здесь

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  // Тот же CSP, что в public/_headers
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; " +
    "style-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; " +
    "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders }
  });
}

/** Страница public/404.html с кодом 404 */
export async function notFound(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404", request.url));
  return html(await page.text(), 404);
}
