// Выгрузка рабочей базы D1 в backups/endemion-<дата>.sql. Запускается сама перед `npm run db:migrate:remote`.
// Восстановление: `npx wrangler d1 execute endemion --remote --file backups/<файл>.sql`
// или откат на момент до миграции через D1 Time Travel (`npx wrangler d1 time-travel`)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = `backups/endemion-${stamp}.sql`;
mkdirSync("backups", { recursive: true });

const isWindows = process.platform === "win32";
const saved = () => existsSync(file) && statSync(file).size > 0;

/** wrangler создаёт выгрузку в Cloudflare и скачивает её; вывод нужен, чтобы достать ссылку на файл */
function exportDb() {
  // npx на Windows — это .cmd, его можно запустить только через оболочку; в команде нет пользовательских значений
  const result = spawnSync(`npx wrangler d1 export endemion --remote --output ${file}`, {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    shell: true
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return `${result.stdout}\n${result.stderr}`;
}

/** У Node иногда не получается подключиться к хранилищу R2, а curl подключается: скачиваем по ссылке из вывода wrangler */
function downloadWithCurl(output) {
  const url = output.match(/https:\/\/[^\s]+\.r2\.cloudflarestorage\.com\/[^\s]+/)?.[0];
  if (!url) return false;
  console.log("wrangler не скачал выгрузку, скачиваю через curl...");
  const result = spawnSync(isWindows ? "curl.exe" : "curl", ["-fsS", "--retry", "3", "--connect-timeout", "15", "-o", file, url], {
    stdio: "inherit"
  });
  return result.status === 0 && saved();
}

// Связь с Cloudflare иногда обрывается (fetch failed): выгрузка повторяется до трёх раз
const ATTEMPTS = 3;
for (let attempt = 1; ; attempt++) {
  const output = exportDb();
  if (saved() || downloadWithCurl(output)) break;
  if (attempt === ATTEMPTS) {
    console.error(`Резервная копия не создана после ${ATTEMPTS} попыток. Миграция не запускается.`);
    process.exit(1);
  }
  console.error(`Попытка ${attempt} не удалась, повтор...`);
}

console.log(`Резервная копия: ${file} (${statSync(file).size} байт)`);
