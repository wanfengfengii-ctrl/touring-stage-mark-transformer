# syntax=docker/dockerfile:1

# ---------- 依赖与构建 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---------- Web 前端：nginx 静态托管 ----------
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

# ---------- 一次性验收服务：单测 + 类型构建 + Playwright ----------
FROM node:22-bookworm-slim AS verify
WORKDIR /app
# 安装 Playwright Chromium 所需系统库（镜像构建期为 root）
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
  && npx playwright install --with-deps chromium
COPY tsconfig.json vite.config.ts playwright.config.ts index.html ./
COPY src ./src
COPY tests ./tests
# 默认验收：Vitest 全量 + tsc/vite 构建 + 指向 Web 容器的端到端测试
CMD ["sh", "-c", "npm run test:unit && npm run build && npx playwright test"]
