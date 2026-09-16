# Build Progress

Live status of the build. Phases follow [architecture.md](architecture.md) §41, which is the single
specification. One-line history: [development_log.md](development_log.md).

**Update this file after every completed piece of work** (architecture.md §2.4).

| Phase | Status |
|---|---|
| 1 — Foundation | ✅ Done |
| 2 — Authentication | ✅ Done |
| 3 — Domain Logic and API | ✅ Done |
| 4 — Staff UI | ✅ Done |
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

## Phase 3 — Domain Logic and API ✅

Spec: architecture.md §4–§13, §17.1, §26, §28–§32, §36.

- [x] `vitest` + `npm test` / `npm run test:watch`; `vitest.config.mts`; `@types/node` upgraded to 22 (vitest 5 needs it; runtime is Node 22)
- [x] Pure domain functions — `src/lib/domain/` (fees, results, submissions, student-id, dates)
- [x] Zod schemas — `src/lib/validations/` (students, fees, assessments, results, auth, common, ids)
- [x] `DomainError`, `ActionResult`, `runAction`, Prisma error mapping — `src/lib/errors.ts`
- [x] Auth guards returning 401/403 for actions and API — `src/lib/auth/guards.ts`
- [x] Student service: race-safe Student ID (per-year advisory lock + numeric max, P2002 retry as safety net), fee copied from tariff in the same transaction, optional login creation, email kept in sync with the login
- [x] Fee service: fee summary, payment history, locked + transactional payments and fee assignment (tariff or manual), overdue list
- [x] Assessment service: programme-scoped, open/close, programme locked once work exists, staff submission list
- [x] File storage — `src/lib/storage/` (`LocalFileStorage`, safe keys, never overwrites); `storage/uploads/.gitkeep`; uploads gitignored
- [x] Submission service: eligibility (open, ENROLLED, same programme), replace only until the deadline, lateness from the server clock, old file removed after the row is saved; student assessment list; ownership-checked download
- [x] Result service: upsert, publish per result / per student / per assessment, published-only marksheet in the query
- [x] Server Actions — `src/actions/` (students, payments, assessments, submissions, results)
- [x] JSON API — all 16 route/method pairs in §17.1 under `src/app/api/`
- [x] `experimental.serverActions.bodySizeLimit: "6mb"` in `next.config.ts`
- [x] Complete seed (§28): 6 payments, 4 assessments (1 closed), 6 submissions with valid PDF files (1 late, 1 pending), 7 results (4 published)

### Verified — 2026-09-16

**Unit tests** — `npm test`: **99 passed** (8 files)

| File | Covers |
|---|---|
| `tests/domain/*` (5 files) | every §36 function and boundary: outstanding, overdue at/after due date, classification 0/39/40/59/60/69/70/100, late/replace before/at/after deadline, fee validity, Student ID padding and 9→10→100→10000, Dhaka "today", age |
| `tests/validations/validations.test.ts` | grade −1/0/40/60/70/100/101/70.5, payment 0/−100/decimals/future date, reference normalisation, email, DOB future / under 15 / exactly 15, academic year range, deadline time zone |
| `tests/storage/storage.test.ts` | save/read/delete, no overwrite, 6 path-traversal keys rejected |
| `tests/actions/actions.test.ts` | Server Actions: 401/403/validation/not-found mapping, generic message for unexpected errors, student id taken from the session not the form |

**Seed from clean** — `prisma migrate reset --force` twice: both runs apply 2 migrations and seed identical counts. The 6 seeded PDFs have valid xref offsets and stream lengths.

**JSON API end-to-end** — `next build` + `next start`, Node script signing in as staff and 6 students: **106 passed, 0 failed**. Highlights:

| Area | Checked |
|---|---|
| Auth | no session → 401; student on staff route → 403; staff on student route → 403 |
| Students | search by name / partial ID (case-insensitive), programme and status filters, empty result, bad status → 400, malformed / unknown id → 404, invalid JSON → 400 |
| Enrolment | next Student ID, login created, fee copied from tariff; duplicate email (any case) → 409; future DOB, under 15, bad email + missing name, year out of range → 400 with the §25.1 messages |
| Race: enrolment | 10 simultaneous creates → all 201 with unique consecutive IDs 0008–0017 (after the advisory-lock fix below; stress-tested at 20×3 and 50×2) |
| Student edit | Student ID unchanged; programme change keeps fee with `matchesTariff: false`; reassign from tariff; duplicate email → 409 |
| Fees | Rahim 150,000 / 90,000 / 60,000 overdue; Farhana outstanding not overdue; Nusrat paid |
| Payments | 0 / −100 / future date → 400; 60,000.01 → "Payment exceeds the outstanding balance of 60,000.00 BDT."; duplicate reference (any case) → 409; fully paid → 409; 10,000.50 recorded exactly (49,999.50 left) |
| Race: payments | 5 simultaneous 40,000 payments on a 150,000 fee → exactly 3 accepted; total paid 120,000 |
| Fee assignment | manual below paid → 400 with amount; manual scholarship; back to tariff; no-tariff year → NO_FEE, payment 409, tariff 409, manual OK |
| Assessments | staff sees 4 with counts; student sees own programme only; past deadline → 201 + warning; missing fields / no time zone / unknown programme → 400; moving an assessment with submissions → 409; close → 200 |
| Submissions | first on time → 201; replace with DOCX → 200, same row, old file deleted from disk; path stripped from file name; replace after deadline → 409; first late submission → 201 `isLate`; txt / renamed / >5 MB / missing file → 400; other programme → 404; deferred → 403; closed → 409 |
| Downloads | own file 200 with correct bytes and headers; another student's → 404; staff → 200 `%PDF`; signed out → 401 |
| Results | 101 / −1 / 70.5 → 400; other programme → 409; re-grade updates, stays unpublished; new grade unpublished; student → 403; marksheet shows published only and the withheld 82 is absent from the payload; publish one → visible; withhold whole marksheet → empty; publish with no grade → 404 |

Afterwards the database was reset and re-seeded, and test uploads were removed (6 seed files remain).

**Also:** `tsc --noEmit` clean · `npm run build` passes (16 API routes listed) · ESLint clean except the pre-existing `use-mobile.ts` error.

**Not verified over HTTP:** Server Actions. Next.js only bundles an action once a page imports it, and no Phase 4 screen does yet. They are covered by `tests/actions/` and share the services verified above. Check them through the UI in Phase 4.

---

## Phase 4 — Staff UI ✅

Spec: architecture.md §19–§23, §34, §35.

- [x] **Dashboard** (`/staff/dashboard`) — Total Students, Enrolled Students, Total Outstanding (exact, per currency), Overdue Students, Pending Submissions, Unpublished Results; each card links to the matching list. Overdue Fees table: Student ID, name, programme, status, outstanding, due date, days overdue.
- [x] **Students** (`/staff/students`) — server-side search (name / Student ID) and filters (programme, status) through a plain GET form; result count; empty state "No students match your search."
- [x] **New / edit student** — validation errors under each field; optional initial password creates a login; inactive programmes hidden on create; Student ID shown read-only on edit.
- [x] **Student detail** (`/staff/students/[id]`) — tabs Details / Fees / Submissions / Results, kept in `?tab=`.
  - Fees: fee, paid, outstanding, due date, status badge, days overdue, source; Record Payment dialog (disabled when paid or no fee); Assign / Adjust Fee dialog (tariff or manual); "Fee does not match programme tariff" notice with Reassign from tariff; payment history.
  - Submissions: status, submitted time, file download.
  - Results: publish / withhold per result and whole marksheet, with the overdue-balance warning.
- [x] **Fees** (`/staff/fees`) — every student's fee position, filter by Overdue / Outstanding / Paid / No fee with counts, outstanding total for the view.
- [x] **Assessments** (`/staff/assessments`) — list with programme filter, Open/Closed badge, submitted and graded counts; New assessment dialog (deadline entered in Dhaka time).
- [x] **Assessment detail** (`/staff/assessments/[id]`) — deadline / submitted / pending / graded / withheld figures; edit dialog; close / reopen with confirmation; grading table: Submitted / Late / Pending, download, inline grade with live classification, publish / withhold per student; publish all / withhold all with a count of overdue students.
- [x] **Results** (`/staff/results`) — assessment picker (shows withheld counts, defaults to the first assessment with withheld results) + the same grading table and bulk controls.
- [x] Shared UI: status badges with text labels (§35), empty states, page header, confirmation dialog, toasts on every mutation, `useServerAction` hook.
- [x] New read models: `listFeeOverview`, `totalOutstandingByCurrency`, `countPendingSubmissions`, `getStaffDashboard`, `getGradingRows`, `getTariffForStudent`.

### Verified — 2026-09-17

**Real browser** — headless Chrome driven over the DevTools protocol against `next build` + `next start`, signing in through the login form and clicking the real controls: **14 of 14 flows passed with no console errors, exceptions or hydration warnings** (a 15th step checked the 404 page; the only log was the expected 404 status).

| Flow | Checked |
|---|---|
| Sign in | login form → redirect to `/staff/dashboard` |
| Dashboard | 6 students, 435,000.00 BDT outstanding, 3 overdue, 3 pending, 3 unpublished; overdue table 30 days |
| Students | search "rahim" → only Rahim; MBA + Enrolled → Farhana only; no match → empty state |
| Create student | invalid email and under-15 DOB show field errors; then created → redirected to detail with new Student ID, tariff fee, overdue |
| Record payment | 70,000 → "Payment exceeds the outstanding balance of 60,000.00 BDT." in the dialog; 10,000 → dialog closes, balance 50,000.00, reference in history |
| Adjust fee | manual 120,000 → mismatch notice; Reassign from tariff (confirm) → back to 150,000 |
| Marksheet | withhold → Withheld; publish confirm shows the overdue-balance warning → published |
| Fees list | Overdue filter shows Abir, not Nusrat |
| New assessment | deadline `2030-01-15T23:59` (Dhaka) → shown as 15 Jan 2030, 23:59; stored as 17:59 UTC |
| Grading | 101 → inline error; 72 → "Distinction" live → saved (DB grade 72) |
| Close assessment | confirm → "Reopen submissions" shown |
| Results bulk publish | confirm shows overdue warning → 0 withheld |
| Unknown student id | 404 page |
| 375px width | students list: no horizontal page scroll (table scrolls in its container) |

Screenshots were reviewed for layout; one issue found and fixed (stray scrollbar on the student tabs).

**Regression:** `npm test` **111 passed** (9 files; +12 for date-time conversion and calendar due dates) · API end-to-end **106 passed, 0 failed** on a fresh seed · `tsc` clean · `npm run build` passes (9 staff routes) · ESLint: only the pre-existing `use-mobile.ts` error.

Server Actions are now bundled (pages import them) and were exercised over HTTP by the browser flows above — closing the Phase 3 open item.

### Fix found while building this phase: calendar due dates

- **Problem:** due dates are calendar days stored as UTC midnight, but overdue was `now > dueDate`. A student paying **on** the due date was already "overdue" from 06:00 Dhaka time. The seed also stored tariff due dates with a time of day, so they could display a day off.
- **Fix:** overdue compares against the end of the due day in Dhaka (`endOfRegistryDay`), and days overdue counts calendar days after the due date (`calendarDaysPast`) — 1 Oct is 1 day overdue for a 30 Sep due date. Seeded tariff due dates are calendar dates. Unit-tested; architecture.md §6 and §26 updated.

---

## Phase 5 — Student UI 🟡

- [x] App shell
- [ ] Dashboard: add outstanding balance and next deadline (§24)
- [ ] Fees · Assessments · Marksheet

## Phase 6 — Quality ⬜

## Phase 7 — Submission ⬜

---

## Open items

- `src/hooks/use-mobile.ts` (shadcn-generated) fails the `react-hooks/set-state-in-effect` lint rule. Doesn't block the build; fix with `useSyncExternalStore` (Phase 6).
- Student list has no pagination (fine for the demo data size).
- Deadlines in the JSON API must include a time zone (the staff form converts `datetime-local` as Dhaka time).
- Loading states (`loading.tsx`) and error boundaries per route group are not added yet (Phase 6).
- The staff UI was checked in headless Chrome, not by hand in a desktop browser; keyboard-only navigation of dialogs is untested.
- Seed assumes a fresh database for submissions: if a student replaced a seeded file through the app, re-seeding points the row back at the seed file and leaves the uploaded file orphaned.

---

## Decision log

### 2026-09-16 — Phase 3 implementation decisions

| Decision | Why | Recorded in |
|---|---|---|
| No `date-fns` or `@vitejs/plugin-react` | Date logic is small and uses `Intl`; tests run in Node, not a browser | §2.3 |
| `@types/node` 20 → 22 | vitest 5 requires it; the runtime is Node 22 | §2.3 |
| Lock the student row (`FOR UPDATE`) for payments and fee changes | Transactions alone don't stop two payments reading the same balance | §7 |
| Calendar dates compared in Asia/Dhaka | A payment made at 01:00 in Dhaka would otherwise be "in the future" in UTC | §30 |
| Storage key `${submissionId}-${timestamp}${ext}`, never overwrite | Replacing a file in place would lose the previous one if the database update failed | §32 |
| Re-grading keeps the publish state | Publishing stays an explicit staff action | §13 |
| Duplicate email / reference → 409 with `fieldErrors` | Matches §17.1 and still lets forms highlight the field | §17.1, §31 |
| Payment references stored upper-case | `pay-1` and `PAY-1` would otherwise be two different references | §30 |
| Malformed ids → 404 | Same response as unknown ids; no validation detail about internal ids | §17.1 |
| Staff submission list also shows non-enrolled students who already submitted or were graded | Otherwise a deferred student's graded work disappears from the list | §22 |

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

### 2026-09-16 — Fix: concurrent enrolments could fail

The first CI run failed: of 5 simultaneous enrolments, one returned 409 "Could not generate a Student ID". The local Phase 3 check had passed only because of timing.

- **Cause:** every concurrent transaction read the same highest Student ID; the P2002 retry lets only one win per round, so 3 attempts can't cover 5 requests. Reproduced locally: 20 simultaneous enrolments → 12–14 failures per round.
- **Fix:** `createStudent` takes a transaction-scoped advisory lock per academic year before reading the highest ID (`src/lib/services/students.ts`). The retry remains as a safety net. architecture.md §4.2 updated.
- **Verified:** 20 simultaneous × 3 rounds and 50 simultaneous × 2 rounds → all created, unique, gap-free. The e2e race check now uses 10 simultaneous enrolments and prints each error. Full CI sequence locally: 99 unit tests, 106 API checks passed.
