# Worker di generazione — build multi-stage con pnpm.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- deps + build ---
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter worker build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker/package.json ./apps/worker/package.json
# Solo dipendenze di produzione del worker.
RUN pnpm install --frozen-lockfile --prod --filter worker...
COPY --from=build /app/apps/worker/dist ./apps/worker/dist

WORKDIR /app/apps/worker
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD node -e "require('http').get('http://localhost:'+(process.env.WORKER_HEALTH_PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
