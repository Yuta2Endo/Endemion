// После браузерных тестов: удалить тестового пользователя

import { apiClient } from "./helpers.mjs";

export default async function globalTeardown() {
  if (!process.env.E2E_STATE) return;
  const { cookie, password } = JSON.parse(process.env.E2E_STATE);
  await apiClient(cookie).call("DELETE", "/api/me", { password }).catch(() => {});
}
