// Юнит-тесты отправки писем: `npm test`. Настоящие письма не уходят: fetch подменяется

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mailConfigured, parseFrom, sendMail } from "../functions/_lib/mail.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Подменить fetch: запоминает запрос и отвечает status с телом body */
function mockFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, json: JSON.parse(options.body) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

const LETTER = { to: "user@example.com", subject: "Тема", text: "Текст", html: "<p>Текст</p>" };
const site = new Request("https://endemion.online/api/auth/forgot");

test("адрес отправителя с именем и без", () => {
  assert.deepEqual(parseFrom("Endemion <noreply@endemion.online>"), { name: "Endemion", email: "noreply@endemion.online" });
  assert.deepEqual(parseFrom('"Endemion, сайт" <noreply@endemion.online>'), { name: "Endemion, сайт", email: "noreply@endemion.online" });
  assert.deepEqual(parseFrom("noreply@endemion.online"), { name: "", email: "noreply@endemion.online" });
});

test("письма включены, только если есть ключ и отправитель", () => {
  assert.equal(mailConfigured({ MAIL_FROM: "noreply@endemion.online" }, site), false);
  assert.equal(mailConfigured({ UNISENDER_API_KEY: "key" }, site), false);
  assert.equal(mailConfigured({ UNISENDER_API_KEY: "key", MAIL_FROM: "noreply@endemion.online" }, site), true);
  assert.equal(mailConfigured({ RESEND_API_KEY: "key", MAIL_FROM: "noreply@endemion.online" }, site), true);
  // Режим разработки на сайте не включается, даже если флаг задан
  assert.equal(mailConfigured({ MAIL_DEV_MODE: "1" }, site), false);
  assert.equal(mailConfigured({ MAIL_DEV_MODE: "1" }, new Request("http://127.0.0.1:8788/api/auth/forgot")), true);
});

test("Unisender Go: запрос к API", async () => {
  const calls = mockFetch(200, { status: "success", job_id: "1", emails: ["user@example.com"] });
  await sendMail({ UNISENDER_API_KEY: "secret-key", MAIL_FROM: "Endemion <noreply@endemion.online>", RESEND_API_KEY: "other" }, LETTER);

  assert.equal(calls.length, 1);
  const [{ url, options, json }] = calls;
  assert.equal(url, "https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["X-API-KEY"], "secret-key");
  const { message } = json;
  assert.deepEqual(message.recipients, [{ email: "user@example.com" }]);
  assert.equal(message.from_email, "noreply@endemion.online");
  assert.equal(message.from_name, "Endemion");
  assert.equal(message.subject, "Тема");
  assert.deepEqual(message.body, { html: "<p>Текст</p>", plaintext: "Текст" });
  // Ссылка в письме не подменяется адресом счётчика переходов
  assert.equal(message.track_links, 0);
  assert.equal(message.track_read, 0);
  assert.equal("skip_unsubscribe" in message, false);
});

test("Unisender Go: свой дата-центр и письма без ссылки отписки", async () => {
  const calls = mockFetch(200, { status: "success" });
  await sendMail({
    UNISENDER_API_KEY: "key",
    MAIL_FROM: "noreply@endemion.online",
    UNISENDER_API_URL: "https://go2.unisender.ru/ru/transactional/api/v1/",
    MAIL_SKIP_UNSUBSCRIBE: "1"
  }, LETTER);
  assert.equal(calls[0].url, "https://go2.unisender.ru/ru/transactional/api/v1/email/send.json");
  assert.equal(calls[0].json.message.skip_unsubscribe, 1);
  assert.equal("from_name" in calls[0].json.message, false);
});

test("Unisender Go: ошибка API — исключение с кодом, без ключа", async () => {
  mockFetch(400, { status: "error", code: 204, message: "All recipients are unavailable" });
  await assert.rejects(
    sendMail({ UNISENDER_API_KEY: "secret-key", MAIL_FROM: "noreply@endemion.online" }, LETTER),
    (/** @type {any} */ err) => err.message.includes("400") && err.message.includes("204") && !err.message.includes("secret-key")
  );
  // Ответ 200 без status: success тоже считается ошибкой
  mockFetch(200, { status: "error", code: 150, message: "internal" });
  await assert.rejects(sendMail({ UNISENDER_API_KEY: "key", MAIL_FROM: "noreply@endemion.online" }, LETTER), /150/);
});

test("без ключа Unisender Go письмо уходит через Resend", async () => {
  const calls = mockFetch(200, { id: "1" });
  await sendMail({ RESEND_API_KEY: "re_key", MAIL_FROM: "Endemion <noreply@endemion.online>" }, LETTER);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].options.headers.Authorization, "Bearer re_key");
});
