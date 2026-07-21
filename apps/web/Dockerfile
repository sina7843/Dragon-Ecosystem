# syntax=docker/dockerfile:1
# Build context is the repository root so the workspace lockfile stays authoritative.

FROM node:22.12.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include-workspace-root --workspace @dragon/web
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN npm run build --workspace @dragon/web

# Static assets are served by an unprivileged nginx listening on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1
