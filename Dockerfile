# ============ 雲端節點容器(規劃未來上雲端)============
# 無 build step、無轉譯 —— 直接把原始碼複製進去跑(見 /CLAUDE.md §1)。
# 唯一的 npm 依賴是 ws;`npm ci --omit=dev` 之後 node_modules 只有它。
FROM node:22-alpine

WORKDIR /app

# 先裝依賴再複製原始碼:改 public/ 或 server/ 時不必重跑 npm ci
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV SVS_CLOUD=1
ENV PORT=8620
EXPOSE 8620

# 健康檢查:與平台 probe 同一個端點(見 docs/deploy.md)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# 不用 npm start:npm 會多一層行程,SIGTERM 傳不到 node ⇒ 關機時來不及停戰局
CMD ["node", "server/server.js"]
