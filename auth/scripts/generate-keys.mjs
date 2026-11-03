// Ключ подписи токенов Endemion ID (RS256). Запуск: npm run keys -- путь/к/файлу.json
// Файл секретный: в git не попадает, на сервере права 600. Без пути печатает JSON в консоль

import { writeFileSync, existsSync } from "node:fs";
import { generateJwks } from "../src/config.mjs";

const file = process.argv[2];
const jwks = JSON.stringify(generateJwks(), null, 2);

if (!file) {
  console.log(jwks);
} else if (existsSync(file)) {
  console.error(`Файл ${file} уже есть. Старый ключ не перезаписывается: удалите его сами, если точно нужен новый.`);
  process.exit(1);
} else {
  writeFileSync(file, jwks, { mode: 0o600 });
  console.log(`Ключ записан в ${file}`);
}
