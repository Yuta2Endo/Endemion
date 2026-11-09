// После браузерных тестов: удалить тестовых администраторов и сбросить счётчики лимитов

import { apiClient, clearRateLimits, clientIpFor } from "./helpers.mjs";

export default async function globalTeardown() {
  if (!process.env.E2E_STATE) return;
  const { admins, password } = JSON.parse(process.env.E2E_STATE);
  for (const [projectName, admin] of Object.entries(admins)) {
    await apiClient(admin.cookie, clientIpFor(projectName)).call("DELETE", "/api/me", { password }).catch(() => {});
  }
  clearRateLimits();
}
