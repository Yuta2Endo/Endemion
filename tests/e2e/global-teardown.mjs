// После браузерных тестов: удалить тестовые тайтлы и тестового пользователя

import { apiClient } from "./helpers.mjs";

export default async function globalTeardown() {
  if (!process.env.E2E_STATE) return;
  const { cookie, password, manga, manhwa } = JSON.parse(process.env.E2E_STATE);
  const client = apiClient(cookie);
  for (const id of [manga, manhwa]) await client.call("DELETE", `/api/admin/titles/${id}`).catch(() => {});
  await client.call("DELETE", "/api/me", { password }).catch(() => {});
}
