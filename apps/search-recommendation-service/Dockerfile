# Stage 1: Prune workspace
FROM node:20-slim AS pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune --scope=search-recommendation-service --docker

# Stage 2: Install dependencies & Build
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm config set fetch-retry-maxtimeout 600000 && npm config set fetch-retry-mintimeout 10000 && npm config set fetch-retries 5 && npm ci
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN npx turbo run build --filter=search-recommendation-service
RUN npm prune --omit=dev

# Stage 3: Runner production
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs nestjs
USER nestjs

COPY --from=builder /app/apps/search-recommendation-service/package.json ./package.json
COPY --from=builder /app/apps/search-recommendation-service/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 4003
CMD ["node", "dist/main.js"]
