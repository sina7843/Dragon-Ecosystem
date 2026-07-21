# syntax=docker/dockerfile:1
# Build context is the repository root so the workspace lockfile stays authoritative.

# Production dependencies only, resolved from the committed lockfile.
FROM node:22.12.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include-workspace-root --workspace @dragon/api --omit=dev

# Compile TypeScript with the full toolchain.
FROM node:22.12.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include-workspace-root --workspace @dragon/api
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run build --workspace @dragon/api

# Runtime image carries no build tooling and runs as the built-in nonroot user.
FROM node:22.12.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
