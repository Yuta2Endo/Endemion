// Перед браузерными тестами: отдельный тестовый администратор на каждый браузерный проект.
// Игры и категории форума уже есть после миграции 0020. Счётчики лимитов очищаются от прошлых запусков.

import { apiClient, BASE, clearRateLimits, grantAdmin, PROJECT_IPS, uniqueSuffix } from "./helpers.mjs";

export default async function globalSetup() {
  if (!/^http:\/\/127\.0\.0\.1/.test(BASE)) throw new Error("Браузерные тесты запускаются только на локальном сервере.");

  // Локальная база живёт между запусками: без сброса старые попытки входа дают 429
  clearRateLimits();

  const suffix = uniqueSuffix();
  const password = "correct-horse-1";
  const admins = {};

  for (const [projectName, ip] of Object.entries(PROJECT_IPS)) {
    const client = apiClient("", ip);
    const email = `e2e-${projectName}-${suffix}@example.com`;
    await client.call("POST", "/api/auth/register", { name: "E2E", email, password, consent: true });
    grantAdmin(email);
    admins[projectName] = { cookie: client.cookie, email };
  }

  process.env.E2E_STATE = JSON.stringify({ password, admins });
}
