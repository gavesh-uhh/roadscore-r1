# Multi-stage Dockerfile for roadscore-engine (ENGINE-PLAN §5 & §11 Phase 5)

# --- Build Stage ---
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build config
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

# Build the production bundle (tsup)
RUN npm run build

# Prune dev dependencies for production runtime
RUN npm prune --omit=dev

# --- Production Runtime Stage ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy built application and required production node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

# Default to running the engine entrypoint
CMD ["node", "dist/index.js"]
