# Data boundary: PostgreSQL or the Cloudflare Worker

The Next.js app reads and writes data only through `src/lib/data` (`data()`). The `DATA_BACKEND` environment variable chooses the implementation:

| `DATA_BACKEND` | Implementation | Data | Files | Credentials in Next.js |
|---|---|---|---|---|
| `worker` | `src/lib/data/worker.ts` | Cloudflare D1, through the Worker API ([worker/API.md](../worker/API.md)) | Private R2, through Worker-signed URLs | `WORKER_API_URL`, `WORKER_INTERNAL_SECRET` (server-only). **No database credentials** |
| `postgres` | `src/lib/data/postgres.ts` | PostgreSQL through Prisma (the original path) | Local disk (`storage/uploads`) | `DATABASE_URL` |

- **Explicit choice.** Unset means `postgres` for local development and CI only. On Vercel an unset value is an error, never a silent fallback. There is also no runtime fallback from one backend to the other.
- **Lazy loading.** Only the selected implementation is loaded, so a Worker deployment never creates a PostgreSQL client. This was verified with `DATABASE_URL` pointing at an unreachable host: every flow still worked.
- **Page-shaped reads.** Each page makes one Worker request for its data (`getStudentPage`, `getAssessmentPage`, `getResultsPage`, …), plus the cached session lookup that every page makes.
- **Response validation.** Responses are checked against `src/lib/data/contract.ts`, which turns ISO date strings back into `Date`s. `worker/test/next-data-layer.test.ts` runs every method against the real Worker.

## Request flow (Worker backend)

```
Browser ──cookie──► Next.js (Server Component / Server Action / API route)
                      │  getSession(): Auth.js JWT → user id → GET /v1/session (role, student link from D1)
                      │  data().<operation>: signed request for that user id (60 s, bound to the request)
                      ▼
                    Worker ──► D1 / R2
```

- **Sign-in:** Auth.js `authorize()` calls `data().findLoginAccount(email)`, a service call without a user, and runs `bcrypt.compare` in Next.js.
- **New passwords:** hashed in Next.js before `POST /v1/students`.
- **Uploads:**
  1. `requestUploadAction` runs every check on the Worker and returns a 5-minute URL.
  2. The browser PUTs the file straight to the Worker.
  3. `uploadCompletedAction` revalidates the pages that show the submission.

  The multipart API route forwards the file server-side, within Vercel's 4.5 MB limit. API clients can use `POST /api/assessments/:id/submissions/upload-url` for larger files.
- **Downloads:** `/api/files/:id` answers with a 302 to a 60-second Worker URL.

## Environment

| Variable | Backend | Where | Notes |
|---|---|---|---|
| `DATA_BACKEND` | both | server | `worker` or `postgres`. Required on Vercel |
| `WORKER_API_URL` | worker | server | `https://…` (http only for localhost) |
| `WORKER_INTERNAL_SECRET` | worker | server | ≥ 32 random characters. Same value as the Worker's secret |
| `AUTH_SECRET` | both | server | Auth.js session cookies. Unrelated to the Worker secret |
| `DATABASE_URL` | postgres | server | Not needed with `worker` |
| `DEMO_MODE` | both | server | `false` in production |

None of these is `NEXT_PUBLIC_*`. A scan of the built browser bundles (`.next/static`) found neither the secret's value nor any of these names: `WORKER_INTERNAL_SECRET`, `WORKER_API_URL`, `AUTH_SECRET`, `DATABASE_URL`, `passwordHash`, bcrypt or the token-signing code.

## Direct Prisma usage (Phase 6 audit)

Before Phase 6, these files used Prisma or the PostgreSQL services directly:

| File | Direct usage before | Now |
|---|---|---|
| `src/auth.ts` | `prisma.user.findUnique` (sign-in) | **Migrated**: `data().findLoginAccount` |
| `src/lib/auth/session.ts` | `prisma.user.findUnique` (every request) | **Migrated**: `data().loadSession` |
| `src/app/(staff)/staff/results/page.tsx` | `prisma.result.groupBy` + services | **Migrated**: `data().getResultsPage` |
| `src/app/(staff)/staff/*` (8 other pages) | PostgreSQL services | **Migrated**: page views (`getStaffDashboard`, `getStudentsPage`, `getStudentPage`, `getStudentEditPage`, `listProgrammes`, `listFeeOverview`, `getAssessmentsPage`, `getAssessmentPage`) |
| `src/app/(student)/student/*` (4 pages) | PostgreSQL services | **Migrated**: `getMyOverview`, `getMyFees`, `getMyAssessments`, `getMyMarksheet` |
| `src/actions/*.ts` (5 action files) | PostgreSQL services | **Migrated**: `data()` |
| `src/app/api/**/route.ts` (11 routes) | PostgreSQL services | **Migrated**: `data()`. `/api/files` redirects to the Worker |
| `src/components/**` (5 components) | Type-only imports from service modules | **Migrated** to `src/lib/services/shared/*` types (no runtime effect) |
| `src/lib/services/*.ts` (PostgreSQL services) | Prisma | **Kept**: they *are* the PostgreSQL implementation, reached only through `src/lib/data/postgres.ts` |
| `src/lib/prisma.ts` | PostgreSQL client | **Kept**: imported only by the PostgreSQL services and `src/lib/data/postgres.ts` |
| `src/lib/storage/index.ts` | Local disk | **Kept**: the PostgreSQL path's file storage |
| `prisma/seed.ts`, `scripts/e2e-api.mjs` | PostgreSQL seed and e2e | **Kept**: PostgreSQL development and CI |

Check (outside `src/lib/services/` and `src/lib/data/postgres.ts`):

```sh
grep -rnE 'from "@/lib/(prisma|storage"|services/(students|fees|programmes|assessments|results|submissions|dashboard|grading|student-portal|decimal))"|from "@prisma/client"' src \
  | grep -v '^src/lib/services/' | grep -v '^src/lib/data/postgres.ts'
# → only src/lib/prisma.ts itself
```
