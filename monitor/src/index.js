// Монитор endemion.online: cron раз в 5 минут проверяет сайт и шлёт алерты в Telegram.
//
// Почему отдельный Worker, а не VPS: с сервера api.telegram.org недоступен (таймаут),
// а у Cloudflare доступ есть. Состояние («сайт лежит / поднялся») живёт в KV, чтобы
// не спамить одним сообщением каждые 5 минут и присылать одно про восстановление.

const TIMEOUT_MS = 10_000;

/** Проверки: имя, адрес и что считаем успехом */
function checks(env) {
  const site = env.SITE_URL || "https://endemion.online";
  const auth = env.AUTH_URL || "https://auth.endemion.online";
  return [
    { name: "главная", url: `${site}/`, expect: (res) => res.status === 200 },
    { name: "игры", url: `${site}/games`, expect: (res) => res.status === 200 },
    { name: "сообщество", url: `${site}/community`, expect: (res) => res.status === 200 },
    { name: "аккаунт", url: `${site}/account`, expect: (res) => res.status === 200 },
    { name: "API входа", url: `${site}/api/me`, expect: (res) => res.status === 200 },
    { name: "sitemap", url: `${site}/sitemap.xml`, expect: (res) => res.status === 200 },
    { name: "healthz", url: `${site}/healthz`, expect: async (res) => res.status === 200 && (await res.text()).trim() === "ok" },
    // Свежесть резервных копий: сервер отвечает 503, если бэкап старше суток с лишним
    { name: "бэкапы", url: `${site}/healthz/backup`, expect: (res) => res.status === 200 },
    { name: "Endemion ID", url: `${auth}/.well-known/openid-configuration`, expect: (res) => res.status === 200 }
  ];
}

async function runChecks(env) {
  const results = await Promise.all(checks(env).map(async ({ name, url, expect }) => {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "endemion-monitor/1" }
      });
      const ok = await expect(res);
      return { name, url, ok, status: res.status };
    } catch (error) {
      return { name, url, ok: false, status: 0, error: String(error?.message || error) };
    }
  }));
  return results;
}

async function send(env, text) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return { ok: false, description: "нет TELEGRAM_BOT_TOKEN" };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(env.TELEGRAM_CHAT_ID || "@EndemionOfficial").trim(),
      text,
      disable_web_page_preview: true
    })
  });
  return response.json();
}

/** Одно сообщение на падение и одно на восстановление, а не по сообщению каждые 5 минут */
async function report(env, results) {
  const failed = results.filter((result) => !result.ok);
  const previous = await env.STATE.get("status", { type: "json" });

  if (failed.length) {
    if (previous?.down) return { alerted: false, reason: "уже сообщили о падении" };
    const lines = failed.map((row) => `• ${row.name}: ${row.status || "нет ответа"}${row.error ? ` (${row.error})` : ""}`);
    await send(env, [
      "🔴 endemion.online не отвечает",
      "",
      ...lines,
      "",
      `Проверено: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`
    ].join("\n"));
    await env.STATE.put("status", JSON.stringify({ down: true, since: new Date().toISOString(), failed: failed.map((row) => row.name) }));
    return { alerted: true, reason: "отправлен алерт о падении" };
  }

  if (previous?.down) {
    await send(env, `🟢 endemion.online снова в строю\n\nПадение было с ${String(previous.since).slice(0, 16).replace("T", " ")} UTC.\nВсе ${results.length} проверок проходят.`);
    await env.STATE.put("status", JSON.stringify({ down: false }));
    return { alerted: true, reason: "отправлено сообщение о восстановлении" };
  }

  await env.STATE.put("status", JSON.stringify({ down: false }));
  return { alerted: false, reason: "всё в порядке" };
}

/** Что разрешено вызывать через /admin: только оформление канала, ничего больше */
const ADMIN_READ = new Set(["getChat", "getChatMemberCount", "getChatAdministrators", "getChatMember", "getChatMenuButton"]);
const ADMIN_WRITE = new Set([
  "setChatDescription", "setChatTitle", "setChatPhoto", "deleteMessage",
  "pinChatMessage", "unpinChatMessage", "sendMessage", "editMessageText",
  "exportChatInviteLink", "createChatInviteLink", "revokeChatInviteLink"
]);

/**
 * Ручное управление каналом из терминала: с этой машины api.telegram.org недоступен,
 * а у Cloudflare доступ есть. Ключ обязателен и сравнивается как секрет.
 */
async function admin(request, env, url) {
  if (!env.MONITOR_KEY || url.searchParams.get("key") !== env.MONITOR_KEY) {
    return Response.json({ ok: false, error: "нужен ключ" }, { status: 401 });
  }
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return Response.json({ ok: false, error: "нет TELEGRAM_BOT_TOKEN" }, { status: 503 });

  let method = url.searchParams.get("method");
  let params = {};
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return Response.json({ ok: false, error: "нужно JSON-тело" }, { status: 400 });
    method = body.method || method;
    params = { ...(body.params || body) };
    delete params.method;
  }
  if (!ADMIN_READ.has(method) && !ADMIN_WRITE.has(method) && method !== "downloadPhoto" && method !== "preview") {
    return Response.json({ ok: false, error: `метод не разрешён: ${method}` }, { status: 400 });
  }
  if (params.chat_id === undefined) params.chat_id = String(env.TELEGRAM_CHAT_ID || "@EndemionOfficial").trim();

  const endpoint = `https://api.telegram.org/bot${token}/${method}`;
  try {
    // Публичная лента канала: только чтение, чтобы видеть, что уже опубликовано
    if (method === "preview") {
      const html = await (await fetch("https://t.me/s/EndemionOfficial", { signal: AbortSignal.timeout(TIMEOUT_MS) })).text();
      if (params.raw) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const posts = [...html.matchAll(/data-post="EndemionOfficial\/(\d+)"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
        .map((match) => ({
          id: Number(match[1]),
          text: match[2]
            .replace(/<br\s*\/?>/g, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .trim()
        }));
      return Response.json({ ok: true, posts });
    }
    // Скачать текущее фото канала: нужно, чтобы посмотреть, как он выглядит
    if (method === "downloadPhoto") {
      let fileId = params.file_id;
      if (!fileId) {
        const chat = await (await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: params.chat_id })
        })).json();
        fileId = chat?.result?.photo?.big_file_id;
        if (!fileId) return Response.json({ ok: false, error: "у канала нет фото" }, { status: 404 });
      }
      const file = await (await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId })
      })).json();
      if (!file.ok) return Response.json(file, { status: 400 });
      const image = await fetch(`https://api.telegram.org/file/bot${token}/${file.result.file_path}`);
      return new Response(image.body, { headers: { "Content-Type": image.headers.get("content-type") || "image/jpeg" } });
    }
    if (method === "setChatPhoto") {
      const photoUrl = params.photo_url;
      delete params.photo_url;
      const image = await fetch(photoUrl);
      if (!image.ok) return Response.json({ ok: false, error: `фото не скачалось: ${image.status}` }, { status: 400 });
      const form = new FormData();
      form.append("chat_id", params.chat_id);
      form.append("photo", new Blob([await image.arrayBuffer()], { type: image.headers.get("content-type") || "image/png" }), "photo.png");
      const response = await fetch(endpoint, { method: "POST", body: form });
      return Response.json(await response.json());
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    return Response.json(await response.json());
  } catch (error) {
    return Response.json({ ok: false, error: String(error?.message || error) }, { status: 502 });
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const results = await runChecks(env);
      await report(env, results);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/admin") return admin(request, env, url);
    if (url.searchParams.get("me") === "1") {
      if (env.MONITOR_KEY && url.searchParams.get("key") !== env.MONITOR_KEY) {
        return Response.json({ ok: false, error: "нужен ключ" }, { status: 401 });
      }
      const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) return Response.json({ ok: false, error: "нет TELEGRAM_BOT_TOKEN" });
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      return Response.json(await response.json());
    }

    if (url.searchParams.get("test") === "1") {
      if (env.MONITOR_KEY && url.searchParams.get("key") !== env.MONITOR_KEY) {
        return Response.json({ ok: false, error: "нужен ключ" }, { status: 401 });
      }
      const result = await send(env, "✅ Монитор endemion.online на связи: сообщения доходят, канал настроен.");
      return Response.json({ sent: result });
    }

    const results = await runChecks(env);
    const outcome = await report(env, results);
    return Response.json({ results, outcome });
  }
};
