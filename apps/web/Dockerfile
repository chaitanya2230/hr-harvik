# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Harvik HR Web (AGENTS.md §3) — React 19 + Vite static build.
# Built as a static bundle; nginx serves it and reverse-proxies /api (deploy/nginx.conf).
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --workspace=@harvik/web --include-workspace-root

COPY apps/web ./apps/web
RUN npm run build --workspace=@harvik/web


FROM nginx:1.27-alpine AS runtime

# The SPA fallback + /api proxy live in deploy/nginx.conf (AGENTS.md §3).
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]