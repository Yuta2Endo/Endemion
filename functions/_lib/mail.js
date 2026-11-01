// Отправка писем через Unisender Go (https://go.unisender.ru, российский сервис) или Resend (https://resend.com).
// Нужны ключ UNISENDER_API_KEY (или RESEND_API_KEY) и адрес отправителя MAIL_FROM на домене, подтверждённом в сервисе
// (см. DEPLOY.md). Если заданы оба ключа, письма уходят через Unisender Go.
// Локально вместо письма можно получить ссылку в ответе API: MAIL_DEV_MODE=1 в файле .dev.vars

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
// Общий адрес API Unisender Go. Можно указать адрес своего дата-центра (go1 или go2) в UNISENDER_API_URL
const UNISENDER_URL = "https://goapi.unisender.ru/ru/transactional/api/v1";

/**
 * Режим разработки: ссылка из письма возвращается в ответе API. Только на локальном сервере и только с явным флагом:
 * на сайте такую ссылку получил бы любой, кто знает чужую почту
 */
export function mailDevMode(env, request) {
  return env.MAIL_DEV_MODE === "1" && LOCAL_HOSTS.has(new URL(request.url).hostname);
}

/** Можно ли отправлять письма. Без этого восстановление пароля выключено */
export function mailConfigured(env, request) {
  return Boolean((env.UNISENDER_API_KEY || env.RESEND_API_KEY) && env.MAIL_FROM) || mailDevMode(env, request);
}

/** «Endemion <noreply@example.ru>» → { name: "Endemion", email: "noreply@example.ru" }. Можно указать и просто адрес */
export function parseFrom(value) {
  const match = String(value).match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"(.*)"$/, "$1"), email: match[2] };
  return { name: "", email: String(value).trim() };
}

async function sendUnisender(env, { to, subject, text, html }) {
  const from = parseFrom(env.MAIL_FROM);
  const base = (env.UNISENDER_API_URL || UNISENDER_URL).replace(/\/+$/, "");
  const message = {
    recipients: [{ email: to }],
    subject,
    from_email: from.email,
    ...(from.name ? { from_name: from.name } : {}),
    body: { html, plaintext: text },
    global_language: "ru",
    // Ссылка для нового пароля остаётся в письме как есть: без подмены на адрес счётчика переходов и без отслеживания открытий
    track_links: 0,
    track_read: 0,
    // Без блока «Отписаться»: иначе отписавшийся не получит письмо для нового пароля. Unisender Go включает по запросу в поддержку
    ...(env.MAIL_SKIP_UNSUBSCRIBE === "1" ? { skip_unsubscribe: 1 } : {})
  };
  const response = await fetch(`${base}/email/send.json`, {
    method: "POST",
    headers: { "X-API-KEY": env.UNISENDER_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ message })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "success") {
    throw new Error(`Unisender Go ответил ${response.status}: ${[data?.code, data?.message].filter(Boolean).join(" ") || "без описания"}`);
  }
}

async function sendResend(env, { to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html })
  });
  if (!response.ok) throw new Error(`Resend ответил ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export async function sendMail(env, letter) {
  return env.UNISENDER_API_KEY ? sendUnisender(env, letter) : sendResend(env, letter);
}
