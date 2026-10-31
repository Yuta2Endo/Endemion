// Проверка админки на запущенном локальном сервере: `npm run dev`, затем `npm run test:admin`.
// Права администратора тест выдаёт себе командой wrangler в локальной базе, поэтому против сайта он не запускается.
// Создаёт пользователя и тайтл со своими тестовыми картинками, в конце всё удаляет

import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("Тест админки запускается только на локальном сервере.");
  process.exit(1);
}

let cookie = "";
let failures = 0;

function check(name, condition, details = "") {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name} ${details}`);
  }
}

async function call(method, path, body, { raw = false, type } = {}) {
  const headers = { Origin: new URL(BASE).origin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = type || "application/json";
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  try {
    data = await response.json();
  } catch {}
  return { status: response.status, data };
}

// Свои картинки 1×1: PNG и JPEG отличаются цветом, по размеру файла видно, какая версия отдаётся
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const PNG_2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

const email = `admin-${Date.now()}@example.com`;
const password = "correct-horse-1";

console.log(`Админка ${BASE}`);

let r = await call("POST", "/api/auth/register", { name: "Админ", email, password, consent: true });
check("регистрация", r.status === 201, JSON.stringify(r.data));

r = await call("GET", "/api/admin/titles");
check("без прав админки нет", r.status === 403);
r = await call("GET", "/api/me");
check("isAdmin: false", r.data?.user?.isAdmin === false);

// Почта сгенерирована тестом выше, в ней только буквы, цифры, дефис, @ и точки.
// wrangler запускается через node без оболочки: так SQL-команда передаётся одним аргументом на любой системе
execFileSync(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "endemion", "--local",
  "--command", `UPDATE users SET is_admin = 1 WHERE email = '${email}'`
], { stdio: "ignore" });

r = await call("GET", "/api/me");
check("права выданы", r.data?.user?.isAdmin === true);

const TITLE = {
  title: "Проверка админки <&>",
  type: "manhwa",
  status: "ongoing",
  year: 2026,
  rating: 7.25,
  genres: ["Экшен", " Экшен ", "Фэнтези"],
  author: "Endemion",
  translator: "Endemion",
  symbol: "✦",
  colors: ["#10233F", "#2f6fb5", "#8be0ff"],
  description: "Тестовый тайтл."
};

r = await call("POST", "/api/admin/titles", { ...TITLE, colors: ["red", "#000000", "#ffffff"] });
check("цвета обложки только #rrggbb", r.status === 400);
r = await call("POST", "/api/admin/titles", { ...TITLE, type: "comic" });
check("неизвестный тип отклонён", r.status === 400);

r = await call("POST", "/api/admin/titles", TITLE);
check("тайтл создан", r.status === 201, JSON.stringify(r.data));
const title = r.data?.title;
const id = title?.id;
check("жанры без повторов, рейтинг округлён", title?.genres.join(",") === "Экшен,Фэнтези" && title?.rating === 7.3);
check("обложка собрана из цветов", title?.poster === "linear-gradient(145deg, #10233f, #2f6fb5 55%, #8be0ff)");

r = await call("PUT", `/api/admin/titles/${id}`, { ...TITLE, status: "completed" });
check("тайтл изменён", r.status === 200 && r.data.title.status === "completed");

r = await call("POST", `/api/admin/titles/${id}/chapters`, { name: "Начало", volume: 1, sideStory: false, releasedAt: "2026-02-31" });
check("несуществующая дата отклонена", r.status === 400);
r = await call("POST", `/api/admin/titles/${id}/chapters`, { name: "Начало", volume: 1, sideStory: false, releasedAt: "2026-10-01" });
check("глава 1 добавлена", r.status === 201 && r.data.chapter.number === 1 && r.data.chapter.releasedAt === "2026-10-01 12:00:00");
r = await call("POST", `/api/admin/titles/${id}/chapters`, { sideStory: true });
check("глава 2 добавлена следующей", r.status === 201 && r.data.chapter.number === 2 && r.data.chapter.sideStory);

r = await call("PUT", `/api/admin/titles/${id}/chapters/1`, { name: "Новое начало", volume: 2, sideStory: false });
check("глава изменена, дата прежняя", r.status === 200 && r.data.chapter.name === "Новое начало" && r.data.chapter.releasedAt === "2026-10-01 12:00:00");

r = await call("DELETE", `/api/admin/titles/${id}/chapters/1`);
check("главу из середины удалить нельзя", r.status === 409);

// ---------- страницы ----------
const pages = `/api/admin/titles/${id}/chapters/1`;
r = await call("PUT", `${pages}/pages/1`, Buffer.from("<script>alert(1)</script>"), { raw: true, type: "image/png" });
check("не картинка отклонена по содержимому", r.status === 415);

r = await call("PUT", `${pages}/pages/1`, PNG, { raw: true, type: "image/png" });
check("страница 1 загружена в черновик", r.status === 200 && r.data.version === 1);
let page = await fetch(`${BASE}/pages/${id}/1/1`);
check("черновик читателям не виден", (page.headers.get("content-type") || "").startsWith("image/svg+xml"));

r = await call("POST", `${pages}/publish`, { version: 1, pages: 2, width: 800, height: 1200 });
check("без всех страниц публикации нет", r.status === 409 && r.data.error.includes("Страница 2"));
r = await call("PUT", `${pages}/pages/2`, PNG, { raw: true, type: "image/png" });
r = await call("POST", `${pages}/publish`, { version: 5, pages: 2 });
check("чужая версия отклонена", r.status === 409);
r = await call("POST", `${pages}/publish`, { version: 1, pages: 2, width: 800, height: 1200 });
check("страницы опубликованы", r.status === 200 && r.data.chapter.pages === 2 && r.data.chapter.pagesVersion === 1);

page = await fetch(`${BASE}/pages/${id}/1/2`);
let bytes = Buffer.from(await page.arrayBuffer());
check("страница из R2", page.status === 200 && page.headers.get("content-type") === "image/png" && bytes.equals(PNG));
let html = await (await fetch(`${BASE}/read/${id}/1`)).text();
check("читалка: адрес с версией и размер", html.includes(`/pages/${id}/1/1?v=1`) && html.includes('width="800" height="1200"'));

// Замена: одна страница вместо двух, старая версия и лишняя страница пропадают
r = await call("PUT", `${pages}/pages/1`, PNG_2, { raw: true, type: "image/png" });
check("замена грузится в версию 2", r.status === 200 && r.data.version === 2);
page = await fetch(`${BASE}/pages/${id}/1/1`);
bytes = Buffer.from(await page.arrayBuffer());
check("до публикации видна старая версия", bytes.equals(PNG));
r = await call("POST", `${pages}/publish`, { version: 2, pages: 1 });
check("замена опубликована", r.status === 200 && r.data.chapter.pages === 1 && r.data.chapter.pageWidth === null);
page = await fetch(`${BASE}/pages/${id}/1/1`);
bytes = Buffer.from(await page.arrayBuffer());
check("после публикации новая страница", bytes.equals(PNG_2));
page = await fetch(`${BASE}/pages/${id}/1/2`);
check("лишней страницы больше нет", page.status === 404);

r = await call("DELETE", `${pages}/pages`);
check("страницы убраны", r.status === 200 && r.data.chapter.pages === null);
page = await fetch(`${BASE}/pages/${id}/1/1`);
check("глава снова с демо-страницами", (page.headers.get("content-type") || "").startsWith("image/svg+xml"));

// ---------- удаление ----------
r = await call("PUT", `/api/library/${id}`, { chapter: 2 });
check("читатель отметил главу 2", r.status === 200 && r.data.item.chapter === 2);
r = await call("DELETE", `/api/admin/titles/${id}/chapters/2`);
check("последняя глава удалена", r.status === 200);
r = await call("GET", "/api/library");
check("прогресс читателя уменьшен", r.data.items.find((item) => item.titleId === id)?.chapter === 1);

r = await call("DELETE", `/api/admin/titles/${id}`);
check("тайтл удалён", r.status === 200);
r = await call("GET", `/api/titles/${id}`);
check("тайтла больше нет", r.status === 404);

r = await call("DELETE", "/api/me", { password });
check("тестовый пользователь удалён", r.status === 200);
r = await call("GET", "/api/admin/titles");
check("после удаления доступа нет", r.status === 401);

console.log(failures ? `\n${failures} проверок не прошло` : "\nВсе проверки прошли");
process.exit(failures ? 1 : 0);
