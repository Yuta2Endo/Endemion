// Письма: Unisender Go или Resend, как на сайте Endemion (functions/_lib/mail.js).
// outbox — письма в JSON-файлы (разработка), memory — в массив (тесты), none — не отправлять

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function parseFrom(value) {
  const match = String(value).match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"(.*)"$/, "$1"), email: match[2] };
  return { name: "", email: String(value).trim() };
}

export function createMailer(mail) {
  const sent = [];

  async function sendUnisender({ to, subject, text, html }) {
    const from = parseFrom(mail.from);
    const message = {
      recipients: [{ email: to }],
      subject,
      from_email: from.email,
      ...(from.name ? { from_name: from.name } : {}),
      body: { html, plaintext: text },
      global_language: "ru",
      // Ссылки из писем остаются как есть: без счётчика переходов и отслеживания открытий
      track_links: 0,
      track_read: 0,
      ...(mail.skipUnsubscribe ? { skip_unsubscribe: 1 } : {})
    };
    const response = await fetch(`${mail.unisenderUrl.replace(/\/+$/, "")}/email/send.json`, {
      method: "POST",
      headers: { "X-API-KEY": mail.unisenderKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15_000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== "success") throw new Error(`Unisender Go ответил ${response.status}`);
  }

  async function sendResend({ to, subject, text, html }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mail.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Resend ответил ${response.status}`);
  }

  return {
    sent,
    /** Можно ли отправлять письма. Без этого восстановление пароля и подтверждение почты недоступны */
    enabled: mail.driver !== "none",
    async send(letter) {
      switch (mail.driver) {
        case "unisender":
          return sendUnisender(letter);
        case "resend":
          return sendResend(letter);
        case "outbox":
          mkdirSync(mail.outboxDir, { recursive: true });
          writeFileSync(path.join(mail.outboxDir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(letter, null, 2));
          return;
        case "memory":
          sent.push(letter);
          return;
        default:
          throw new Error("Отправка писем выключена (MAIL_DRIVER=none)");
      }
    }
  };
}
