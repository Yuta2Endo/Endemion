// Перед браузерными тестами: тестовый администратор. Игры и категории форума уже есть после миграции 0020

import { apiClient, BASE, grantAdmin } from "./helpers.mjs";

export default async function globalSetup() {
  if (!/^http:\/\/127\.0\.0\.1/.test(BASE)) throw new Error("Браузерные тесты запускаются только на локальном сервере.");

  const client = apiClient();
  const email = `e2e-${Date.now()}@example.com`;
  const password = "correct-horse-1";
  await client.call("POST", "/api/auth/register", { name: "E2E", email, password, consent: true });
  grantAdmin(email);

  process.env.E2E_STATE = JSON.stringify({ cookie: client.cookie, password });
}
