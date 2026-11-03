// Запуск Endemion ID: node --env-file-if-exists=.env src/server.mjs (npm start)

import { loadConfig } from "./config.mjs";
import { createApp, createLogger } from "./app.mjs";

const config = loadConfig();
const log = createLogger(config.production);
const app = createApp(config, { log });

// Истёкшие сессии, коды и счётчики попыток удаляются раз в 10 минут
const timer = setInterval(() => {
  try {
    app.cleanup();
  } catch (err) {
    log("error", "cleanup failed", { error: err.message });
  }
}, 10 * 60 * 1000);
timer.unref();

const server = app.provider.listen(config.port, config.host, () => {
  log("info", "Endemion ID started", { issuer: config.issuer, port: config.port, clients: config.clients.map((c) => c.client_id), mail: config.mail.driver });
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
