// Смоук-проверка после выкладки: `npm run smoke` (по умолчанию прод) или `npm run smoke -- http://127.0.0.1:8787`.
// Проверяет коды и ключевые маркеры страниц, чтобы «задеплоил, а сайт старый» ловилось сразу.
// Если заданы SMOKE_TELEGRAM_TOKEN и SMOKE_TELEGRAM_CHAT, при сбое придёт сообщение в Telegram.

const BASE = (process.argv[2] || process.env.BASE_URL || "https://endemion.online").replace(/\/$/, "");
const AUTH = process.env.AUTH_URL || "https://auth.endemion.online";

/** Проверки: адрес, ожидаемый код, кусок HTML/текста, который обязан быть на странице */
const PAGES = [
  { path: "/", status: 200, contains: "ENDEMION" },
  { path: "/games", status: 200, contains: "<main" },
  { path: "/community", status: 200, contains: "Сообщество" },
  { path: "/account", status: 200, contains: "account" },
  { path: "/api/me", status: 200, contains: '"user"' },
  { path: "/sitemap.xml", status: 200, contains: "<urlset" },
  { path: "/robots.txt", status: 200, contains: "Sitemap" },
  { path: "/healthz", status: 200, contains: "ok" }
];

const problems = [];

/** Один запрос с таймаутом: без него зависший сервер держит проверку минутами */
async function probe(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "endemion-smoke/1" }
    });
    return { response, text: await response.text() };
  } catch (error) {
    return { error: error.message };
  }
}

for (const page of PAGES) {
  const { response, text, error } = await probe(`${BASE}${page.path}`);
  if (error) {
    problems.push(`${page.path}: нет ответа (${error})`);
    console.log(`✖ ${page.path} — ${error}`);
    continue;
  }
  if (response.status !== page.status) {
    problems.push(`${page.path}: код ${response.status}, ждали ${page.status}`);
    console.log(`✖ ${page.path} — ${response.status}`);
    continue;
  }
  if (page.contains && !text.includes(page.contains)) {
    problems.push(`${page.path}: на странице нет «${page.contains}»`);
    console.log(`✖ ${page.path} — нет «${page.contains}»`);
    continue;
  }
  console.log(`✔ ${page.path} — ${response.status}`);
}

// Провайдер входа живёт отдельным сервисом: проверяем, что он отдаёт конфигурацию
const auth = await probe(`${AUTH}/.well-known/openid-configuration`);
if (auth.error || auth.response.status !== 200 || !auth.text.includes("authorization_endpoint")) {
  problems.push(`${AUTH}/.well-known/openid-configuration: ${auth.error || auth.response.status}`);
  console.log(`✖ Endemion ID — ${auth.error || auth.response.status}`);
} else {
  console.log("✔ Endemion ID — 200");
}

if (problems.length) {
  console.log(`\nСбоев: ${problems.length}`);
  await alert(problems);
  process.exit(1);
}
console.log(`\nВсё в порядке: ${BASE}`);

/** Уведомление в Telegram, если заданы токен и чат (в репозиторий они не попадают) */
async function alert(list) {
  const token = process.env.SMOKE_TELEGRAM_TOKEN;
  const chat = process.env.SMOKE_TELEGRAM_CHAT;
  if (!token || !chat) return;
  const text = `endemion.online: сбой проверки\n\n${list.join("\n")}`.slice(0, 3500);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
    });
  } catch (error) {
    console.log(`Telegram: уведомление не отправлено (${error.message})`);
  }
}
