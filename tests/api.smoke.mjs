// Проверка API на запущенном локальном сервере: `npm run dev`, затем `node tests/api.smoke.mjs`.
// Для сайта: BASE_URL=https://endemion.sasha-guseynov2005tm.workers.dev node tests/api.smoke.mjs
// Создаёт тестового пользователя со случайной почтой и в конце удаляет его

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const ORIGIN = new URL(BASE).origin;

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

async function call(method, path, body, { origin = ORIGIN, withCookie = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin) headers["Origin"] = origin;
  if (withCookie && cookie) headers["Cookie"] = cookie;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  try {
    data = await response.json();
  } catch {}
  return { status: response.status, data, headers: response.headers };
}

const email = `test-${Date.now()}@example.com`;
const password = "correct-horse-1";

console.log(`API ${BASE}`);

let r = await call("GET", "/api/titles");
check("каталог из D1", r.status === 200 && Array.isArray(r.data.titles), JSON.stringify(r.data));
// Тайтл, читалка и библиотека проверяются на первом тайтле каталога; при пустом каталоге эти проверки пропускаются
const first = r.data.titles?.[0];

r = await call("GET", "/api/me");
check("гость получает user: null", r.status === 200 && r.data.user === null);

r = await call("POST", "/api/auth/register", { name: "Тест", email, password, consent: true }, { origin: "https://evil.example" });
check("чужой Origin отклонён", r.status === 403);

r = await call("POST", "/api/auth/register", { name: "Тест", email, password: "short", consent: true });
check("короткий пароль отклонён", r.status === 400);

r = await call("POST", "/api/auth/register", { name: "Тест", email, password, consent: false });
check("без согласия регистрации нет", r.status === 400);

r = await call("POST", "/api/auth/register", { name: "Тест", email, password, consent: true });
check("регистрация", r.status === 201 && r.data.user.email === email, JSON.stringify(r.data));
check("cookie сессии HttpOnly", (r.headers.get("set-cookie") || "").includes("HttpOnly"));

r = await call("POST", "/api/auth/register", { name: "Тест", email, password, consent: true });
check("повторная регистрация той же почты", r.status === 409);

r = await call("GET", "/api/me");
check("сессия работает", r.status === 200 && r.data.user && r.data.user.email === email);

r = await call("PUT", "/api/library/999", { favorite: true });
check("несуществующий тайтл", r.status === 404);

r = await call("GET", "/api/positions/1", undefined, { withCookie: false });
check("место в главе только для вошедших", r.status === 401);

if (first) {
  const { id, chapters } = first;
  r = await call("GET", `/api/titles/${id}`);
  check("один тайтл", r.status === 200 && r.data.title?.id === id);

  let page = await fetch(`${BASE}/read/${id}/1`);
  let text = await page.text();
  check("читалка открывается", page.status === 200 && text.includes('id="reader"') && text.includes(`/pages/${id}/1/1`));
  page = await fetch(`${BASE}/read/${id}/${chapters + 1}`);
  check("читалка: несуществующая глава", page.status === 404);
  page = await fetch(`${BASE}/pages/${id}/1/1`);
  text = await page.text();
  check("страница главы — SVG", page.status === 200 && (page.headers.get("content-type") || "").startsWith("image/svg+xml") && text.startsWith("<svg"));
  page = await fetch(`${BASE}/pages/${id}/1/99`);
  check("страница за пределами главы", page.status === 404);

  r = await call("PUT", `/api/library/${id}`, { favorite: true });
  check("добавить в избранное", r.status === 200 && r.data.item.favorite === true);

  r = await call("PUT", `/api/library/${id}`, { chapter: 3 });
  check("прогресс ставит статус «читаю»", r.status === 200 && r.data.item.status === "reading" && r.data.item.chapter === 3);

  r = await call("PUT", `/api/library/${id}`, { chapter: chapters + 1 });
  check("глава больше вышедших отклонена", r.status === 400);

  // Дочитал завершённый тайтл до конца — статус «прочитано»
  if (first.status === "completed") {
    r = await call("PUT", `/api/library/${id}`, { chapter: chapters });
    check("последняя глава завершённого тайтла — «прочитано»", r.status === 200 && r.data.item.status === "completed");
    r = await call("PUT", `/api/library/${id}`, { chapter: 3, status: "reading" });
    check("можно вернуть статус «читаю»", r.status === 200 && r.data.item.status === "reading");
  }

  r = await call("GET", "/api/library");
  check("библиотека", r.status === 200 && r.data.items.length === 1 && r.data.items[0].chapter === 3);

  r = await call("PUT", `/api/positions/${id}`, { chapter: 1, page: 2 });
  check("место в главе сохранено", r.status === 200);
  r = await call("PUT", `/api/positions/${id}`, { chapter: 1, page: 999 });
  check("страница за пределами главы отклонена", r.status === 400);
  r = await call("PUT", `/api/positions/${id}`, { chapter: chapters + 1, page: 1 });
  check("несуществующая глава отклонена", r.status === 400);
  r = await call("GET", `/api/positions/${id}`);
  check("место в главе читается", r.data?.position?.chapter === 1 && r.data.position.page === 2);
  r = await call("DELETE", `/api/positions/${id}`, { chapter: 1 });
  r = await call("GET", `/api/positions/${id}`);
  check("после дочитывания места нет", r.status === 200 && r.data.position === null);
} else {
  console.log("  --  каталог пуст: проверки тайтла, читалки и библиотеки пропущены");
  r = await call("GET", "/api/library");
  check("библиотека пуста", r.status === 200 && r.data.items.length === 0);
}

r = await call("PATCH", "/api/me", { name: "  Новое   имя  " });
check("смена имени", r.status === 200 && r.data.user.name === "Новое имя");

r = await call("POST", "/api/auth/logout", {});
check("выход", r.status === 200);
r = await call("GET", "/api/me");
check("после выхода гость", r.data.user === null);

r = await call("POST", "/api/auth/login", { email, password: "wrong-password" });
check("неверный пароль", r.status === 401);

r = await call("POST", "/api/auth/login", { email: email.toUpperCase(), password });
check("вход (почта без учёта регистра)", r.status === 200 && r.data.user.email === email);

r = await call("POST", "/api/me/password", { currentPassword: password, newPassword: "new-password-2" });
check("смена пароля", r.status === 200);
r = await call("GET", "/api/me");
check("после смены пароля текущая сессия жива", r.data.user && r.data.user.email === email);

// Перебор пароля: после 5 неудач почта блокируется на 15 минут
const other = `brute-${Date.now()}@example.com`;
let last;
for (let i = 0; i < 6; i++) last = await call("POST", "/api/auth/login", { email: other, password: "nope-nope-1" }, { withCookie: false });
check("перебор пароля ограничен", last.status === 429, `status=${last.status}`);

r = await call("DELETE", "/api/me", { password: "wrong" });
check("удаление требует пароль", r.status === 403);
r = await call("DELETE", "/api/me", { password: "new-password-2" });
check("удаление аккаунта", r.status === 200);
r = await call("POST", "/api/auth/login", { email, password: "new-password-2" });
check("удалённый аккаунт не входит", r.status === 401);

console.log(failures ? `\n${failures} проверок не прошло` : "\nВсе проверки прошли");
process.exit(failures ? 1 : 0);
