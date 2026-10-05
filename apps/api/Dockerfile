# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Harvik HR API (AGENTS.md §16 P0)
# Multi-stage: install -> compile -> minimal runtime.
#
# `bcrypt` is a native addon. The apt toolchain is only needed if npm has to
# compile it; when a prebuilt binding exists it is used as-is.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so the dependency layer survives source-only edits.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --workspace=@harvik/api --include-workspace-root

COPY apps/api ./apps/api
RUN npm run build --workspace=@harvik/api

# Drop dev tooling, keeping the compiled bcrypt binding that the API needs.
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY deploy/ecosystem.config.js ./deploy/ecosystem.config.js

# Uploaded documents are served by the API only (AGENTS.md §13) and must never
# be exposed as static files, so they live in a private volume.
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
VOLUME ["/data/uploads"]

USER node

EXPOSE 4000

# Compose drives the container; this guards a bare `docker run` too. `/ready`
# verifies both MongoDB and Redis (AGENTS.md §11).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/ready" || exit 1

CMD ["node", "apps/api/dist/server.js"]