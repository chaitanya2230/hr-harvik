# Harvik Technologies — Internal HR Dashboard

Internal HR system for [Harvik Technologies](https://harviktech.com/), built
against [`AGENTS.md`](./AGENTS.md).

> **Phase status: P0 → P5 complete.**
> Shipped so far: repository structure, MongoDB 7 replica set, Redis 7 + BullMQ,
> Express API, JWT auth with refresh rotation, RBAC, audit logging, field-level
> encryption, seed data, employees, Employee 360, dashboard, assets, licenses,
> access items, exit/offboarding lifecycle, live checklists, clearances, guarded relieve,
> documents, secure file streaming, versioning lineage, templates, PDFKit PDF generation,
> exit document linkage, attendance ledger, attendance corrections, holiday management,
> nightly BullMQ attendance reconciliation job, configurable leave types, pro-rated leave balances,
> atomic overdraft-safe leave requests, and the automated test suite (347 tests passing).
> Not yet built: recruitment, onboarding, reports, notifications.
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
│   │   │   ├── modules/          # auth, users, employees, departments, audit, counters, health,
│   │   │   │                       # dashboard, assets, licenses, access, exit, documents,
│   │   │   │                       # attendance, leave (+ templates, holidays, corrections)
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

> The `seed` service uses the `tools` profile, so `up --build` does not rebuild
> it — after pulling new code run `docker compose build seed` first, otherwise
> `run` silently uses the previous image.

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
npm test             # 347 tests / 22 files: unit + integration (mock Redis, real mongod 7)
npm run test:docker  # the SAME tests against the compose MongoDB + Redis 7
npm run lint         # eslint, api + web
npm run build        # tsc (api) + vite build (web)
```

The web workspace has no unit-test runner yet; Playwright E2E is a P8
deliverable (§16) and no specs exist at P1.

### Verification status

| Check | Result |
| --- | --- |
| `npm test` — 347 unit + integration tests, 22 files | pass (176 P0 + 38 P1 + 58 P2 + 24 P3 + 17 P4 + 34 P5) |
| `npm run test:docker` — same tests, real Redis 7 + `RedisStore` | pass |
| `npm run lint` — api and web | pass |
| `npm run typecheck` — api and web `tsconfig.json` | pass |
| `npm run build` — api `tsc` and web `vite build` (127+ modules) | pass |
| `docker compose config` | pass — `mongo rs-init redis worker api nginx` |
| `docker compose build` | pass |
| `docker compose up -d --build` | pass — 6 services, all healthy |
| MongoDB `rs0` reaches PRIMARY | pass — `stateStr=PRIMARY`, `isWritablePrimary=true`, `logicalSessionTimeoutMinutes=30` |
| Multi-document transactions | pass — commit **and** rollback verified via the app's own mongoose |
| Redis 7 readiness | pass — 7.4.11, `PING` → `PONG` |
| `/health` and `/ready` | pass — `/ready` reports `mongo.ok` **and** `redis.ok` |
| `/ready` fails fast (503, not a hang) when a dependency stops answering | pass — verified live: MongoDB stopped → 503 in 4–85 ms, `/health` still 200 |
| Worker / BullMQ on real Redis | pass — worker healthy; a job enqueued from a separate process was consumed cross-container, executed and completed (`attempts made: 1`, return-value timestamp matches the worker log line exactly) |
| Worker healthcheck cannot wedge the worker | pass — after `FLUSHALL` (which deletes the boot-time `repeat*` keys) the worker stayed **healthy / 0 failures** across 3+ intervals; a restart restored them. See D-21 |
| nginx serves the SPA and proxies `/api` | pass — incl. SPA deep-link fallback and `/health`, `/ready` |
| nginx survives an `api` container IP change | pass — followed `.2` → `.7` → `.6` with **no nginx restart** (D-18) |
| Auth through nginx | pass — 47/47 checks: 401 envelope, all four roles, permission sets, `/me`, tampered JWT, cookie-only rejection |
| Refresh rotation + replay + logout | pass — cookie rotates, old token replayed → 401, post-logout refresh → 401 (Redis denylist) |
| Password policy §6 | pass — `<8` chars, digits-only, letters-only, wrong current password all rejected |
| NoSQL operator injection | pass — `{$ne:null}` → 400 |
| Wrong method on a POST-only route | pass — `GET/PUT/PATCH/DELETE` → 404 `NOT_FOUND`, handler never reached |
| Login rate limit on the real `RedisStore` | pass — 5×401 then 429; blocked IP rejected even with the correct password; draft-7 `RateLimit` header present, legacy `X-RateLimit-*` absent |
| `skipSuccessfulRequests` on the real `RedisStore` | pass — 8 consecutive valid logins all 200; full 5-failure budget intact afterwards |
| Per-IP isolation on the real `RedisStore` | pass — host bucket exhausted to 429 while a second address independently got its own budget; both keys coexist in Redis |
| Header hardening through nginx | pass — no `X-Powered-By`, Helmet CSP, `X-Request-Id` |
| `/uploads/…` never publicly served (§13) | pass — direct guess 404, traversal 400 |
| All four demo roles log in through nginx | pass |
| `docker compose run --rm seed`, run twice | pass — 5 departments / 11 employees / 4 users + 30 assets / 8 licenses / 4 access items, idempotent |
| P1 employees through nginx | pass — create → HRV-####, 409 duplicate email, search/filter, 360 tabs, history, status machine, re-hire, audit |
| P1 dashboard through nginx | pass — 14 metric keys, values match MongoDB, 60s cache + invalidation on write, team/personal scoping |
| 403 over HTTP | **reachable since P1** — employee routes enforce `requirePermission`; Manager/Employee denials and out-of-scope reads covered |

> **403 became reachable in P1.**
> P0 mounted only `requireAuth`, so no route could return 403. P1 mounts
> `requirePermission` on the employee routes, and `employees.test.ts` covers
> Manager/Employee denials plus out-of-scope reads over HTTP. The P0 probe suite
> `tests/integration/rbac-api.test.ts` (19 tests) still covers the middleware
> itself.

`npm run test:docker` needs the services up first:

```bash
docker compose up -d mongo rs-init redis
npm run test:docker        # from apps/api
```

It runs the *same* suites with `HR_DOCKER_TESTS=1`, which skips the Redis mock
and forces `RATE_LIMIT_STORE=redis`. No test is skipped and no assertion is
relaxed — see `docs/DECISIONS.md` D-04 and D-16.

> Running the suite from the Windows host against the containerised replica set
> needs `directConnection=true` in `MONGO_URI`: `rs0`'s only member advertises
> itself as `mongo:27017`, a name only resolvable inside the Docker network, so
> a driver on the host fails with `ENOTFOUND mongo` when it follows the
> topology. `npm run test:docker` applies this automatically.

Test suite notes:

- **Real MongoDB.** `tests/setup/global-setup.ts` starts an actual
  `mongod` 7.0.14 single-node replica set, so transactions are genuinely
  available rather than mocked. `npm run test:docker` uses the containerised
  `mongo:7.0.14` instead.
- **Redis is a double only by default.** Plain commands (the refresh-token
  denylist, cache helpers) are exercised through `ioredis-mock`.
  `rate-limit-redis` and BullMQ need Lua evaluation, so they are covered by
  `npm run test:docker` against real Redis 7 — see `docs/DECISIONS.md` D-04.
- **Rate limiting is not relaxed.** The login limiter stays at 5/min/IP; tests
  vary the simulated client IP via `X-Forwarded-For` instead.

---

## 9. API surface (P0 + P1)

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
| `GET` | `/api/v1/employees` | bearer + `viewEmployeeDirectory` | paginated directory, search/filter/sort (HR roles) |
| `POST` | `/api/v1/employees` | bearer + `createEmployee` | create employee, optional login |
| `GET` | `/api/v1/employees/:id` | bearer + scope | 360 projection (HR any, Manager team, Employee self) |
| `GET` | `/api/v1/employees/:id/history` | bearer + scope | status + employment timelines |
| `PATCH` | `/api/v1/employees/:id` | bearer + `updateEmployee` | update, type change appends history |
| `POST` | `/api/v1/employees/:id/status` | bearer + `updateEmployee` | status machine, HR-Admin re-hire |
| `DELETE` | `/api/v1/employees/:id` | bearer + `deleteEmployee` | soft delete (HR Admin only) |
| `GET` | `/api/v1/departments` | bearer | scoped department list for pickers |
| `GET` | `/api/v1/departments/manager-options` | bearer | assignable managers (HR roles) |
| `GET` | `/api/v1/dashboard/summary` | bearer + scope | 14 metrics, 60s Redis cache |
| `GET` | `/api/v1/assets` | bearer + `manageAssets` | inventory, search/filter/sort/overdue |
| `POST` | `/api/v1/assets` | bearer + `manageAssets` | create, `AST-####` |
| `GET` | `/api/v1/assets/:id` | bearer + `manageAssets` | 360-style detail + active assignment |
| `GET` | `/api/v1/assets/:id/history` | bearer + `manageAssets` | assignment history |
| `PATCH` | `/api/v1/assets/:id` | bearer + `manageAssets` | edit descriptive fields |
| `DELETE` | `/api/v1/assets/:id` | bearer + `manageAssets` | 409 with history, else soft delete |
| `POST` | `/api/v1/assets/:id/assign` | bearer + `manageAssets` | transactional assign |
| `POST` | `/api/v1/assets/:id/return` | bearer + `manageAssets` | close assignment → Returned |
| `POST` | `/api/v1/assets/:id/repair` | bearer + `manageAssets` | Available/Under Repair/Lost/Damaged |
| `POST` | `/api/v1/assets/:id/retire` | bearer + `manageAssets` | terminal retire |
| `GET` | `/api/v1/assets/assignments` | bearer + scope | scoped ledger, overdue filter |
| `GET` | `/api/v1/licenses` | bearer + `manageLicenses` | pool, seats math, no keys |
| `POST` | `/api/v1/licenses` | bearer + `manageLicenses` | create, `LIC-####`, key encrypted |
| `GET` | `/api/v1/licenses/:id` | bearer + `manageLicenses` | detail, never the key |
| `GET` | `/api/v1/licenses/:id/utilization` | bearer + `manageLicenses` | seat math |
| `GET` | `/api/v1/licenses/:id/key` | HR Admin only | audited key reveal |
| `PATCH` | `/api/v1/licenses/:id` | bearer + `manageLicenses` | edit, seat floor guard |
| `DELETE` | `/api/v1/licenses/:id` | bearer + `manageLicenses` | 409 with history, else soft delete |
| `POST` | `/api/v1/licenses/:id/assign` | bearer + `manageLicenses` | atomic seat claim |
| `POST` | `/api/v1/licenses/assignments/:id/revoke` | bearer + `manageLicenses` | release seat |
| `POST` | `/api/v1/licenses/:id/renew` | bearer + `manageLicenses` | new date, recalculates status |
| `POST` | `/api/v1/licenses/:id/suspend` | bearer + `manageLicenses` | explicit boolean |
| `POST` | `/api/v1/licenses/:id/expire` | bearer + `manageLicenses` | mark expired |
| `POST` | `/api/v1/licenses/:id/revoke` | bearer + `manageLicenses` | revoke the license itself |
| `GET` | `/api/v1/licenses/assignments` | bearer + scope | scoped seat ledger |
| `POST` | `/api/v1/access` | bearer + `manageLicenses` | external account record |
| `GET` | `/api/v1/access` | bearer + scope | scoped access ledger |
| `GET` | `/api/v1/access/:id` | bearer + scope | scoped single read |
| `POST` | `/api/v1/access/:id/revoke` | bearer + `manageLicenses` | mark revoked |
| `POST` | `/api/v1/exit/initiate` | bearer + `manageExits` | initiate exit lifecycle |
| `GET` | `/api/v1/exit` | bearer + `manageExits` | list active and completed exits |
| `GET` | `/api/v1/exit/:id` | bearer + scope | exit detail, live checklist & clearances |
| `PATCH` | `/api/v1/exit/:id/checklist/:itemId` | bearer + `manageExits` | mark checklist item status |
| `PATCH` | `/api/v1/exit/:id/clearance` | bearer + scope | submit departmental clearance |
| `POST` | `/api/v1/exit/:id/relieve` | bearer + `manageExits` | atomic relieve (forceReason for HR Admin) |
| `POST` | `/api/v1/exit/:id/withdraw` | bearer + `manageExits` | cancel exit on resignation withdrawal |
| `GET` | `/api/v1/documents` | bearer + scope | list documents by category & scope |
| `POST` | `/api/v1/documents/upload` | bearer + scope | secure multi-format upload (max 10MB) |
| `GET` | `/api/v1/documents/:id` | bearer + scope | document metadata |
| `GET` | `/api/v1/documents/:id/file` | bearer + scope | authenticated streaming download |
| `GET` | `/api/v1/documents/:id/history` | bearer + scope | document revision lineage |
| `POST` | `/api/v1/documents/generate` | bearer + `manageTemplates` | generate PDF from Handlebars template |
| `GET` | `/api/v1/documents/templates` | bearer + scope | list document templates |
| `POST` | `/api/v1/documents/templates` | bearer + `manageTemplates` | create document template |
| `POST` | `/api/v1/documents/templates/preview` | bearer + `manageTemplates` | preview compiled HTML |
| `GET` | `/api/v1/attendance` | bearer + scope | list daily attendance ledger |
| `POST` | `/api/v1/attendance` | bearer + scope | mark attendance (self/manual) |
| `GET` | `/api/v1/attendance/monthly` | bearer + scope | monthly grid attendance view |
| `GET` | `/api/v1/attendance/corrections` | bearer + scope | list attendance correction requests |
| `POST` | `/api/v1/attendance/corrections` | bearer + `requestSelfAttendanceCorrection` | request attendance correction |
| `POST` | `/api/v1/attendance/corrections/:id/review` | bearer + `approveAttendanceCorrections` | approve or reject correction |
| `GET` | `/api/v1/attendance/holidays` | bearer | list configured company holidays |
| `POST` | `/api/v1/attendance/holidays` | bearer + `manageAttendance` | add company holiday |
| `DELETE` | `/api/v1/attendance/holidays/:id` | bearer + `manageAttendance` | delete company holiday |
| `GET` | `/api/v1/leave/types` | bearer | list leave types |
| `POST` | `/api/v1/leave/types` | bearer + `manageLeaveTypes` | create leave type |
| `PATCH` | `/api/v1/leave/types/:id` | bearer + `manageLeaveTypes` | update leave type |
| `GET` | `/api/v1/leave/balances` | bearer + scope | employee leave balances |
| `POST` | `/api/v1/leave/balances/rollover` | bearer + `manageLeaveTypes` | annual balance rollover |
| `GET` | `/api/v1/leave/requests` | bearer + scope | list leave requests |
| `POST` | `/api/v1/leave/requests` | bearer + `applySelfLeave` | apply for leave (optimistic locking) |
| `POST` | `/api/v1/leave/requests/:id/review` | bearer + `approveLeaveRequests` | approve/reject leave |
| `POST` | `/api/v1/leave/requests/:id/cancel` | bearer + scope | cancel pending/approved leave |
| `GET` | `/api/v1/leave/calendar` | bearer + scope | team leave calendar |

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
| 2 | Employee management, Employee 360 | `modules/employees` | **P1 done** — CRUD, 360, history, status machine, re-hire, 31 API tests |
| 1 | Dashboard (14 metrics, 7 quick actions) | `modules/dashboard` | **P1 done, P2/P5 extended** — real MongoDB data, 60s cache; only P6 onboarding + P4 document-generation metrics remain honestly `null` |
| 3 | Recruitment | `modules/recruitment` | P6 |
| 4 | Onboarding | `modules/onboarding` | P6 |
| 5 | Attendance | `modules/attendance` | **P5 done** — ledger, daily/monthly grid, corrections, holidays, nightly job, 15 API tests |
| 6 | Leave | `modules/leave` | **P5 done** — types, balances, requests, calendar, optimistic locking, 19 API tests |
| 7 | Documents (upload, versions, PDF templates) | `modules/documents` | **P4 done** — secure storage, versions, Handlebars, PDFKit, 17 API tests |
| 8 | Hardware / assets | `modules/assets` | **P2 done** — CRUD, assign/return/repair/retire, history, overdue, 26 API tests |
| 9 | Software / licences / access | `modules/licenses`, `modules/access` | **P2 done** — CRUD, atomic seats, revoke/renew/suspend/expire, utilization, audited reveal, 32 API tests |
| 10 | Exit / offboarding | `modules/exit` | **P3 done** — lifecycle, checklist, clearances, guarded relieve, force-relieve, 24 API tests |
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
| **P1** | departments, employees, Employee 360, status machine, dashboard | complete — backend, 38 API tests, frontend, verified |
| **P2** | assets, licences, seats, access items, transactions | complete — backend, 58 API tests, frontend, verified below |
| **P3** | exit, checklist, clearances, relieve guard, force-relieve | complete — backend, 24 API tests, frontend, verified |
| **P4** | documents, secure serving, versions, PDF templates | complete — backend, 17 API tests, frontend, verified |
| **P5** | attendance, corrections, leave, balances, nightly jobs | complete — backend, 34 API tests, frontend, verified |
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

`/ready` is bounded to ~3s per dependency and answers **503** rather than
hanging if a probe stops responding, because neither driver bounds an in-flight
command on a half-open socket. See `docs/DECISIONS.md` D-19.

---

## 14. Documentation

- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — design decisions, rationale, and
  known gaps carried into later phases
- [`AGENTS.md`](./AGENTS.md) — the implementation contract