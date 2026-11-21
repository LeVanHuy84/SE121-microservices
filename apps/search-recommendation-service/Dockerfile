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
# Prune devDependencies and remove unused OS binaries / debug maps to trim ~350MB+ off image size
RUN npm prune --omit=dev && \
    rm -rf /app/node_modules/onnxruntime-node/bin/napi-v3/darwin \
           /app/node_modules/onnxruntime-node/bin/napi-v3/win32 && \
    find /app/node_modules -name "*.map" -type f -delete && \
    rm -rf /app/node_modules/.cache \
           /app/node_modules/@huggingface/transformers/.cache

# Stage 3: Runner production
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HF_CACHE_DIR=/tmp/.cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs nestjs && \
    mkdir -p /tmp/.cache && \
    chown -R nestjs:nodejs /tmp/.cache

USER nestjs

COPY --chown=nestjs:nodejs --from=builder /app/apps/search-recommendation-service/package.json ./package.json
COPY --chown=nestjs:nodejs --from=builder /app/apps/search-recommendation-service/dist ./dist
COPY --chown=nestjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=builder /app/packages ./packages

EXPOSE 4003
CMD ["node", "dist/main.js"]
