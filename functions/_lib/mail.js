// Отправка писем через Resend (https://resend.com): HTTP API, из Worker работает без библиотек.
// Нужны секрет RESEND_API_KEY и адрес отправителя MAIL_FROM на домене, подтверждённом в Resend (см. README).
// Локально вместо письма можно получить ссылку в ответе API: MAIL_DEV_MODE=1 в файле .dev.vars

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Режим разработки: ссылка из письма возвращается в ответе API. Только на локальном сервере и только с явным флагом:
 * на сайте такую ссылку получил бы любой, кто знает чужую почту
 */
export function mailDevMode(env, request) {
  return env.MAIL_DEV_MODE === "1" && LOCAL_HOSTS.has(new URL(request.url).hostname);
}

/** Можно ли отправлять письма. Без этого восстановление пароля выключено */
export function mailConfigured(env, request) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM) || mailDevMode(env, request);
}

export async function sendMail(env, { to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html })
  });
  if (!response.ok) throw new Error(`Resend ответил ${response.status}: ${(await response.text()).slice(0, 200)}`);
}
