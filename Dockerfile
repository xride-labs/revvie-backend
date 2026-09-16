# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g bun

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build TypeScript (prisma already generated in deps)
RUN bun run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000

RUN npm install -g bun
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nodejs

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nodejs
EXPOSE 5000

CMD ["bun", "run", "node", "dist/src/server.js"]