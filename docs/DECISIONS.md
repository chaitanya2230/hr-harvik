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

## D-04 — Redis is an in-memory double in tests

*Status: accepted with a known gap · P0*

Redis publishes no Windows build, and Docker/WSL were unavailable on the
development machine. `tests/setup/setup.ts` injects `ioredis-mock` through the
`setRedisClient()` seam in `src/db/redis.ts`.

What is genuinely exercised: refresh-token denylisting, denylist TTL handling,
dashboard cache helpers — all of which use plain `GET`/`SET`/`DEL`/`EXISTS`/
`INCR`/`TTL`/`SCAN`/`FLUSHALL`.

What is **not** exercised: `rate-limit-redis` and BullMQ, both of which require
Lua evaluation (`EVALSHA`) that `ioredis-mock` cannot perform. Consequently
`src/middleware/rateLimit.ts` selects `MemoryStore` when `NODE_ENV === 'test'`
and `RedisStore` otherwise. The window, limit, `skipSuccessfulRequests` and the
429 envelope are identical in both modes, so the rate-limit tests assert
production behaviour; only the backing store differs. See D-11.

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

## Known gaps carried into later phases

| Gap | Why | Owner |
| --- | --- | --- |
| `docker compose build` / `up` not executed | Docker Desktop cannot start on this host: WSL2 absent and the Windows *Virtual Machine Platform* feature is disabled (needs elevation + reboot). Backend log: `engine linux/wsl failed to start: checking preconditions: Virtual Machine Platform not enabled`. `docker compose config` does validate. | Must be run on a Docker-capable host before P0 is signed off |
| BullMQ worker behaviour is unexercised by the suite | No Redis server available for Lua scripts (D-04) | P5/P7 — verify against real Redis 7 |
| `rate-limit-redis` store is unexercised by the suite | Same as above. With no Redis, the app cannot even boot in production mode, because `RedisStore` issues `EVALSHA` during construction | P7 — verify against real Redis 7 |
| Bank/licence field masking in list responses | The modules that own those fields are P2/P4 | P2, P4 |
| Manager team scoping (recursive, depth 5) | Needs the employees module | P1 |