# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY apps/functions/package.json apps/functions/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM base AS builder
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY . .
RUN npm run build --workspace apps/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat \
  && addgroup -S nodejs \
  && adduser -S nextjs -G nodejs
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/.next/standalone ./apps/web
USER nextjs
WORKDIR /app/apps/web
EXPOSE 8080
CMD ["node", "server.js"]
