# Implementation Decisions

Living record of decisions taken while building the Harvik Technologies HR
system against `AGENTS.md`. Every entry states what was decided, why, and what
it costs.

Format: **D-nn — title** · *Status* · *Phase*

---

## D-01 — TypeScript compiled to CommonJS

*Status: accepted · P0*

The API is written in TypeScript (`apps/api/tsconfig.json`) and emitted as
**CommonJS**. ESM output would require explicit `.js` extensions on every
relative import across roughly 40 files, which is an easy source of
`ERR_MODULE_NOT_FOUND` failures in the built `dist/` and in the seed entrypoint
that Compose invokes directly.

Cost: `dist/` is CJS. The frontend is unaffected — Vite serves ESM in the
browser regardless.

## D-02 — `.env.example` ships deliberately invalid secrets

*Status: accepted · P0*

`src/config/env.ts` rejects the literal placeholders `change_me` and
`base64_32_bytes`, and requires `FIELD_ENCRYPTION_KEY` to decode to exactly 32
bytes. A developer who copies `.env.example` to `.env` and runs the stack gets an
immediate, explicit failure listing every offending variable rather than booting
with a guessable signing key.

The test suite satisfies the same validator with real-looking values
(`tests/setup/env-vars.ts`), so this is genuinely exercised, not just asserted.

## D-03 — MongoDB replica set for tests runs a real `mongod`

*Status: accepted · P0*

`AGENTS.md` §3 requires MongoDB Community 7.x as a single-node replica set named
`rs0` because exit processing, licence seat assignment and asset assignment
history need transactions. Docker was unavailable during development, so the
test suite starts a real `mongod` 7.0.14 binary via `mongodb-memory-server`
(`tests/setup/global-setup.ts`). This is a genuine replica set — transactions are
real, not simulated.

Production Compose runs the same topology (`mongo:7.0.14` with
`--replSet rs0` plus a one-shot `rs-init` service), so the test and production
database semantics match.

## D-04 — Redis is an in-memory double by default, real Redis 7 in `npm run test:docker`

*Status: gap closed · P0*

Originally Redis was *only* an in-memory double, because Redis publishes no
Windows build and `rate-limit-redis` needs Lua evaluation (`EVALSHA`) that
`ioredis-mock` cannot perform. Docker/WSL are now available on the development
machine, so the gap is closed by running the **same suites** a second time
against the compose services:

```
docker compose up -d mongo rs-init redis
npm run test:docker          # HR_DOCKER_TESTS=1, vitest.docker.config.ts
```

`HR_DOCKER_TESTS=1` makes `tests/setup/setup.ts` skip the mock entirely (no
`setRedisClient()` call, so `getRedis()` builds a real `ioredis` client from
`REDIS_URL`) and sets `RATE_LIMIT_STORE=redis`. Nothing is skipped and no
assertion is relaxed — 175/175 pass in both modes.

What the default (mock) mode genuinely exercises: refresh-token denylisting,
denylist TTL handling and cache helpers, all of which use plain
`GET`/`SET`/`DEL`/`EXISTS`/`INCR`/`TTL`/`SCAN`/`FLUSHALL`.

What only `npm run test:docker` can exercise, and now does: `rate-limit-redis`
(`RedisStore`) and the BullMQ queue keys. Verified by inspecting Redis during
the run — the six per-IP buckets the rate-limit suite creates
(`ratelimit:login:198.51.100.200`…`205`) are physically present in Redis 7.

`RATE_LIMIT_STORE` (D-16) exists so this is a configuration choice rather than a
`NODE_ENV` side effect. The window, limit, `skipSuccessfulRequests` and the 429
envelope are identical in both stores; only the counter storage differs.

## D-05 — Rate-limit store is swappable, limit is not

*Status: accepted · P0*

`AGENTS.md` §11 mandates 5 login attempts per minute per IP. That number is
compiled into `loginLimiter` and is never relaxed for tests. To keep that limit
honest while testing, tests simulate distinct client IPs through
`X-Forwarded-For` with `TRUST_PROXY_HOPS=1` — which is also how the API is
actually deployed (one nginx hop in front of it).

The alternative — raising the limit under `NODE_ENV=test` — was rejected: it
would make the suite pass while proving nothing about production behaviour.

## D-06 — Permissions are the RBAC primitive; roles are the mapping

*Status: accepted · P0*

`src/config/constants.ts` defines a capability list (`PERMISSIONS`) and a single
role → capability table (`ROLE_PERMISSIONS`). Two guards consume it:
`requireRoles(...)` for coarse role checks and `requirePermission(...)` for
capability checks.

`requirePermission` is preferred for HR operations because "HR Manager may run
exit processing but may not delete employees" is expressed as data rather than
repeated in route definitions. Role checks remain available where a whole
surface is genuinely restricted to one role.

The `permissions` array returned to the client is **advisory only**. It exists so
the UI can hide controls the caller would be refused. Every request re-reads the
account and re-evaluates permissions server-side; a test asserts that posting
`{ "role": "HR Admin" }` in a request body changes nothing.

## D-07 — Employee self-service needs no elevated capability

*Status: accepted · P0*

`ROLE_PERMISSIONS['Employee']` is an empty list. "View my own profile", "view my
own leave", "view my own assets" are not privileges to be granted — they are the
default surface, gated by ownership checks on the record itself.

This means an Employee session advertises `permissions: []`. The list is empty
because nothing needs granting, not because the account is inert. Requiring a
`viewSelf` capability would have meant inventing a permission that every role
either has or that no route enforces.

## D-08 — Soft-delete and audit fields are on every collection by default

*Status: accepted · P0*

`createdAt`, `updatedAt`, `createdBy`, `isDeleted` are defined once in a shared
schema helper rather than repeated per model, because `AGENTS.md` §7 requires
them on every major document and omission is the easiest requirement to forget.

Audit records are written through a single `recordAudit()` helper that
redacts sensitive fields and **never throws**: an audit-write failure is logged
and swallowed so a full audit collection cannot take down the request that
triggered it. Audit durability is a monitoring concern, not a request-path
concern.

## D-09 — Field-level encryption is AES-256-GCM with an explicit version prefix

*Status: accepted · P0*

`src/utils/crypto.ts` produces `v1:<iv>:<authTag>:<ciphertext>`, all base64url.
The `v1` prefix exists so the scheme can be rotated later without a flag day: a
future `v2` can be introduced and decrypted transparently.

`FIELD_ENCRYPTION_KEY` must be exactly 32 bytes after base64 decoding; the
validator also rejects non-canonical base64 so a typo fails loudly rather than
producing a silently different key.

Bank details and licence keys are encrypted at rest. Normal list responses must
mask them; that masking is implemented in the P2/P4 modules that own those
fields, and the utility plus a "never logged" test exist now.

## D-10 — `createApp({ beforeNotFound })` test seam

*Status: accepted · P0*

`AGENTS.md` §14 requires RBAC acceptance tests, but P0 exposes only the auth
routes — inventing production endpoints like `DELETE /employees` just to test a
guard would be fake functionality, which §19 forbids.

Instead `createApp` accepts an optional `beforeNotFound` callback, mounted after
the API router and before the 404 handler. `tests/integration/rbac-api.test.ts`
uses it to register guarded probe routes that run through the **real** stack —
helmet, CORS, HPP, NoSQL sanitisation, rate limiting, the guards themselves and
the error handler. The middleware under test is production code; only the routes
are test-local.

## D-11 — P0 API surface is deliberately tiny

*Status: accepted · P0*

P0 serves `/health`, `/ready` and `/api/v1/auth/{login,refresh,logout,me,change-password}`.
No `/employees`, no `/dashboard/summary`, no Employee 360. Those are P1+ and must
read real data — shipping placeholder endpoints or a dashboard with mock numbers
would violate both the phase plan and the "no fake functionality" rule.

The frontend therefore contains a login screen and an authenticated shell that
says the foundation is ready. It does not render invented metrics.

## D-12 — Seed scope matches the phase that owns each fixture

*Status: accepted · P0*

`AGENTS.md` §12 asks for ~25 employees, assets, licences, candidates, document
templates and an exit fixture. P0 seeds what the foundation can legitimately
own: 5 departments, 11 employees across all five employment types, a reporting
hierarchy three levels deep, and the four demo logins.

The rest (assets, licences, candidates, holidays, attendance, exit fixture) is
seeded by the phase that implements those modules, so fixtures always match real
schema constraints. Codes restart at `HRV-0001` on every run because
`runSeed({ reset: true })` clears the counters collection — that makes the seed
idempotent and deterministic, which is testable; the alternative is not.

Demo credentials are documented in `README.md`, never printed by the seed and
never logged (§2.16).

## D-13 — Malformed JSON is a 400, not a 500

*Status: accepted · P0*

`body-parser` raises a plain `Error` carrying `status` and
`type: 'entity.parse.failed'`. Without explicit handling it fell through the
error handler's generic branch and returned 500, which `AGENTS.md` §10
contradicts (400 for validation failures). `isBodyParserError()` now recognises
the `entity.*` family and maps it to
`VALIDATION_ERROR` / 400.

## D-14 — Per-test client IPs, not a relaxed limiter

*Status: accepted · P0*

See D-05. Suites that deliberately fail logins would otherwise exhaust the shared
127.0.0.1 bucket and starve unrelated tests with `RATE_LIMITED`, which is exactly
what happened before `TRUST_PROXY_HOPS` was set to 1. The limiter stayed at
5/min/IP; the tests learned to vary their source address.

## D-15 — Docker Compose is the primary deployment path; PM2 is secondary

*Status: accepted · P0*

`AGENTS.md` §2.12 mandates `docker compose up --build`. `deploy/ecosystem.config.js`
exists because §4 lists it in the required repository structure, for single-host
deployments that cannot run containers. Both run the same compiled `dist/` and
read the same `.env`, so the refresh-token secret and `FIELD_ENCRYPTION_KEY` stay
consistent across API and worker.

---

## D-16 — `RATE_LIMIT_STORE` makes the store an explicit configuration choice

*Status: accepted · P0*

`src/middleware/rateLimit.ts` used to branch on `NODE_ENV === 'test'` alone. That
couples "which store" to "how the process was invoked", which makes the
production `RedisStore` path impossible to run under a test runner.

`RATE_LIMIT_STORE` (`auto` | `memory` | `redis`, default `auto`) replaces that
implicit coupling. `auto` resolves to `memory` under `NODE_ENV=test` and `redis`
everywhere else, so **every deployment keeps exactly the previous behaviour**.
`redis` / `memory` exist only so a test run can force one store; `npm run
test:docker` uses `redis` (D-04).

This cannot be used to weaken §11: the limit (5/min/IP), the 60s window, the
draft-7 headers and the 429 envelope are compiled into `loginLimiter` and are
identical for both stores. Only where the counter lives differs.

## D-17 — BullMQ queue names must not contain a colon

*Status: accepted · P0*

BullMQ builds its Redis keys as `bull:<queueName>:...` and therefore **rejects**
a queue name containing `:` at `Worker` construction time:

```
Error: Queue name cannot contain :
```

Because P0 had no Redis server, this was invisible until the worker was first run
against real Redis 7 — where it crash-looped on every start, because
`MongoDB connected` was logged immediately before the throw. The names in
`src/jobs/queues.ts` are now hyphen-separated (`harvik-maintenance`).

`tests/unit/queues.test.ts` locks this in without needing Redis: it asserts no
name contains `:` *and* constructs a real `Queue` for each name, which is the
exact call that used to throw.

## D-18 — nginx resolves the API upstream per request, not once at boot

*Status: accepted · P0*

The original `deploy/nginx.conf` used `proxy_pass http://api:4000`. nginx resolves
a literal upstream host **once, at configuration load**, and caches the address
for the life of the process. A container's IP changes whenever it is recreated,
so after `docker compose up -d --build` replaced the `api` image, nginx kept
proxying to the dead address and returned **502** until it was itself restarted —
even though the container reported healthy.

Fixed with Docker's embedded resolver and a variable upstream:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
set $api_upstream http://api:4000;
proxy_pass $api_upstream;
```

Using a variable is what forces per-request resolution. The variable carries no
URI component, so the original request URI is forwarded exactly as before.

Verified by detaching the `api` container from the network and reconnecting it
so it took a different address: nginx followed the new IP and served traffic
within the `valid=10s` window **without being restarted**. The same test also
showed the fix is honest rather than permissive — while the `api` DNS name was
genuinely absent, nginx correctly returned 502 instead of silently using a
cached address.

## D-19 — Readiness probes are bounded so `/ready` cannot hang

*Status: accepted · P0*

Found by the Docker verification in D-18: after the API container's network was
replaced, `GET /ready` stopped responding entirely — `/health` still returned
200 while `/ready` never replied at all, and nothing was written to the log.
Through nginx that surfaced as **504 Gateway Time-out**.

`describe()` guarded each probe with a `readyState` check, but that is not
sufficient: a driver only notices a dropped socket the next time it *uses* it, and
reports itself connected until then. Once inside the probe, both clients can
block forever:

- mongoose sets no `socketTimeoutMS` (0 = no timeout), and
  `serverSelectionTimeoutMS: 10_000` governs only *initial* server selection, so
  an `admin().ping()` over a dead socket never returns.
- ioredis is built with `enableOfflineQueue: true` and
  `maxRetriesPerRequest: null`, so `PING` on a dead connection is queued
  indefinitely rather than rejected.

Each probe is now raced against a 3s timer (`PROBE_TIMEOUT_MS`) and a timeout is
reported as `error: 'timeout'`, so `/ready` returns **503 quickly** instead of
hanging. The timer is `unref`'d so a probe cannot hold the event loop open, and
the sentinel is a `Symbol` rather than an `Error` subclass because `instanceof`
is unreliable when the TypeScript target downlevels `class extends Error`.

This makes `/ready` match its contract in AGENTS.md §11: a verdict, not a hang.
`tests/integration/health.test.ts` pins it with a client whose `PING` never
settles. That test was confirmed non-vacuous — with the bound removed it hangs
until vitest kills it at 60s.

Not changed: `socketTimeoutMS` on the application connection. Bounding *every*
query would alter request semantics well beyond P0's remit; the readiness probe
is the endpoint whose contract is "report a verdict".

## D-20 — The API image must not copy `apps/api/node_modules`

*Status: accepted · P0*

`apps/api/Dockerfile` copied the workspace's `node_modules` into the runtime
stage:

```dockerfile
COPY --from=build /repo/apps/api/node_modules ./node_modules   # removed
```

That path never exists. `npm ci --workspace=@harvik/api` performs a workspace
install, which **hoists** dependencies to the repository root
(`/repo/node_modules`) and leaves the workspace directory with at most a
`node_modules/.bin` stub. The build therefore failed outright once Docker was
available.

The copy is unnecessary as well as broken: Node resolves modules by walking up
the directory tree, and `dist/server.js` lives at `/repo/apps/api/dist/`, so the
root tree is already in scope. Only the root `node_modules` is copied.

## D-21 — The worker needs its own healthcheck, not the API's

*Status: accepted · P0*

`worker` is built `FROM` the API image, so it inherited the API image's
`HEALTHCHECK`, which curls `/ready` on port 4000. `src/worker.ts` runs **no HTTP
server** — AGENTS.md §4 gives it no such requirement — so the probe could only
ever fail. The worker would have been reported `unhealthy` while doing its job
perfectly, which in most orchestrators means a restart loop.

`docker-compose.yml` now overrides it with a probe of what the worker actually
depends on: an ioredis `PING`. Both are real failure signals for this process,
and the worker cannot do anything at all without Redis.

The override deliberately does **not** also check for the
`bull:harvik-maintenance:repeat*` keys, even though those exist and would have
looked like a stronger check. They are written once at boot, so a Redis
`FLUSHALL` — which `npm run test:docker` performs — deletes them permanently
while the worker keeps running perfectly. Docker does **not** restart a
container that is merely `unhealthy` (only one that exits), so probing those keys
wedged the worker indefinitely until a manual restart. That failure mode was hit
for real during this verification and is exactly the kind of state a healthcheck
must never create.

Nothing is lost by dropping them: `bootstrap()` `await`s the `add` and the
`catch` calls `process.exit(1)`, so a failed registration already terminates the
process, and `restart: unless-stopped` *does* act on an exited container. The
process-exit path is the correct signal for "could not register"; the healthcheck
is for "is the dependency reachable".

Keeping the inherited HTTP probe "just in case" would have been worse than
useless: a worker that cannot serve HTTP must not be probed over HTTP.

---

## Known gaps carried into later phases

| Gap | Why | Owner |
| --- | --- | --- |
| ~~`docker compose build` / `up` not executed~~ | **CLOSED (P0).** WSL2 + Ubuntu installed, Docker Engine 29.8.2 running. Full stack builds and starts; MongoDB 7.0.14 `rs0` reaches PRIMARY with working commit *and* rollback transactions, Redis 7.4.11 ready, `/ready` reports both, nginx serves the SPA and proxies `/api`, seed runs in-container. Building and running it surfaced four latent defects — D-17, D-18, D-19, D-20 — plus the bogus worker healthcheck (D-21). | Closed |
| ~~BullMQ worker unexercised~~ | **CLOSED (P0).** Worker connects to Redis 7 and is healthy. Functionally proven, not just registered: a job enqueued from a separate process was consumed cross-container, executed and completed (`attempts made: 1`; the handler's return-value timestamp matches the worker log line to the millisecond). | Closed |
| ~~`rate-limit-redis` store unexercised~~ | **CLOSED (P0).** `npm run test:docker` runs the same 176 tests with `RATE_LIMIT_STORE=redis` against Redis 7 (D-04, D-16). Beyond the suite, the 5/min/IP limit, `skipSuccessfulRequests` and per-IP isolation were each measured against the live RedisStore through nginx, with the resulting per-IP bucket keys observed in Redis. | Closed |
| ~~`/ready` could hang instead of answering~~ | **CLOSED (P0).** Probes are bounded (D-19); verified live by stopping MongoDB — 503 in 4–85 ms, `/health` unaffected. | Closed |
| 403 over HTTP through the compose stack | **P0 ships no role-gated route.** Every P0 route is mounted with `requireAuth`; `requireRoles`/`requirePermission` are implemented but unused until P1 adds business routes. So 403 is structurally unreachable from the container — not weak, just not yet reachable. Enforcement is covered by `rbac-api.test.ts` (19 tests) against the real middleware. | P1 — re-verify over HTTP once the first guarded route exists |
| Bank/licence field masking in list responses | The modules that own those fields are P2/P4 | P2, P4 |
| Manager team scoping (recursive, depth 5) | Needs the employees module | P1 |
| Playwright E2E specs | P8 deliverable; the web workspace has no unit-test runner yet | P8 |