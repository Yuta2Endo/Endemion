// Права администратора на своём сервере: `node server/grant-admin.mjs <почта>` (снять — с флагом --revoke).
// В Docker: `docker compose exec app node server/grant-admin.mjs <почта>`. Через сайт стать администратором нельзя

import { DatabaseSync } from "node:sqlite";
import { DB_FILE } from "./config.mjs";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
if (!email) {
  console.error("Укажите почту: node server/grant-admin.mjs почта@example.ru [--revoke]");
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA busy_timeout = 5000");
const result = db.prepare("UPDATE users SET is_admin = ? WHERE email = ?").run(revoke ? 0 : 1, email);
db.close();

if (!result.changes) {
  console.error(`Пользователь ${email} не найден. Сначала зарегистрируйтесь на сайте.`);
  process.exit(1);
}
console.log(revoke ? `${email} больше не администратор.` : `${email} теперь администратор.`);
