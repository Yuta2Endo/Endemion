# Образ Endemion ID (auth.endemion.online). Собирается из корня репозитория: шрифты и значок берутся из public/ сайта.
#   docker compose build auth
# Данные (база, ключ подписи, аватары, копии) — в томе /app/data, не в образе
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY auth/package.json auth/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY auth/src ./src
COPY auth/migrations ./migrations
COPY auth/public ./public
COPY auth/scripts ./scripts
# Шрифты и значок сайта: страницы входа выглядят так же, как endemion.online
COPY public/assets/fonts ./shared/assets/fonts
COPY public/favicon.svg ./shared/favicon.svg

RUN mkdir -p /app/data && chown node:node /app/data
USER node

ENV PORT=3001 HOST=0.0.0.0 AUTH_DATA_DIR=/app/data SHARED_PUBLIC_DIR=/app/shared
EXPOSE 3001
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.mjs"]
