// Проверка API на запущенном локальном сервере: `npm run dev`, затем `node tests/api.smoke.mjs`.
// Для сайта: BASE_URL=https://endemion.online node tests/api.smoke.mjs
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

let r = await call("GET", "/api/me");
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

// Форум: тема в «Общем обсуждении», ответ, гость не пишет, удалённые разделы ведут на главную
r = await call("GET", "/api/threads?category=general");
check("лента форума", r.status === 200 && Array.isArray(r.data.threads), JSON.stringify(r.data));

r = await call("POST", "/api/threads", { kind: "discussion", category: "general", subject: "Проверка API", body: "Тема из смоук-теста." }, { withCookie: false });
check("гость не создаёт тему", r.status === 401);

r = await call("POST", "/api/threads", { kind: "discussion", category: "general", subject: "Проверка API", body: "Тема из смоук-теста." });
check("тема создана", r.status === 201 && r.data.thread?.category?.slug === "general", JSON.stringify(r.data));
const threadId = r.data?.thread?.id;

if (threadId) {
  r = await call("POST", "/api/comments", { targetType: "thread", targetId: threadId, body: "Ответ из смоук-теста." });
  check("ответ в теме", r.status === 201);
  r = await call("GET", `/api/threads/${threadId}`);
  check("счётчик ответов", r.status === 200 && r.data.thread.comments === 1);
  r = await call("DELETE", `/api/threads/${threadId}`);
  check("своя тема удаляется", r.status === 200);
}

r = await call("POST", "/api/comments", { targetType: "title", targetId: 1, body: "Комментарий к тайтлу" });
check("комментарии к тайтлам больше не принимаются", r.status === 400);

const retired = await fetch(`${BASE}/encyclopedia`, { redirect: "manual" });
check("энциклопедия ведёт на главную", retired.status === 301 && retired.headers.get("location") === "/");

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

// Восстановление пароля проверяется только на локальном сервере с MAIL_DEV_MODE=1: ссылка из письма приходит в ответе.
// На сайте тест не запрашивает письма, чтобы не слать их на несуществующие адреса
let finalPassword = "new-password-2";
r = await call("GET", "/api/config");
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
if (isLocal && r.data?.passwordReset) {
  r = await call("POST", "/api/auth/forgot", { email: `nobody-${Date.now()}@example.com` });
  check("неизвестная почта: тот же ответ без ссылки", r.status === 200 && Boolean(r.data.message) && !r.data.devLink);
  r = await call("POST", "/api/auth/forgot", { email: email.toUpperCase() });
  const token = r.data?.devLink ? new URL(r.data.devLink).searchParams.get("token") : null;

  if (!token) {
    console.log("  --  ссылки в ответе нет (письма уходят через почтовый сервис): проверка по ссылке пропущена");
  } else {
    check("ссылка для нового пароля", /^[0-9a-f]{64}$/.test(token));
    r = await call("POST", "/api/auth/reset", { token, password: "short" });
    check("короткий пароль по ссылке отклонён", r.status === 400);
    r = await call("POST", "/api/auth/reset", { token: "0".repeat(64), password: "reset-password-3" });
    check("чужая ссылка не подходит", r.status === 400);

    const oldCookie = cookie;
    r = await call("POST", "/api/auth/reset", { token, password: "reset-password-3" });
    check("новый пароль по ссылке", r.status === 200);
    finalPassword = "reset-password-3";
    const newCookie = cookie;
    cookie = oldCookie;
    r = await call("GET", "/api/me");
    check("после сброса прежние сессии завершены", r.data?.user === null);
    cookie = newCookie;
    r = await call("GET", "/api/me");
    check("после сброса вход на этом устройстве", r.data?.user?.email === email);
    r = await call("POST", "/api/auth/reset", { token, password: "reset-password-4" });
    check("ссылка одноразовая", r.status === 400);
  }

  // Писем на одну почту не больше трёх за 15 минут: одно уже запрошено выше
  let last;
  for (let i = 0; i < 3; i++) last = await call("POST", "/api/auth/forgot", { email });
  check("частота писем ограничена", last.status === 429, `status=${last.status}`);
} else {
  console.log("  --  восстановление пароля не проверяется (нужен локальный сервер с MAIL_DEV_MODE=1)");
}

r = await call("DELETE", "/api/me", { password: "wrong" });
check("удаление требует пароль", r.status === 403);
r = await call("DELETE", "/api/me", { password: finalPassword });
check("удаление аккаунта", r.status === 200);
r = await call("POST", "/api/auth/login", { email, password: finalPassword });
check("удалённый аккаунт не входит", r.status === 401);

console.log(failures ? `\n${failures} проверок не прошло` : "\nВсе проверки прошли");
process.exit(failures ? 1 : 0);
