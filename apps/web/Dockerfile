# syntax=docker/dockerfile:1

# Next.js 公式 Dockerfile をベースに、マルチステージビルドで最小構成を作成
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# ビルドステージ
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 実行ステージ
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

EXPOSE 3000
CMD ["npm", "run", "start"]
