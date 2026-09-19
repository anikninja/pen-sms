# Running the Cloudflare architecture locally

Everything here runs on your machine: the Worker in `wrangler dev` (workerd), D1 and R2 as local simulations in `worker/.wrangler/state`, and Next.js with `DATA_BACKEND=worker`. **It needs no Cloudflare account, no PostgreSQL and no production credentials.**

```
Browser → Next.js :3000 (DATA_BACKEND=worker) → Worker :8787 (wrangler dev) → local D1 + local R2
```

## 1. Prerequisites

- Node.js 22 and npm.
- Git.
- Nothing else: `wrangler` (with workerd) is a dependency of `worker/`.

## 2. Install

```sh
npm ci                      # the app; also generates both Prisma clients (postinstall)
npm ci --prefix worker      # the Worker: wrangler, @prisma/adapter-d1
```

## 3. Environment

**Worker secrets.** Copy `worker/.dev.vars.example` to `worker/.dev.vars` (git-ignored) and set:

```sh
WORKER_INTERNAL_SECRET="<at least 32 random characters>"
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**App settings.** Set these in `.env` for Next.js (git-ignored; template: `.env.example`):

```sh
DATA_BACKEND="worker"
WORKER_API_URL="http://127.0.0.1:8787"
WORKER_INTERNAL_SECRET="<the same value as in worker/.dev.vars>"
AUTH_SECRET="<any long random string>"   # Auth.js session cookies
DEMO_MODE="true"                          # shows the demo accounts on the login page (local only)
```

`DATABASE_URL` is not used with `DATA_BACKEND="worker"`.

**Allowed origin.** The Worker accepts browser uploads only from `ALLOWED_ORIGINS` (`http://localhost:3000` in `worker/wrangler.jsonc`), so run Next.js on port 3000.

## 4. Create, migrate and seed the local D1 and R2

```sh
npm --prefix worker run db:migrate:local   # applies prisma/d1/migrations/*.sql (wrangler d1 migrations apply --local)
npm --prefix worker run db:seed:local      # demo data through @prisma/adapter-d1, plus the seed PDFs in local R2
npm --prefix worker run db:migrations:list:local
```

- **Seed:** it is idempotent, and every account's password is `Password123!`.
- **Accounts:** the staff account is `registry@pensms.test`; each student signs in with their student email, e.g. `rahim.uddin@student.pensms.test`.

## 5. Start the Worker

```sh
npm --prefix worker run dev                # http://127.0.0.1:8787
curl http://127.0.0.1:8787/health          # {"status":"ok","d1":"ok","schema":{"ok":true,…}}
```

Every other Worker endpoint needs a request signed by the Next.js server; see [worker/API.md](../worker/API.md).

## 6. Start Next.js

```sh
npm run dev                                # http://localhost:3000, reads .env
# or the production build:
npm run build && npm run start
```

Sign in at http://localhost:3000/login. Uploads go from the browser straight to the Worker (5-minute signed URL), and downloads redirect to it (60-second signed URL).

## 7. Tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Unit tests, including the D1 services on a throwaway SQLite file | — |
| `npm run test:worker` | Worker integration tests: real workerd, local D1 and R2, and the Next.js data layer against the real Worker | `npm ci --prefix worker` |
| `npm run test:e2e:cloudflare` | The whole stack end to end (see below) | `npm ci --prefix worker` |
| `npm run lint`, `npx tsc --noEmit`, `npm --prefix worker run typecheck` | Lint and types | — |
| `npm run test:e2e` | The same API suite against the **PostgreSQL** path (`DATA_BACKEND=postgres`) | A running app with a freshly seeded PostgreSQL database |

**`npm run test:e2e:cloudflare`** (`scripts/e2e-cloudflare-local.mjs`) runs these steps:
1. Creates a **throwaway** local D1 and R2 in a temporary directory; your `worker/.wrangler/state` is not touched.
2. Migrates it with Wrangler and seeds it through the adapter.
3. Builds and starts Next.js (`DATA_BACKEND=worker`, port 3100) and the Worker (port 8787), with a fresh random secret for this run only. `DATABASE_URL` points at an unreachable host, so any PostgreSQL access would fail the run.
4. Runs `scripts/e2e-api.mjs` with `E2E_BACKEND=worker`.
5. Simulates a Worker outage: the app must answer with a safe error.
6. Runs `worker/scripts/check-consistency.ts`: no orphaned records, no duplicate Student IDs, no negative balances, exact money totals, R2 objects equal to the submissions' files.

Options: `-- --skip-build` (reuse `.next`), `-- --perf` (add `scripts/perf-local.mjs`), `-- --keep-state` (keep the temporary D1/R2 and logs).

### What the end-to-end suite covers

| Area | Scenarios |
|---|---|
| Authentication | Sign-in; wrong password and unknown email refused; tampered or expired session cookie → 401; sign-out clears the cookie; each role only in its own area (401/403) |
| Students | Create (next Student ID, tariff fee, login); view; search by name and ID, case-insensitive; filters; update (Student ID and fee unchanged); duplicate email → 409; validation messages; **10 concurrent enrolments** get consecutive IDs |
| Programmes | Programme filter, and the tariff (programme fee) copied at enrolment and on re-assignment. The app has no screens or API to create or edit programmes; they are reference data from the seed |
| Fees and payments | Assign from tariff or manually; balances exact to the paisa; overpayment and duplicate reference rejected; payments with no fee; **5 concurrent payments** never exceed the fee; **5 concurrent fee changes** leave one fee, never below what was paid |
| Assessments and results | Create (past-deadline warning), validation, close, programme locked once there is work; grades 0–100 in whole numbers; re-grade; publish and withhold per result, per student and per assessment; students see published results only |
| Files | Multipart upload through Next.js; direct browser-style upload to the Worker; upload URL bound to the declared file; replacement before the deadline, refused after it; late first submission; type and 5 MB checks; download (redirect → R2); another student's file → 404; signed-out download → 401 |
| Errors | Validation, not found, duplicate, unauthorized, forbidden, and a database/Worker failure (outage step) |

### Local results (19 Sep 2026)

- **Cloudflare stack:** `npm run test:e2e:cloudflare -- --perf`. The e2e suite passed 120 of 120, the outage checks passed 4 of 4, and the consistency checks passed 19 of 19.
- **PostgreSQL path:** the same suite (`E2E_BACKEND=postgres`) passed 115 of 115 against a throwaway PostgreSQL database. The PostgreSQL run skips the 5 direct-upload checks, which exist only with the Worker.

## 8. Performance sanity

`npm run test:e2e:cloudflare -- --skip-build --perf`. Sequential requests, one machine; medians in milliseconds:

| Operation | Median | p95 |
|---|---|---|
| Sign-in (bcrypt in Next.js + Worker lookup) | 112 | 128 |
| Worker `GET /health`, direct | 18 | 70 |
| `GET /api/students` (session + list: 2 Worker calls) | 80 | 124 |
| `GET /api/students/:id/fees` | 139 | 160 |
| `/staff/dashboard` page (server render) | 124 | 4177* |
| `/staff/students/:id` page | 164 | 272 |
| Record a payment | 64 | 990* |
| Upload 1 MB (upload URL + direct PUT) | 235 | 338 |
| Download signing (`/api/files/:id` → 302) | 78 | 114 |
| Download 1 MB end to end | 116 | 135 |

\* The first request to each route warms up the Next.js route and the Worker isolate. Production adds Vercel ↔ Cloudflare network time and cold starts. Each Next.js request costs one Worker call for the session plus one for the page's data.

## 9. Reset and clean up

```sh
# Stop wrangler dev and Next.js first (Ctrl+C).
rm -rf worker/.wrangler/state            # local D1 + R2 (PowerShell: Remove-Item -Recurse -Force worker\.wrangler\state)
npm --prefix worker run db:migrate:local
npm --prefix worker run db:seed:local
```

`npm run test:e2e:cloudflare` cleans up after itself, and keeps its temporary directory only when a step fails or with `--keep-state`.

## Known limitations (local)

- **Local D1 and R2 are simulations** (Miniflare/workerd). Cloudflare's CPU limits, network latency and D1 replication are not reproduced; measure them in Phase 8.
- **Sign-out is client-side.** Auth.js JWT sessions are stateless: sign-out deletes the cookie, but a copied session cookie stays valid until it expires (8 hours). This is unchanged from the PostgreSQL app.
- **Multipart API uploads.** `POST /api/assessments/:id/submissions` forwards the file through Next.js; on Vercel that route is limited to 4.5 MB per request. The app's own upload form, and API clients using `…/submissions/upload-url`, send files straight to the Worker and are not affected.
