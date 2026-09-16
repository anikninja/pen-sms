# Build Progress

Phase tracker for the Registry module. Phases and checklists come from
[prompt.md](prompt.md) §7; the domain spec is [architecture.md](architecture.md).
Requirement traceability against the assessment brief is in architecture.md §1.1.
Update this file at every phase boundary.

| Phase | Status |
|---|---|
| 0 — Foundation | ✅ Done |
| Auth — Sign-in and role separation | ✅ Done (added 2026-09-16, see below) |
| 1 — Domain + seed | 🟡 Seed partly done (enrolment data + accounts) |
| 2 — Services + actions + JSON API | ⬜ Not started |
| 3 — Staff UI | 🟡 App shell + dashboard (partial) |
| 4 — Student UI | 🟡 App shell + dashboard (partial) |
| 5 — Quality | ⬜ Not started |
| 6 — Submission | ⬜ Not started |

---

## Phase 0 — Foundation

- [x] Next.js app scaffolds and runs (Next 16.3.5, React 19.2.8)
- [x] Postgres reachable; `DATABASE_URL` in `.env`; `.env.example` committed
- [x] `.env` is gitignored
- [x] Final schema in `prisma/schema.prisma` (revised after the requirements review)
- [x] `prisma migrate dev --name init` succeeds → `20260915195504_init`
- [x] Prisma Studio visual check of all 8 tables (`npx prisma studio` → http://localhost:5555)

### Verified on 2026-09-16

- `prisma validate`: schema valid; `prisma migrate status`: database up to date
- Tables (8): `Programme`, `ProgrammeFee`, `StudentFee`, `Student`, `Payment`, `Assessment`, `Submission`, `Result`
- Enum `EnrolmentStatus`: `ENROLLED, DEFERRED, WITHDRAWN, COMPLETED`
- 33 indexes (primary keys, unique constraints, secondary indexes)
- Money columns are `numeric(12,2)`
- Delete rules:
  - `StudentFee.programmeFeeId → ProgrammeFee`: `SET NULL` (deleting a tariff keeps assigned fees)
  - `StudentFee.studentId → Student`: `CASCADE`
  - `Student.programmeId`, `Assessment.programmeId → Programme`: `RESTRICT`
  - `Payment`, `Submission`, `Result → Student/Assessment`: `CASCADE`

---

## Auth — Sign-in and role separation (2026-09-16)

Design: architecture.md §27 · build rules: prompt.md §3.3.

### Done

- [x] `Role` enum (`STAFF`, `STUDENT`) and `User` model → migration `20260916154537_add_user_auth`
- [x] Database CHECK: STAFF has no `studentId`, STUDENT always has one (`User_role_student_link_check`)
- [x] Auth.js (next-auth `5.0.0-beta.32`, pinned) with Credentials provider and bcrypt — `src/auth.ts`
- [x] `getSession()` / `requireStaff()` / `requireStudent()` — `src/lib/auth/session.ts`
      (role and student link re-read from the database on every request)
- [x] `src/proxy.ts` — optimistic gate for `/staff/*` and `/student/*`
- [x] Login page with server-side Zod validation and a single generic error — `src/app/login`
- [x] Sign out from the sidebar user menu
- [x] Role-guarded layouts: `(staff)/staff/layout.tsx`, `(student)/student/layout.tsx`
- [x] Staff dashboard (live counts + recently added students) and student dashboard (own enrolment record)
- [x] `/` redirects to the role's dashboard or `/login`
- [x] Seed (idempotent): 2 programmes, 2 tariffs, 6 students with assigned fees, 6 student logins, 1 staff login
- [x] `AUTH_SECRET` and `DEMO_MODE` in `.env`; `.env.example` documents every variable

### Verified on 2026-09-16

Against `next build` + `next start`, driven with curl and a cookie jar:

| Check | Result |
|---|---|
| Signed out: `/`, `/staff/dashboard`, `/student/dashboard` | 307 → `/login` |
| Wrong password / unknown email | No session cookie; same "Invalid email or password." |
| Login form (server action, no JS): invalid email + empty password | Field errors shown, no cookie |
| Login form: correct staff credentials | 303 → `/`, session cookie set |
| Email is case-insensitive (`REGISTRY@…`) | Signs in |
| Staff → `/student/dashboard` · `/login` | 307 → `/staff/dashboard` |
| Student → `/staff/dashboard` | 307 → `/student/dashboard` |
| Staff dashboard | 200, live student rows from Postgres |
| Student dashboard (Rahim, SMS-2026-0002) | 200, only his own record; no other student's name or ID in the HTML |
| Account deleted while cookie still valid | Locked out at once (307 → `/login`); `/login` returns 200, no redirect loop |
| `logoutAction` | Session cookie cleared, redirect to `/login`; dashboard then 307 → `/login` |
| `npm run db:seed` twice | Same counts both times |
| `npm run build` | Passes (it had failed type-checking since `prisma.config.ts` was added) |

Not tested in a real browser: clicking Sign out in the sidebar menu (the action itself was verified
above) and the responsive layout.

### Demo accounts

Password for all: `Password123!`

| Role | Email |
|---|---|
| Staff | `registry@pensms.test` |
| Student (SMS-YYYY-0002, default demo) | `rahim.uddin@student.pensms.test` |
| Other students | `nusrat.jahan`, `abir.hossain`, `tanvir.ahmed`, `farhana.akter`, `sadia.islam` — each `@student.pensms.test` |

### Cleanup done alongside

- Removed the shadcn `dashboard-01` demo: `/dashboard` route with mocked `data.json`,
  `chart-area-interactive`, `data-table`, `section-cards`, `nav-documents`, `nav-secondary`,
  `ui/chart.tsx`, `public/placeholder.svg`.
- Uninstalled packages only that demo used: `recharts`, `@dnd-kit/*`, `@tanstack/react-table`.
- **Correction:** `cn` is *not* stray. shadcn init chose it (class merging, replaces clsx +
  tailwind-merge) and every `ui/*` component uses it. Kept.
- `prisma.config.ts` was written for a newer Prisma and failed type-checking on 6.12
  (`engine`, `datasource` unknown; `earlyAccess: true` required). Rewritten for 6.12, and the CLI was
  re-checked (`migrate status`, seed).
- Seed wiring: `package.json` → `prisma.seed` works with `prisma.config.ts` on 6.12 (open question closed).
- `.env.example` uses `#` comments.

### Known limitations (by design, architecture.md §27.6)

No registration, password reset, rate limiting or account lockout. Staff cannot yet create a login
for a new student (planned in the Phase 2 student service).

---

## Open items

- `src/hooks/use-mobile.ts` (shadcn-generated) fails `react-hooks/set-state-in-effect` lint.
  Doesn't block the build. Fix with `useSyncExternalStore`.
- Install `date-fns`, `vitest`, `@vitejs/plugin-react`; add a `test` script.
- Seed: payments, assessments, submissions, results (prompt.md §8).
- `next.config.ts`: set `serverActions.bodySizeLimit: "6mb"` (top-level in Next 16).
- Create `storage/uploads/.gitkeep` and gitignore the uploads.
- API routes (Phase 2) must return `401`/`403` from `getSession()` instead of redirecting.

---

## Decision & documentation log

### 2026-09-16 — Real sign-in instead of a role toggle

The brief allows a simple role toggle. We chose Auth.js email + password so that "students see only
their own data" depends on who is signed in, not on a switch anyone can flip.
Recorded in architecture.md §27 and prompt.md §3.3 (the old cookie-toggle rule was replaced).
Schema impact: +1 enum (`Role`), +1 model (`User`), added as a second migration.

### 2026-09-16 — Requirements review against the assessment brief

Re-checked the brief line by line. Gaps found and fixed in both architecture.md (§1.2) and
prompt.md (which overrides architecture.md on conflict):

| # | Gap | Change |
|---|---|---|
| 1 | Fee was derived live from the tariff; no in-app "assign fee"; tariff edits would rewrite paid balances | New `StudentFee` (snapshot at enrolment, staff-adjustable) |
| 2 | Assessments not linked to a programme | `Assessment.programmeId` |
| 3 | No "open assessment" state | `Assessment.isOpen` (staff-controlled) |
| 4 | prompt.md allowed resubmission at any time; brief says before the deadline | Replacement after deadline rejected; first late submission still accepted |
| 5 | No per-student publish/withhold | Per-student marksheet publish/withhold |
| 6 | prompt.md removed API routes; brief grades "working API routes" | JSON API over the shared service layer (architecture.md §17.1) |
| 7 | Non-enrolled students could submit / count as pending | Only ENROLLED students of the programme |

Schema impact: +1 model (`StudentFee`), +2 columns on `Assessment`. The first `init` migration was
uncommitted and the database was empty, so it was regenerated as a single `init` instead of
adding a second migration.

The brief PDF is marked "for recruitment purposes only, do not distribute", so it is **not
committed**. architecture.md §1.1 paraphrases its requirements.

### 2026-09-16 — Documentation committed

- `architecture.md` and `prompt.md` are committed instead of gitignored.
- architecture.md §15 ERD replaced with a Mermaid `erDiagram` (renders on GitHub); it includes the
  previously missing `Student → Result` edge. §37 stray citation artifact removed.
