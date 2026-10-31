// Юнит-тесты без сервера: `npm test`. Web Crypto в Node работает так же, как в Workers

import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, newToken, PBKDF2_ITERATIONS, sha256, verifyPassword } from "../functions/_lib/crypto.js";
import { normalizeEmail, normalizeName, validateEmail, validateName, validatePassword } from "../functions/_lib/validate.js";
import { escapeHtml } from "../functions/_lib/html.js";

test("пароль проверяется только правильным значением", async () => {
  const stored = await hashPassword("correct-horse-1");
  assert.ok(await verifyPassword("correct-horse-1", stored));
  assert.equal(await verifyPassword("correct-horse-2", stored), false);
});

test("у одинаковых паролей разная соль и разный хеш", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`^pbkdf2\\$${PBKDF2_ITERATIONS}\\$`));
});

test("испорченный хеш не принимается", async () => {
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "sha256$abc"), false);
});

test("токен сессии случайный, в базе хранится его SHA-256", async () => {
  const token = newToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(token, newToken());
  assert.equal((await sha256(token)).length, 64);
  assert.notEqual(await sha256(token), token);
});

test("проверка почты, имени и пароля", () => {
  assert.equal(normalizeEmail("  Anna@Example.COM "), "anna@example.com");
  assert.equal(validateEmail("anna@example.com"), null);
  assert.ok(validateEmail("anna@"));
  assert.ok(validateEmail(""));

  assert.equal(normalizeName("  Новое\u0007   имя "), "Новое имя");
  assert.ok(validateName("A"));
  assert.equal(validateName("Аня"), null);

  assert.ok(validatePassword("short"));
  assert.ok(validatePassword("x".repeat(129)));
  assert.equal(validatePassword("long-enough"), null);
});

test("HTML экранируется на странице тайтла", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});
