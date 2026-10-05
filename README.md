# Harvik Technologies — Internal HR Dashboard

Internal HR system for [Harvik Technologies](https://harviktech.com/), built
against [`AGENTS.md`](./AGENTS.md).

> **Phase status: P0 (foundation) only.**
> Shipped so far: repository structure, MongoDB 7 replica set, Redis 7 + BullMQ,
> Express API, JWT auth with refresh rotation, RBAC, audit logging, field-level
> encryption, seed data, and the automated test suite.
> Not yet built: employees, Employee 360, dashboard, recruitment, onboarding,
> attendance, leave, documents, assets, licences, exit, reports, notifications.
> Nothing in the UI displays invented data — there are no placeholder metrics.

---

## 1. Stack

Mandated by `AGENTS.md` §3 and not substituted anywhere.

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + Vite 6 (static build, no SSR), React Router 7, TanStack Query 5, React Hook Form, Zod, Tailwind CSS 4, Recharts |
| Backend | Node.js 22, Express 4, Mongoose 8, Zod, JWT, bcrypt, Helmet, CORS, express-rate-limit, Pino, Multer, BullMQ 5, ioredis 5 |
| Database | MongoDB Community **7.0.14**, single-node replica set `rs0` (transactions) |
| Cache / queues | Redis **7.4** |
| E2E | Playwright (P8) |

---

## 2. Repository layout

```
.
├── AGENTS.md                     # implementation contract
├── docker-compose.yml            # mongo + rs-init + redis + api + worker + nginx
├── .env.example                  # templates (placeholders are intentionally rejected)
├── .dockerignore
├── docs/DECISIONS.md             # every design decision, with reasoning
├── apps/
│   ├── api/                      # Express + Mongoose
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── config/           # zod-validated env, domain constants
│   │   │   ├── db/               # mongo + redis connections
│   │   │   ├── middleware/       # auth, rbac, validate, errorHandler, rateLimit
│   │   │   ├── modules/          # auth, users, employees, departments, audit, counters, health
│   │   │   ├── jobs/             # BullMQ queues + schedulers
│   │   │   ├── utils/            # crypto, logger, ids, dates, errors, cache, shutdown
│   │   │   ├── seed/             # `npm run seed`
│   │   │   ├── app.ts server.ts worker.ts
│   │   └── tests/                # unit + integration (vitest + supertest)
│   └── web/                      # React 19 + Vite
│       ├── Dockerfile
│       └── src/
│           ├── api/              # fetch client, token refresh
│           ├── features/auth/    # login, session provider
│           └── App.tsx           # /login + authenticated shell
└── deploy/
    ├── nginx.conf                # SPA + /api reverse proxy
    └── ecosystem.config.js       # PM2 (non-Docker deployments)
```

---

## 3. Prerequisites

- Docker 24+ with Compose v2
- Node.js 20+ and npm 10+ (only needed for local development outside Docker)

---

## 4. Configuration

`src/config/env.ts` validates the environment at boot and **refuses to start**
on invalid values. The placeholders in `.env.example` are deliberately rejected,
so the stack cannot run with a guessable signing key.

```bash
cp .env.example .env
```

Generate the three secrets the validator requires:

```bash
# JWT_ACCESS_SECRET and JWT_REFRESH_SECRET — must differ, min 32 chars
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# FIELD_ENCRYPTION_KEY — must be base64 of exactly 32 bytes (AES-256-GCM)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste them into `.env`. Other notable variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | `mongodb://mongo:27017/harvik_hr?replicaSet=rs0` | replica set required for transactions |
| `REDIS_URL` | `redis://redis:6379` | queues, cache, rate limits, token denylist |
| `CORS_ORIGINS` | `http://localhost:8080` | comma-separated browser origin allow-list |
| `TRUST_PROXY_HOPS` | `1` | nginx hops; needed so rate limiting sees the real client IP |
| `LOG_LEVEL` | `info` | pino level |
| `SMTP_*` | blank | blank ⇒ console/log transport |

---

## 5. Run with Docker

```bash
docker compose up --build
```

Services: `mongo` (7.0.14, `--replSet rs0`), `rs-init` (one-shot replica-set
initializer that exits 0), `redis` (7.4), `api`, `worker`, `nginx`.

Startup order is enforced: the API and worker wait for `rs-init` to report a
`PRIMARY` and for Redis to pass its healthcheck, and nginx waits for the API's
`/ready`.

Load the demo data, then open **http://localhost:8080**:

```bash
docker compose run --rm seed
```

Stop and discard data:

```bash
docker compose down -v
```

---

## 6. Run locally without Docker

MongoDB 7 must run as a replica set named `rs0` and Redis 7 must be reachable.

```bash
cp .env.example .env     # then fill in real secrets
# point MONGO_URI / REDIS_URL at your local instances

npm install
npm run seed             # or: npm run seed --workspace=apps/api
npm run dev              # API  → http://localhost:4000
npm run worker           # BullMQ worker (separate shell)
npm run dev:web          # Vite dev server → http://localhost:5173
```

---

## 7. Demo accounts

`npm run seed` creates the four accounts from `AGENTS.md` §12. The shared demo
password is `Passw0rd!`.

| Email | Role |
| --- | --- |
| `admin@harviktech.com` | HR Admin |
| `hrmanager@harviktech.com` | HR Manager |
| `manager@harviktech.com` | Manager |
| `employee@harviktech.com` | Employee |

Seed data also creates the five departments (Engineering, Design, HR, Finance,
Sales), 11 employees spanning all five employment types, and a reporting
hierarchy three levels deep.

`runSeed({ reset: true })` is idempotent: employee codes restart at `HRV-0001`
on every run.

The seed never prints the demo password and never logs it.

---

## 8. Verification

```bash
npm test          # 167 tests: unit + integration
npm run lint      # eslint, api + web
npm run build     # tsc (api) + vite build (web)
```

### Verification status

| Check | Result |
| --- | --- |
| `npm test` — 167 unit + integration tests | pass |
| `npm run lint` — api and web | pass |
| `npm run typecheck` — api src and tests | pass |
| `npm run build` — api `tsc` and web `vite build` | pass |
| `docker compose config` (client-side) | pass — 6 services resolved |
| Auth over real HTTP against the compiled `dist/`, real `mongod` 7.0.14 replica set | pass — 33/33 checks |
| `npm run seed` end-to-end, twice (idempotent) | pass |
| **`docker compose build` / `up`** | **not verified** — see below |

The Docker daemon cannot start on the machine this was built on. Docker Desktop's
own backend log reports:

```
starting engine: engine linux/wsl failed to start: checking preconditions:
Virtual Machine Platform not enabled
No virtualization available
```

WSL2 is not installed and the Windows *Virtual Machine Platform* optional feature
is disabled; enabling it needs an elevated shell and a reboot. Until that is done,
`docker compose up --build` cannot be executed here, so the containerised stack is
**unverified** rather than verified. Run it on a Docker-capable host before
signing P0 off.

Test suite notes:

- **Real MongoDB.** `tests/setup/global-setup.ts` starts an actual
  `mongod` 7.0.14 single-node replica set, so transactions are genuinely
  available rather than mocked.
- **Redis double.** Redis has no Windows build and Docker was unavailable during
  development, so `ioredis-mock` is injected through `setRedisClient()`. Plain
  commands (the refresh-token denylist, cache helpers) are genuinely exercised.
  `rate-limit-redis` and BullMQ need Lua evaluation and are therefore **not**
  covered — see `docs/DECISIONS.md` D-04.
- **Rate limiting is not relaxed.** The login limiter stays at 5/min/IP; tests
  vary the simulated client IP via `X-Forwarded-For` instead.

---

## 9. API surface (P0)

Base prefix `/api/v1`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | liveness; does not touch dependencies |
| `GET` | `/ready` | public | readiness; **verifies MongoDB and Redis**, 503 if either is down |
| `POST` | `/api/v1/auth/login` | public | returns access token + httpOnly refresh cookie |
| `POST` | `/api/v1/auth/refresh` | refresh cookie | rotates the refresh token |
| `POST` | `/api/v1/auth/logout` | refresh cookie | denylists the refresh token, clears the cookie |
| `GET` | `/api/v1/auth/me` | bearer | current account + permissions |
| `POST` | `/api/v1/auth/change-password` | bearer | enforces the §6 password policy |

Responses:

```jsonc
// success
{ "data": { } }

// list (P1+, shape fixed now)
{ "data": [], "meta": { "page": 1, "limit": 20, "total": 0 } }

// error
{ "error": { "code": "FORBIDDEN", "message": "...", "details": {} } }
```

Status codes: 400 validation · 401 unauthenticated · 403 forbidden ·
404 not found · 409 conflict · 422 business rule · 429 rate limited.
Maximum page size is 100.

---

## 10. Security posture

| Control | Implementation |
| --- | --- |
| Password hashing | bcrypt, cost 12 (§6 requires ≥ 10) |
| Access token | JWT, 15 min, held in memory by the frontend only |
| Refresh token | opaque random value, 7 days, stored **hashed** (SHA-256), delivered as an httpOnly cookie |
| Refresh rotation | every refresh denylists the presented token; reuse is detected and audited |
| Logout | denylisted in Redis for the remainder of the token's life |
| RBAC | enforced server-side per request; the client `permissions` array is advisory only |
| Password policy | min 8 chars, at least one letter and one number |
| User enumeration | unknown email and wrong password return an identical 401 |
| Helmet | full header set, CSP included |
| CORS | explicit origin allow-list, credentials enabled, never `origin: true` |
| Rate limiting | login 5/min/IP (`skipSuccessfulRequests`), API 600/min; Redis-backed in production |
| HPP | query-parameter pollution stripped |
| NoSQL injection | `express-mongo-sanitize` plus `strictQuery` / `sanitizeFilter` |
| Field encryption | AES-256-GCM, `v1:iv:tag:ciphertext`, for bank details and licence keys |
| Log redaction | pino `redact` covers passwords, tokens, cookies, bank details, licence keys |
| Audit | create / update / delete / status change, with actor, before/after, IP, request id |
| Uploads | random server filenames, MIME + extension + size validation, **never served statically**; `/uploads/*` returns 404 |
| Errors | one envelope; unknown errors log server-side and return a generic 500 |
| Request ids | `X-Request-Id` generated or echoed, attached to every log line |

Login attempts are limited to 5 per minute per IP. Successful logins do not
consume the budget.

---

## 11. Requirement traceability (`AGENTS.md` §18)

| # | Requirement | Module | Status |
| --- | --- | --- | --- |
| 13 | Access control — auth, users, RBAC | `modules/auth`, `modules/users`, `middleware/auth`, `middleware/rbac` | **P0 done** (audit + crypto helpers included) |
| — | Audit trail for every mutation | `modules/audit` | **P0 done** |
| — | Human-readable IDs (HRV/ASSET/JOB/LIC/CAN) | `modules/counters`, `utils/ids` | **P0 done** |
| — | Config validation, logging, errors, `/health`, `/ready` | `config/env`, `utils/logger`, `utils/errors`, `modules/health` | **P0 done** |
| — | Seed data + four demo logins | `src/seed` | **P0 done** (HR-scoped fixtures) |
| 2 | Employee management, Employee 360 | `modules/employees` | P1 — schema present, endpoints pending |
| 1 | Dashboard (14 metrics, 7 quick actions) | `modules/dashboard` | P1 |
| 3 | Recruitment | `modules/recruitment` | P6 |
| 4 | Onboarding | `modules/onboarding` | P6 |
| 5 | Attendance | `modules/attendance` | P5 |
| 6 | Leave | `modules/leave` | P5 |
| 7 | Documents (upload, versions, PDF templates) | `modules/documents` | P4 |
| 8 | Hardware / assets | `modules/assets` | P2 |
| 9 | Software / licences / access | `modules/licenses` | P2 |
| 10 | Exit / offboarding | `modules/exit` | P3 |
| 11 | Reports (11 reports, CSV/XLSX) | `modules/reports` | P7 |
| 12 | Notifications / reminders | `modules/notifications`, `jobs` | P7 |
| 14 | Employee lifecycle across all modules | employees + connected modules | P1–P8 |

Modules not yet implemented are absent from `apps/api/src/modules/` rather than
stubbed, so nothing can accidentally depend on non-existent behaviour.

---

## 12. Build phases (`AGENTS.md` §16)

| Phase | Scope | Status |
| --- | --- | --- |
| **P0** | repo, Docker Compose, Mongo rs0, Redis, API, worker, web, nginx, config, logging, errors, health, auth, RBAC, audit, IDs, encryption, seed, tests | complete |
| P1 | departments, employees, Employee 360, status machine, dashboard | not started |
| P2 | assets, licences, seats, access items, transactions | not started |
| P3 | exit, checklist, clearances, relieve guard, force-relieve | not started |
| P4 | documents, secure serving, versions, PDF templates | not started |
| P5 | attendance, corrections, leave, balances, nightly jobs | not started |
| P6 | recruitment, candidates, onboarding | not started |
| P7 | reports, exports, notifications, BullMQ reminders | not started |
| P8 | hardening, Playwright E2E, OpenAPI, docs | not started |

---

## 13. Operational endpoints

```bash
curl http://localhost:4000/health   # {"status":"ok",...}          — never fails on a dependency
curl http://localhost:4000/ready    # {"status":"ready",...}       — 503 unless Mongo AND Redis respond
```

Both are excluded from API logging and from rate limiting so probes stay cheap.
`/ready` returning 200 is the contract the API and worker containers use for
readiness.

---

## 14. Documentation

- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — design decisions, rationale, and
  known gaps carried into later phases
- [`AGENTS.md`](./AGENTS.md) — the implementation contract