// Ответы API и разбор запросов

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Ответы API личные: не кешировать ни в браузере, ни на CDN
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export function error(message, status = 400, headers = {}) {
  return json({ error: message }, status, headers);
}

/** Тело запроса как JSON. null, если тело не JSON или слишком большое */
export async function readJson(request, maxBytes = 10_000) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** IP клиента: Cloudflare кладёт его в CF-Connecting-IP */
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}
