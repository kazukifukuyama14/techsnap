# Stage 1: 開発依存込みでインストールしてビルド
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install       # devDependencies 含む

COPY . .
RUN npm run build     # package.json に "build": "tsc -p tsconfig.json" 等を追加しておく

# Stage 2: 本番用に最小構成を作成
FROM node:18-alpine

WORKDIR /app

# 本番用に production 依存だけコピー
COPY package*.json ./
RUN npm install --production

# ビルド成果物をコピー
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]