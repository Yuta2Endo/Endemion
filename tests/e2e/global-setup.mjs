// Перед браузерными тестами: тестовый администратор и два тайтла с демо-страницами (SVG).
// Манга (листание страниц, справа налево) с двумя главами и манхва (лента) с одной главой

import { apiClient, BASE, grantAdmin } from "./helpers.mjs";

const TITLE = {
  status: "ongoing",
  year: 2026,
  rating: 8,
  genres: ["Экшен"],
  author: "Endemion",
  translator: "Endemion",
  symbol: "✦",
  colors: ["#1f2a4d", "#5d4a8a", "#e3b5c9"],
  description: "Тайтл для браузерных тестов."
};

export default async function globalSetup() {
  if (!/^http:\/\/127\.0\.0\.1/.test(BASE)) throw new Error("Браузерные тесты запускаются только на локальном сервере.");

  const client = apiClient();
  const email = `e2e-${Date.now()}@example.com`;
  const password = "correct-horse-1";
  await client.call("POST", "/api/auth/register", { name: "E2E", email, password, consent: true });
  grantAdmin(email);

  const manga = (await client.call("POST", "/api/admin/titles", { ...TITLE, title: "E2E манга", type: "manga" })).title;
  const manhwa = (await client.call("POST", "/api/admin/titles", { ...TITLE, title: "E2E манхва", type: "manhwa" })).title;
  for (const [id, count] of [[manga.id, 2], [manhwa.id, 1]]) {
    for (let i = 0; i < count; i++) await client.call("POST", `/api/admin/titles/${id}/chapters`, { sideStory: false });
  }

  process.env.E2E_STATE = JSON.stringify({ cookie: client.cookie, password, manga: manga.id, manhwa: manhwa.id });
}
