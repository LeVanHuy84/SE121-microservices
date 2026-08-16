# Stage 1: Prune workspace
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune --scope=content-feed-service --docker

# Stage 2: Install dependencies & Build
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm config set fetch-retry-maxtimeout 600000 && npm config set fetch-retry-mintimeout 10000 && npm config set fetch-retries 5 && npm ci
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN npx turbo run build --filter=content-feed-service
RUN npm prune --omit=dev

# Stage 3: Runner production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

COPY --from=builder /app/apps/content-feed-service/package.json ./package.json
COPY --from=builder /app/apps/content-feed-service/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/content-feed-service/firebase-service-account.json* ./firebase-service-account.json

EXPOSE 4002
EXPOSE 4200
CMD ["node", "dist/main.js"]
