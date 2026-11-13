// Деплой прода: сайт endemion.online живёт на VPS (Docker: app + auth + Caddy), а не в воркере.
// Скрипт переключает сервер на origin/<ветка>, пересобирает app, ждёт здоровье и гоняет смоук.
// Воркер `npm run deploy` остаётся предпросмотром на *.workers.dev и прод не обслуживает.
//
// Настройки через окружение: DEPLOY_HOST (root@185.175.156.196), DEPLOY_KEY (~/.ssh/endemion_vps),
// DEPLOY_DIR (/opt/endemion), DEPLOY_BRANCH (site-improve), SITE_URL (https://endemion.online).

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const HOST = process.env.DEPLOY_HOST || "root@185.175.156.196";
const KEY = process.env.DEPLOY_KEY || path.join(os.homedir(), ".ssh", "endemion_vps");
const DIR = process.env.DEPLOY_DIR || "/opt/endemion";
const BRANCH = process.env.DEPLOY_BRANCH || "site-improve";
const SITE = process.env.SITE_URL || "https://endemion.online";

/** Выполняет команду и печатает её вывод построчно */
function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", ...options });
}

/** ssh без интерактивных вопросов: ключ указан явно, хост должен быть в known_hosts */
function ssh(script) {
  run("ssh", ["-i", KEY, "-o", "BatchMode=yes", HOST, script]);
}

const localHead = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const remoteHead = execFileSync("git", ["rev-parse", "--short", `origin/${BRANCH}`], { encoding: "utf8" }).trim();
console.log(`локально ${localHead}, origin/${BRANCH} ${remoteHead}`);
if (localHead !== remoteHead) {
  console.error(`Сначала запушьте ветку: git push origin ${BRANCH}`);
  process.exit(1);
}

console.log(`\nПереключаю ${HOST}:${DIR} на origin/${BRANCH}`);
ssh(`set -e
cd ${DIR}
git fetch -q origin ${BRANCH}
git checkout -q --detach origin/${BRANCH}
git log --oneline -1
docker compose build app
docker compose up -d --no-deps app
docker compose ps --format "table {{.Service}}\t{{.Status}}"`);

console.log("\nЖду, пока сайт поднимется");
const deadline = Date.now() + 120_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${SITE}/healthz`, { redirect: "manual" });
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!healthy) {
  console.error(`${SITE}/healthz не ответил за 2 минуты — смотрите docker compose logs app`);
  process.exit(1);
}

console.log("\nСмоук по продакшену");
run(process.execPath, ["scripts/smoke.mjs"]);
console.log(`\nГотово: ${SITE} на ${localHead}`);
