# Build Progress

Live status of the build. Phases follow [architecture.md](architecture.md) §41, which is the single
specification. One-line history: [development_log.md](development_log.md).

**Update this file after every completed piece of work** (architecture.md §2.4).

| Phase | Status |
|---|---|
| 1 — Foundation | ✅ Done |
| 2 — Authentication | ✅ Done |
| 3 — Domain Logic and API | ⬜ Not started |
| 4 — Staff UI | 🟡 App shell + basic dashboard only |
| 5 — Student UI | 🟡 App shell + basic dashboard only |
| 6 — Quality | ⬜ Not started |
| 7 — Submission | ⬜ Not started |

---

## Phase 1 — Foundation ✅

- [x] Next.js app scaffolds and runs (Next 16.3.5, React 19.2.8)
- [x] PostgreSQL reachable; `DATABASE_URL` in `.env`; `.env.example` committed; `.env` gitignored
- [x] Prisma setup (`prisma.config.ts` for Prisma 6.12)
- [x] Final schema → migration `20260915195504_init`
- [x] Prisma Studio visual check of all 8 tables
- [x] Seed: programmes, tariffs, students with assigned fees (architecture.md §28, partial — rest in Phase 3)

### Verified — 2026-09-16

- `prisma validate` passes; `prisma migrate status`: database up to date
- Tables: `Programme`, `ProgrammeFee`, `StudentFee`, `Student`, `Payment`, `Assessment`, `Submission`, `Result`
- Enum `EnrolmentStatus`: `ENROLLED, DEFERRED, WITHDRAWN, COMPLETED`
- 33 indexes; money columns `numeric(12,2)`
- Delete rules:
  - `StudentFee.programmeFeeId → ProgrammeFee`: `SET NULL` (deleting a tariff keeps assigned fees)
  - `StudentFee.studentId → Student`: `CASCADE`
  - `Student.programmeId`, `Assessment.programmeId → Programme`: `RESTRICT`
  - `Payment`, `Submission`, `Result → Student/Assessment`: `CASCADE`
- `npm run db:seed` run twice → same counts

---

## Phase 2 — Authentication ✅

Spec: architecture.md §27.

- [x] `Role` enum + `User` model → migration `20260916154537_add_user_auth`
- [x] Database CHECK: STAFF has no `studentId`, STUDENT always has one (`User_role_student_link_check`)
- [x] Auth.js (`next-auth@5.0.0-beta.32`, pinned) Credentials provider + bcrypt — `src/auth.ts`
- [x] `getSession()` / `requireStaff()` / `requireStudent()` — `src/lib/auth/session.ts` (role re-read from the database every request)
- [x] `src/proxy.ts` — optimistic gate for `/staff/*` and `/student/*`
- [x] Login page: server-side Zod validation, one generic error — `src/app/login`
- [x] Sign out from the sidebar user menu
- [x] Role-guarded layouts and minimal dashboards (staff: live counts + recent students; student: own record)
- [x] `/` redirects to the role's dashboard or `/login`
- [x] Seed: 1 staff login + 6 student logins
- [x] `AUTH_SECRET`, `DEMO_MODE` in `.env`; `.env.example` documents every variable

### Verified — 2026-09-16

Against `next build` + `next start`, with curl and a cookie jar:

| Check | Result |
|---|---|
| Signed out: `/`, `/staff/dashboard`, `/student/dashboard` | 307 → `/login` |
| Wrong password / unknown email | No session cookie; same "Invalid email or password." |
| Login form (server action, no JS): invalid email + empty password | Field errors, no cookie |
| Login form: correct staff credentials | 303 → `/`, session cookie set |
| Email case-insensitive (`REGISTRY@…`) | Signs in |
| Staff → `/student/dashboard` or `/login` | 307 → `/staff/dashboard` |
| Student → `/staff/dashboard` | 307 → `/student/dashboard` |
| Staff dashboard | 200, live rows from PostgreSQL |
| Student dashboard (Rahim, SMS-2026-0002) | 200, only his own record; no other student's name or ID in the HTML |
| Account deleted while cookie still valid | Locked out at once; `/login` returns 200 (no redirect loop) |
| `logoutAction` | Cookie cleared, redirect to `/login` |
| `npm run build` | Passes |

Not tested in a real browser: clicking Sign out in the menu (the action itself was verified) and responsive layout.

### Demo accounts

Password for all: `Password123!`

| Role | Email |
|---|---|
| Staff | `registry@pensms.test` |
| Student (SMS-YYYY-0002, default demo) | `rahim.uddin@student.pensms.test` |
| Other students | `nusrat.jahan`, `abir.hossain`, `tanvir.ahmed`, `farhana.akter`, `sadia.islam` — each `@student.pensms.test` |

---

## Phase 3 — Domain Logic and API ⬜

Spec: architecture.md §4–§13, §17.1, §26, §28–§32, §36.

- [ ] Install `date-fns`, `vitest`, `@vitejs/plugin-react`; add `npm test`
- [ ] Pure domain functions + unit tests (§36)
- [ ] Zod schemas (§30)
- [ ] `ActionResult`, `DomainError`, Prisma error mapping (§31)
- [ ] Student service: race-safe Student ID, fee assigned in the same transaction, optional login creation
- [ ] Fee/payment service: transactional payment and fee adjustment (§7)
- [ ] Assessment service (programme-scoped, open/close)
- [ ] File storage + submission service (§32); `storage/uploads/.gitkeep`; `serverActions.bodySizeLimit: "6mb"`
- [ ] Result service: per result / per student / per assessment publishing
- [ ] Server Actions
- [ ] JSON API route handlers (§17.1), each checked with curl
- [ ] Complete seed: payments, assessments, submissions with real PDF files, results (§28)

---

## Phase 4 — Staff UI 🟡

- [x] App shell (sidebar, user menu, sign out)
- [ ] Dashboard: all six cards (§19) + overdue fees table
- [ ] Students · Fees · Assessments · Results

## Phase 5 — Student UI 🟡

- [x] App shell
- [ ] Dashboard: add outstanding balance and next deadline (§24)
- [ ] Fees · Assessments · Marksheet

## Phase 6 — Quality ⬜

## Phase 7 — Submission ⬜

---

## Open items

- `src/hooks/use-mobile.ts` (shadcn-generated) fails the `react-hooks/set-state-in-effect` lint rule. Doesn't block the build; fix with `useSyncExternalStore` (Phase 6).

---

## Decision log

### 2026-09-16 — architecture.md is the single specification

`prompt.md` (a separate build contract that overrode architecture.md) was deleted. Everything it
added was merged into architecture.md first:

| Moved from prompt.md | Now in architecture.md |
|---|---|
| Stack, versions, Next 16 / Prisma 6.12 notes | §2.3 |
| Working rules (verify, report honestly, commit per step, update PROGRESS + development log) | §2.4 |
| Race-safe Student ID generation | §4.2 |
| Money as Decimal, string DTOs, transactions | §7 |
| Project structure | §18 |
| Staff / student UI details | §19–§24 |
| Edge-case messages | §25.1 |
| Detailed seed specification | §28 |
| Field validation rules | §30 |
| `ActionResult` shape and HTTP mapping | §31 |
| File storage interface and download route | §32 |
| Domain function semantics and required tests | §36 |
| README section order | §37 |
| Extra anti-goals | §39 |
| Phase plan with verification gates (auth added as Phase 2) | §41 |

### 2026-09-16 — Real sign-in instead of a role toggle

The brief allows a simple role toggle. Auth.js email + password was chosen so "students see only
their own data" depends on who is signed in, not a switch anyone can flip (architecture.md §27).

### 2026-09-16 — Requirements review against the assessment brief

Gaps found and fixed (architecture.md §1.2):

| # | Gap | Change |
|---|---|---|
| 1 | Fee derived live from the tariff; no in-app "assign fee"; tariff edits would rewrite paid balances | `StudentFee` (snapshot at enrolment, staff-adjustable) |
| 2 | Assessments not linked to a programme | `Assessment.programmeId` |
| 3 | No "open assessment" state | `Assessment.isOpen` (staff-controlled) |
| 4 | Resubmission allowed at any time; brief says before the deadline | Replacement after the deadline rejected; first late submission still accepted |
| 5 | No per-student publish/withhold | Per-student marksheet publish/withhold |
| 6 | API routes removed; brief grades "working API routes" | JSON API over the shared service layer (§17.1) |
| 7 | Non-enrolled students could submit / count as pending | Only ENROLLED students of the programme |

The brief PDF is marked "for recruitment purposes only, do not distribute", so it is **not
committed**. architecture.md §1.1 paraphrases its requirements.

### 2026-09-16 — Cleanup and fixes

- Removed the shadcn `dashboard-01` demo (mocked `data.json`, chart, drag-and-drop table) and the
  packages only it used: `recharts`, `@dnd-kit/*`, `@tanstack/react-table`. `cn` is used by every
  shadcn component and was kept.
- `prisma.config.ts` used options Prisma 6.12 doesn't support, so `npm run build` failed type-checking.
  Rewritten for 6.12; `migrate status` and the seed were re-checked.
