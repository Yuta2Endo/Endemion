# Образ сайта для своего сервера: Node.js без сборки, только зависимости для работы (без wrangler и Playwright).
# Данные (база, картинки, резервные копии) хранятся в томе /app/data, а не в образе
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY functions ./functions
COPY migrations ./migrations
COPY src ./src
COPY server ./server

# Сервер работает не от root. Папка данных принадлежит пользователю node
RUN mkdir -p /app/data && chown node:node /app/data
USER node

ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.mjs"]
