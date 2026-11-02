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

/**
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {{ raw?: boolean, type?: string }} [options]
 */
async function call(method, path, body, { raw = false, type = undefined } = {}) {
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
// Команды запускаются через node без оболочки: так SQL передаётся одним аргументом на любой системе.
// TEST_TARGET=node — сайт запущен своим сервером (npm start), иначе это wrangler dev
execFileSync(process.execPath, process.env.TEST_TARGET === "node"
  ? ["server/grant-admin.mjs", email]
  : ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "endemion", "--local",
    "--command", `UPDATE users SET role = 'admin' WHERE email = '${email}'`], { stdio: "ignore" });

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
  translator: "Ёжик Endemion",
  symbol: "✦",
  colors: ["#10233F", "#2f6fb5", "#8be0ff"],
  description: "Тестовый тайтл."
};

/** id тайтлов в выдаче каталога по параметрам адреса */
async function search(params) {
  const result = await call("GET", `/api/titles?${new URLSearchParams(params)}`);
  return { status: result.status, ids: result.data?.titles?.map((item) => item.id) || [], data: result.data };
}

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

// ---------- поиск по каталогу ----------
let s = await search({ q: "ПРОВЕРКА" });
check("поиск: кириллица без учёта регистра", s.status === 200 && s.ids.includes(id));
s = await search({ q: "админки фэнтези" });
check("поиск: слова из разных полей", s.ids.includes(id));
s = await search({ q: "ежик" });
check("поиск: «е» находит «ё»", s.ids.includes(id));
s = await search({ q: "%" });
check("поиск: % ищется как символ", s.status === 200 && !s.ids.includes(id));
s = await search({ q: "проверка", type: "manga" });
check("поиск: фильтр по типу", s.status === 200 && !s.ids.includes(id));
s = await search({ genre: "Фэнтези" });
check("поиск: фильтр по жанру", s.ids.includes(id));
s = await search({ genre: "Драма" });
check("поиск: чужой жанр не находит", !s.ids.includes(id));
s = await search({ tab: "ongoing", q: "проверка" });
check("поиск: подборка «Выходят»", s.ids.includes(id));
s = await search({ limit: "1", offset: "0", facets: "1" });
check("поиск: страница и общее число", s.ids.length === 1 && s.data.total >= 1);
check("поиск: число по типам и жанры", s.data.facets?.typeCounts.manhwa >= 1 && s.data.facets.genres.includes("Фэнтези"));
s = await search({ limit: "0" });
check("поиск: limit 0 отклонён", s.status === 400);
s = await search({ tab: "secret" });
check("поиск: неизвестная подборка отклонена", s.status === 400);

r = await call("PUT", `/api/admin/titles/${id}`, { ...TITLE, status: "completed" });
check("тайтл изменён", r.status === 200 && r.data.title.status === "completed");
s = await search({ status: "completed", q: "проверка" });
check("поиск: после правки тайтл в «Завершённых»", s.ids.includes(id));
s = await search({ tab: "completed", q: "проверка" });
check("поиск: полка «Прочитано» не путается со статусом выпуска", s.status === 200 && !s.ids.includes(id));

// ---------- обложка ----------
r = await call("PUT", `/api/admin/titles/${id}/cover`, Buffer.from("<svg onload=alert(1)>"), { raw: true, type: "image/png" });
check("обложка не картинка отклонена", r.status === 415);
r = await call("PUT", `/api/admin/titles/${id}/cover`, PNG, { raw: true, type: "image/png" });
check("обложка загружена", r.status === 200 && r.data.title.cover === `/covers/${id}?v=1`);
let cover = await fetch(`${BASE}/covers/${id}?v=1`);
check("обложка отдаётся из R2", cover.status === 200 && cover.headers.get("content-type") === "image/png" &&
  (cover.headers.get("cache-control") || "").includes("immutable"));
r = await call("PUT", `/api/admin/titles/${id}/cover`, PNG_2, { raw: true, type: "image/png" });
check("обложка заменена", r.status === 200 && r.data.title.cover === `/covers/${id}?v=2`);
cover = await fetch(`${BASE}/covers/${id}?v=2`);
check("отдаётся новая обложка", Buffer.from(await cover.arrayBuffer()).equals(PNG_2));

let titleHtml = await (await fetch(`${BASE}/title/${id}`)).text();
check("превью ссылки с обложкой", titleHtml.includes(`<meta property="og:image" content="${BASE}/covers/${id}?v=2">`));
check("schema.org без закрывающих тегов из базы", titleHtml.includes('"@type":"ComicSeries"') && titleHtml.includes("\\u003c&>") &&
  !/"name":"[^"]*<&>/.test(titleHtml));

r = await call("DELETE", `/api/admin/titles/${id}/cover`);
check("обложка убрана", r.status === 200 && r.data.title.cover === null);
cover = await fetch(`${BASE}/covers/${id}?v=2`);
check("убранная обложка не отдаётся", cover.status === 404);
titleHtml = await (await fetch(`${BASE}/title/${id}`)).text();
check("без обложки — общая картинка сайта", titleHtml.includes("/assets/og-image.png"));

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
check("вторая страница загружена", r.status === 200);
r = await call("POST", `${pages}/publish`, { version: 5, pages: 2 });
check("чужая версия отклонена", r.status === 409);
r = await call("POST", `${pages}/publish`, { version: 1, pages: 2, width: 800, height: 1200 });
check("страницы опубликованы", r.status === 200 && r.data.chapter.pages === 2 && r.data.chapter.pagesVersion === 1);

page = await fetch(`${BASE}/pages/${id}/1/2`);
let bytes = Buffer.from(await page.arrayBuffer());
check("страница из R2", page.status === 200 && page.headers.get("content-type") === "image/png" && bytes.equals(PNG));
const html = await (await fetch(`${BASE}/read/${id}/1`)).text();
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

// ---------- жалобы правообладателей ----------
const COMPLAINT = {
  name: "Тест <b>Заявитель</b>",
  email: `rights-${Date.now()}@example.com`,
  rightholder: "Тестовый правообладатель",
  work: "Тестовое произведение",
  links: `${BASE}/title/1\n${BASE}/read/1/2  ${BASE}/title/1`,
  description: "Произведение опубликовано без разрешения правообладателя.",
  statement: true
};
r = await call("POST", "/api/complaints", { ...COMPLAINT, links: "https://evil.example/page" });
check("жалоба: ссылка на чужой сайт отклонена", r.status === 400);
r = await call("POST", "/api/complaints", { ...COMPLAINT, links: "javascript:alert(1)" });
check("жалоба: javascript-ссылка отклонена", r.status === 400);
r = await call("POST", "/api/complaints", { ...COMPLAINT, statement: false });
check("жалоба: без подтверждения не принимается", r.status === 400);
r = await call("POST", "/api/complaints", { ...COMPLAINT, description: "коротко" });
check("жалоба: короткое описание отклонено", r.status === 400);
r = await call("POST", "/api/complaints", COMPLAINT);
check("жалоба принята", r.status === 201 && Number.isInteger(r.data.id));
const complaintId = r.data?.id;

r = await call("GET", "/api/admin/complaints");
const stored = r.data?.complaints?.find((item) => item.id === complaintId);
check("жалоба видна в админке", r.status === 200 && stored?.status === "new");
check("ссылки жалобы без повторов", stored?.links.length === 2 && stored.links[0] === `${BASE}/title/1`);
r = await call("PUT", `/api/admin/complaints/${complaintId}`, { status: "deleted" });
check("неизвестный статус жалобы отклонён", r.status === 400);
r = await call("PUT", `/api/admin/complaints/${complaintId}`, { status: "resolved" });
check("жалоба разобрана", r.status === 200 && r.data.complaint.status === "resolved");
r = await call("DELETE", `/api/admin/complaints/${complaintId}`);
check("жалоба удалена", r.status === 200);
r = await call("DELETE", `/api/admin/complaints/${complaintId}`);
check("удалённой жалобы нет", r.status === 404);

// ---------- сводка ----------
r = await call("GET", "/api/admin/stats");
check("сводка", r.status === 200 && r.data.users.total >= 1 && r.data.users.admins >= 1 && typeof r.data.content.titles === "number");

// ---------- журнал действий ----------
r = await call("GET", "/api/admin/audit?group=titles&limit=100");
const titleActions = (r.data?.entries || []).filter((entry) => entry.target.includes(`(#${id})`)).map((entry) => entry.action);
check("журнал: создание, правка и удаление тайтла", r.status === 200 &&
  ["title.create", "title.update", "title.delete", "cover.upload"].every((action) => titleActions.includes(action)));
r = await call("GET", "/api/admin/audit?group=chapters&limit=100");
const chapterActions = (r.data?.entries || []).filter((entry) => entry.target.includes(`(#${id})`)).map((entry) => entry.action);
check("журнал: главы и страницы", ["chapter.create", "chapter.delete", "pages.publish", "pages.delete"].every((a) => chapterActions.includes(a)));
r = await call("GET", "/api/admin/audit?group=secret");
check("журнал: неизвестная группа отклонена", r.status === 400);

// ---------- пользователи ----------
// Второй пользователь со своей cookie: на нём проверяются блокировка, сеансы и права
async function callAs(jar, method, path, body) {
  const headers = { Origin: new URL(BASE).origin };
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) jar.cookie = setCookie.split(";")[0];
  return { status: response.status, data: await response.json().catch(() => null) };
}

const other = { cookie: "" };
const otherEmail = `member-${Date.now()}@example.com`;
const otherPassword = "member-password-1";
r = await callAs(other, "POST", "/api/auth/register", { name: "Участник", email: otherEmail, password: otherPassword, consent: true });
check("второй пользователь", r.status === 201);

r = await call("GET", "/api/me");
const myId = r.data?.user?.id;
r = await call("GET", `/api/admin/users?q=${encodeURIComponent(otherEmail.toUpperCase())}`);
const member = r.data?.users?.[0];
check("пользователи: поиск по почте без учёта регистра", r.status === 200 && r.data.total === 1 && member?.email === otherEmail);
check("пользователи: число сеансов", member?.sessions === 1 && member.isAdmin === false && member.blockedAt === null);
r = await call("GET", "/api/admin/users?filter=admins&limit=100");
check("пользователи: фильтр администраторов", r.status === 200 && r.data.users.some((user) => user.id === myId) &&
  !r.data.users.some((user) => user.id === member?.id));
r = await call("GET", "/api/admin/users?filter=secret");
check("пользователи: неизвестный фильтр отклонён", r.status === 400);

const userUrl = `/api/admin/users/${member?.id}`;
r = await call("PUT", `/api/admin/users/${myId}`, { action: "block" });
check("свой аккаунт из админки не меняется", r.status === 409);
r = await call("PUT", userUrl, { action: "explode" });
check("неизвестное действие отклонено", r.status === 400);

r = await call("PUT", userUrl, { action: "block" });
check("блокировка", r.status === 200 && Boolean(r.data.user.blockedAt) && r.data.user.sessions === 0);
r = await callAs(other, "GET", "/api/me");
check("заблокированный выходит сразу", r.data?.user === null);
r = await callAs(other, "POST", "/api/auth/login", { email: otherEmail, password: otherPassword });
check("заблокированный не входит", r.status === 403);
r = await callAs(other, "POST", "/api/auth/login", { email: otherEmail, password: "wrong-password-1" });
check("неверный пароль заблокированного — как у всех", r.status === 401);
r = await call("PUT", userUrl, { action: "block" });
check("повторная блокировка", r.status === 409);
r = await call("PUT", userUrl, { action: "grantAdmin", password });
check("заблокированному права не выдаются", r.status === 409);
r = await call("PUT", userUrl, { action: "unblock" });
check("разблокировка", r.status === 200 && r.data.user.blockedAt === null);
r = await callAs(other, "POST", "/api/auth/login", { email: otherEmail, password: otherPassword });
check("после разблокировки вход", r.status === 200);

r = await call("PUT", userUrl, { action: "logout" });
check("завершение сеансов", r.status === 200 && r.data.user.sessions === 0);
r = await callAs(other, "GET", "/api/me");
check("после завершения сеансов вход нужен заново", r.data?.user === null);

r = await call("PUT", userUrl, { action: "grantAdmin" });
check("права без пароля не выдаются", r.status === 403);
r = await call("PUT", userUrl, { action: "grantAdmin", password: "wrong-password-1" });
check("права с неверным паролем не выдаются", r.status === 403);
r = await call("PUT", userUrl, { action: "grantAdmin", password });
check("права выданы через админку", r.status === 200 && r.data.user.isAdmin === true);
r = await call("PUT", userUrl, { action: "block" });
check("администратора нельзя заблокировать", r.status === 409);
r = await call("DELETE", userUrl, { password });
check("администратора нельзя удалить", r.status === 409);
r = await call("PUT", userUrl, { action: "revokeAdmin", password });
check("права сняты", r.status === 200 && r.data.user.isAdmin === false);

r = await call("DELETE", userUrl, { password: "wrong-password-1" });
check("удаление с неверным паролем отклонено", r.status === 403);
r = await call("DELETE", userUrl, { password });
check("аккаунт удалён из админки", r.status === 200);
r = await call("GET", `/api/admin/users?q=${encodeURIComponent(otherEmail)}`);
check("удалённого пользователя нет", r.data?.total === 0);
r = await callAs(other, "POST", "/api/auth/login", { email: otherEmail, password: otherPassword });
check("удалённый не входит", r.status === 401);

r = await call("GET", "/api/admin/audit?group=users&limit=100");
const memberLabel = `пользователь #${member?.id}`;
const userActions = (r.data?.entries || []).filter((entry) => entry.target === memberLabel).map((entry) => entry.action);
check("журнал: действия с пользователем", ["user.block", "user.unblock", "user.logout", "user.grantAdmin", "user.revokeAdmin", "user.delete"]
  .every((action) => userActions.includes(action)));
check("журнал: без почты пользователя", !(r.data?.entries || []).some((entry) => entry.target.includes(otherEmail)));

r = await call("DELETE", "/api/me", { password });
check("тестовый пользователь удалён", r.status === 200);
r = await call("GET", "/api/admin/complaints");
check("жалобы без входа не видны", r.status === 401);
r = await call("GET", "/api/admin/titles");
check("после удаления доступа нет", r.status === 401);

console.log(failures ? `\n${failures} проверок не прошло` : "\nВсе проверки прошли");
process.exit(failures ? 1 : 0);
