# INX SMS — Full Documentation

> The short guide for running and using the app is the [README](../README.md). This document has the full detail: architecture, API, rules, decisions, edge cases, testing and AI usage.

A focused Student Management System for a university **Registry team**, built for the PEN Global technical assessment. It covers four daily Registry workflows end to end, on real PostgreSQL data:

1. **Student enrolment** — create students with an auto-generated Student ID, search and filter.
2. **Fees and payments** — a fee assigned per student, payments, live outstanding balance, overdue flags.
3. **Assessment submission** — staff create assessments; students upload PDF/DOCX, late work is flagged.
4. **Marksheet and results** — grades with classification; staff publish or withhold; students see published results only.

Staff and students sign in to separate areas. Every rule is enforced on the server.

> **Specification:** [architecture.md](architecture.md) is the design specification (schema, rules, edge cases, decisions). Build status and verification records are in [PROGRESS.md](PROGRESS.md); a one-line history is in [development_log.md](development_log.md).

---

## Contents

1. [Features](#1-features)
2. [Architecture](#2-architecture)
3. [Technology stack](#3-technology-stack)
4. [Prerequisites](#4-prerequisites)
5. [Environment variables](#5-environment-variables)
6. [Local setup](#6-local-setup)
7. [Database setup and migrations](#7-database-setup-and-migrations)
8. [Seed data](#8-seed-data)
9. [Demo accounts and sign-in](#9-demo-accounts-and-sign-in)
10. [Business rules](#10-business-rules)
11. [Design decisions](#11-design-decisions)
12. [Edge cases handled](#12-edge-cases-handled)
13. [Testing](#13-testing)
14. [AI usage](#14-ai-usage)
15. [Known limitations](#15-known-limitations)

---

## 1. Features

### Staff (Registry)

| Area | What staff can do |
|---|---|
| **Dashboard** | Total and enrolled students, total outstanding, overdue students, pending submissions, unpublished results; a list of overdue fees with days overdue |
| **Students** | Search by name or Student ID; filter by programme and enrolment status (in the database query, driven by the URL); create and edit students; optional student login on creation |
| **Student record** | Tabs: Details; Fees (summary, payment history, record payment, adjust fee, reassign from tariff); Submissions; Results (publish or withhold one result or the whole marksheet) |
| **Fees** | All students' balances, filterable by status (paid, outstanding, overdue, no fee) |
| **Assessments** | Create and edit assessments per programme; open or close submissions; per-assessment view of every student's submission, file download, inline grading with live classification |
| **Results** | Pick an assessment, grade inline, publish or withhold one result or all; a warning shows students with overdue balances before publishing |

### Student

| Area | What a student can see and do |
|---|---|
| **Dashboard** | Outstanding balance and overdue days, next deadline, work still to submit, late submissions, published results; a notice if not enrolled |
| **Fees** | Total fee, paid, outstanding, due date, payment history |
| **Assessments** | Only their own programme's assessments; upload PDF/DOCX; replace before the deadline (with confirmation); a warning when an upload will be late; the reason when uploading is blocked |
| **Marksheet** | Published results only, with classification. Withheld results are not sent to the browser at all |

---

## 2. Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Next.js 16 App Router                                        │
│  Staff UI (/staff/*)            Student UI (/student/*)       │
│  Server Components + client forms (shadcn/ui)                │
├───────────────────────────────┬──────────────────────────────┤
│ Server Actions (UI mutations) │ JSON API (src/app/api/**)    │
│ src/actions/*                 │ Route Handlers               │
├───────────────────────────────┴──────────────────────────────┤
│ Auth guards — requireStaff / requireStudent (src/lib/auth)   │
│ Validation — Zod (src/lib/validations)                       │
├──────────────────────────────────────────────────────────────┤
│ Service layer (src/lib/services) — one implementation per    │
│ operation, shared by Server Actions and the JSON API         │
├──────────────────────────────────────────────────────────────┤
│ Pure domain rules (src/lib/domain) — fees, overdue, grades,  │
│ late submissions, Student IDs, Dhaka calendar dates          │
├──────────────────────────────────────────────────────────────┤
│ Prisma ORM 6  ─────────────►  PostgreSQL                     │
│ File storage (src/lib/storage) ─► storage/uploads (private)  │
└──────────────────────────────────────────────────────────────┘
```

- **No separate backend.** Server Actions and Route Handlers are thin adapters: authorize → validate → call a service.
- **Business rules are pure functions** in `src/lib/domain`, unit-tested without a database.
- **Security boundary is the server.** `src/proxy.ts` only redirects early; every page, action and API route re-checks the session and role against the database. A student's identity always comes from the session, never from a URL or request body.

### Project structure

```text
prisma/
  schema.prisma          data model
  migrations/            committed migrations
  seed.ts                idempotent demo data
src/
  app/(staff)/staff/     staff pages
  app/(student)/student/ student pages
  app/api/               JSON API route handlers
  app/login/             sign-in page
  actions/               Server Actions
  components/            UI (shadcn/ui primitives, shared, staff, student)
  lib/auth/              session and role guards
  lib/domain/            pure business rules
  lib/services/          database operations (Prisma)
  lib/storage/           file storage (local disk)
  lib/validations/       Zod schemas
  proxy.ts               optimistic route protection
tests/                   Vitest unit and adapter tests
scripts/e2e-api.mjs      end-to-end API checks against a running build
docs/                    architecture, progress, development log
```

### Data model (ERD)

`createdAt` / `updatedAt` are omitted. Field rules are in [architecture.md §4–§16](architecture.md#4-database-schema).

```mermaid
erDiagram
    Programme ||--o{ Student : "enrols"
    Programme ||--o{ ProgrammeFee : "has tariff"
    Programme ||--o{ Assessment : "owns"
    ProgrammeFee |o--o{ StudentFee : "default for"
    Student ||--o| StudentFee : "is assigned"
    Student ||--o{ Payment : "pays"
    Student ||--o{ Submission : "submits"
    Student ||--o{ Result : "receives"
    Student |o--o| User : "signs in as"
    Assessment ||--o{ Submission : "receives"
    Assessment ||--o{ Result : "graded in"

    Programme {
        uuid id PK
        string code UK
        string name
        boolean active
    }
    ProgrammeFee {
        uuid id PK
        uuid programmeId FK "unique with academicYear"
        int academicYear
        decimal amount "12,2"
        string currency
        datetime dueDate "calendar date"
    }
    StudentFee {
        uuid id PK
        uuid studentId FK "unique"
        uuid programmeFeeId FK "nullable"
        decimal amount "12,2"
        string currency
        datetime dueDate "calendar date"
    }
    Student {
        uuid id PK
        string studentId UK "SMS-YYYY-NNNN"
        string fullName
        string email UK
        datetime dateOfBirth "calendar date"
        uuid programmeId FK
        int academicYear
        enum enrolmentStatus
    }
    Payment {
        uuid id PK
        uuid studentId FK
        decimal amount "12,2"
        datetime paymentDate "calendar date"
        string referenceNumber UK
    }
    Assessment {
        uuid id PK
        uuid programmeId FK
        string title
        string module
        datetime submissionDeadline
        boolean isOpen
    }
    Submission {
        uuid id PK
        uuid studentId FK "unique with assessmentId"
        uuid assessmentId FK
        string fileName
        string fileUrl "storage key"
        string fileType
        int fileSize
        datetime submittedAt
        boolean isLate
    }
    Result {
        uuid id PK
        uuid studentId FK "unique with assessmentId"
        uuid assessmentId FK
        int grade "0-100"
        boolean published
    }
    User {
        uuid id PK
        string email UK
        string passwordHash
        enum role "STAFF or STUDENT"
        uuid studentId FK "unique, nullable"
    }
```

### JSON API

The UI uses Server Actions; the JSON API exposes the same operations over HTTP, backed by the same services.

| Method | Route | Role | Operation |
|---|---|---|---|
| GET | `/api/students?q=&programme=&status=` | staff | Search and filter students |
| POST | `/api/students` | staff | Create a student (Student ID generated, fee assigned from tariff) |
| GET | `/api/students/[id]` | staff | Student details |
| PATCH | `/api/students/[id]` | staff | Update a student |
| GET | `/api/students/[id]/fees` | staff | Fee summary and payment history |
| PUT | `/api/students/[id]/fee` | staff | Assign or adjust the student's fee |
| POST | `/api/students/[id]/payments` | staff | Record a payment |
| PUT | `/api/students/[id]/results/[assessmentId]` | staff | Enter or update a grade |
| PATCH | `/api/students/[id]/results/[assessmentId]` | staff | Publish or withhold one result |
| POST | `/api/students/[id]/results/publish` | staff | Publish or withhold a student's whole marksheet |
| GET | `/api/assessments` | staff, student | Staff: all. Student: own programme, with own submission status |
| POST | `/api/assessments` | staff | Create an assessment |
| PATCH | `/api/assessments/[id]` | staff | Edit, open or close an assessment |
| POST | `/api/assessments/[id]/submissions` | student | Upload or replace own submission (multipart, field `file`) |
| GET | `/api/me/marksheet` | student | Own **published** results only |
| GET | `/api/files/[submissionId]` | staff, owning student | Download a submitted file |

Conventions: `[id]` is the internal UUID (the Student ID is a field). Errors are `{ "error": string, "fieldErrors"?: { [field]: string[] } }` with `400` validation, `401` signed out, `403` wrong role, `404` not found (a malformed id too), `409` conflict (duplicate email or payment reference, deadline passed, closed assessment).

#### Trying the API with curl

The API uses the same session cookie as the browser. Sign in once, then reuse the cookie jar (bash; run the app first, see [Local setup](#6-local-setup)):

```bash
BASE=http://localhost:3000

# Sign in as staff (Auth.js credentials flow: CSRF token, then credentials)
CSRF=$(curl -s -c cookies.txt "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -b cookies.txt -c cookies.txt -o /dev/null "$BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode 'email=registry@pensms.test' \
  --data-urlencode 'password=Password123!'

# Search students
curl -s -b cookies.txt "$BASE/api/students?q=rahim"

# Fee summary for a student (use an "id" from the search result)
curl -s -b cookies.txt "$BASE/api/students/<id>/fees"

# Record a payment
curl -s -b cookies.txt -X POST "$BASE/api/students/<id>/payments" \
  -H 'content-type: application/json' \
  -d '{"amount":"10000.00","paymentDate":"2026-09-01","referenceNumber":"PAY-DEMO-0001"}'

# Enter a grade, then publish it
curl -s -b cookies.txt -X PUT "$BASE/api/students/<id>/results/<assessmentId>" \
  -H 'content-type: application/json' -d '{"grade":72}'
curl -s -b cookies.txt -X PATCH "$BASE/api/students/<id>/results/<assessmentId>" \
  -H 'content-type: application/json' -d '{"published":true}'
```

As a student (sign in with `rahim.uddin@student.pensms.test` into a separate jar, e.g. `student.txt`):

```bash
curl -s -b student.txt "$BASE/api/assessments"            # own programme, with canUpload / uploadBlockedReason
curl -s -b student.txt -F "file=@essay.pdf;type=application/pdf" \
  "$BASE/api/assessments/<assessmentId>/submissions"      # 201 first upload, 200 replacement
curl -s -b student.txt "$BASE/api/me/marksheet"           # published results only
```

---

## 3. Technology stack

| Area | Choice |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack), React 19 |
| Language | TypeScript (strict) |
| Database | PostgreSQL |
| ORM | Prisma 6.12 (`@prisma/client`), config in `prisma.config.ts` |
| Authentication | Auth.js `next-auth@5.0.0-beta.32` (pinned), credentials with bcrypt, JWT session cookie (8 h) |
| Validation | Zod 4, on the server |
| UI | Tailwind CSS 4, shadcn/ui on Base UI, lucide icons, sonner toasts |
| Tests | Vitest 5 |
| CI | GitHub Actions on pull requests from `develop` to `main`: unit tests, migrate + seed from a clean database, build, API end-to-end checks |

---

## 4. Prerequisites

- **Node.js 22** (developed on 22.13; CI uses Node 22) and npm
- **PostgreSQL** (CI uses PostgreSQL 16) — a local server, or a hosted one such as Prisma Postgres
- Git

---

## 5. Environment variables

Copy `.env.example` to `.env`. `.env` is gitignored; never commit it.

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma (app, migrations, seed) | `postgresql://postgres:YOUR_PASSWORD@localhost:5432/pen_sms?schema=public` |
| `AUTH_SECRET` | yes | Secret that signs and encrypts the session cookie. Generate one with `npx auth secret` or `openssl rand -base64 32` | a long random string |
| `DEMO_MODE` | no | `"true"` lists the seeded demo accounts and password on the login page. Anything else hides them | `"true"` for local demos, `"false"` elsewhere |

**Hosted database (optional):** for [Prisma Postgres](https://console.prisma.io), use its **direct** connection string (`postgres://…@db.prisma.io:5432/postgres?sslmode=require`) as `DATABASE_URL`, not a `prisma+postgres://` URL. Migrations and the transaction locks need a direct connection.

---

## 6. Local setup

```bash
# 1. Clone and install
git clone https://github.com/anikninja/pen-sms.git
cd pen-sms
npm install

# 2. Environment
cp .env.example .env
#    edit .env: set DATABASE_URL to your PostgreSQL and AUTH_SECRET to a random string

# 3. Create an empty database (skip if it exists)
createdb pen_sms        # or: psql -U postgres -c "CREATE DATABASE pen_sms;"

# 4. Apply migrations and load demo data
npm run db:deploy
npm run db:seed

# 5. Start — production build (recommended for review)
npm run build
npm run start

#    or, for development with hot reload
npm run dev
```

Open <http://localhost:3000> and sign in with a [demo account](#9-demo-accounts-and-sign-in).

Uploaded submissions (and the seed's sample PDFs) are saved in `storage/uploads/`, which is gitignored.

---

## 7. Database setup and migrations

| Command | What it does |
|---|---|
| `npm run db:deploy` | `prisma migrate deploy` — applies committed migrations. Never resets data. Use for a new or existing database |
| `npm run db:seed` | Loads demo data (safe to re-run) |
| `npx prisma migrate reset` | **Development only:** drops the database, re-applies migrations and re-seeds |
| `npx prisma migrate dev --name <change>` | **Development only:** creates a new migration after editing `prisma/schema.prisma` |
| `npx prisma studio` | Browse the data in a local web UI |

Migrations in `prisma/migrations/`:

1. `20260915195504_init` — the eight Registry tables, the enrolment status enum, foreign keys, unique constraints and indexes
2. `20260916154537_add_user_auth` — `User` table and role enum; a check constraint that a STUDENT login links to exactly one student and a STAFF login to none

---

## 8. Seed data

`prisma/seed.ts` is **idempotent** (every write is an upsert) and **dates are relative to when it runs**, so the overdue, not-yet-due and late scenarios stay true whenever you seed. It creates 2 programmes, 6 students, 6 fees, 6 payments, 4 assessments, 6 submissions (real PDF files), 7 results and 7 logins.

`Y` = the current year.

**Programmes and fee tariffs**

| Code | Programme | Tariff | Due | Scenario |
|---|---|---|---|---|
| `BSC-CS` | BSc Computer Science | 150,000.00 BDT | 30 days ago | overdue |
| `MBA` | Master of Business Administration | 250,000.00 BDT | in 60 days | outstanding, not yet due |

**Students**

| Student ID | Name | Programme | Status | Paid | Demonstrates |
|---|---|---|---|---|---|
| `SMS-Y-0001` | Nusrat Jahan | BSC-CS | Enrolled | 150,000 | fully paid; has a **withheld** Algorithms grade (82) |
| `SMS-Y-0002` | Rahim Uddin | BSC-CS | Enrolled | 90,000 (2 payments) | **overdue** balance; **late** submission — the default demo student |
| `SMS-Y-0003` | Abir Hossain | BSC-CS | Enrolled | none | overdue with no payments; **pending** submission; withheld grade at the Pass boundary (40) |
| `SMS-Y-0004` | Tanvir Ahmed | BSC-CS | Deferred | 75,000 | not enrolled → cannot submit |
| `SMS-Y-0005` | Farhana Akter | MBA | Enrolled | 100,000 | outstanding but **not** overdue; withheld Fail (35) |
| `SMS-Y-0006` | Sadia Islam | MBA | Completed | 250,000 | completed; submission to a **closed** assessment |

**Assessments**

| Assessment | Programme | Deadline | Open | Scenario |
|---|---|---|---|---|
| Database Systems Coursework | BSC-CS | 14 days ago | yes | late submissions still accepted and flagged |
| Algorithms Assignment 1 | BSC-CS | in 10 days | yes | normal submission and replacement |
| Business Strategy Report | MBA | in 21 days | yes | |
| Financial Accounting Essay | MBA | 45 days ago | **no** | closed for submissions |

**Results** cover every classification boundary: 78 Distinction, 70 Distinction, 60 Merit, 40 Pass, 35 Fail, 82 Distinction, 65 Merit — four published, three withheld.

---

## 9. Demo accounts and sign-in

Every seeded account uses the password **`Password123!`**.

| Role | Email |
|---|---|
| Staff (Registry) | `registry@pensms.test` |
| Student (overdue, late submission) | `rahim.uddin@student.pensms.test` |
| Student (fully paid, withheld result) | `nusrat.jahan@student.pensms.test` |
| Student (overdue, no payments) | `abir.hossain@student.pensms.test` |
| Student (deferred) | `tanvir.ahmed@student.pensms.test` |
| Student (MBA, not yet due) | `farhana.akter@student.pensms.test` |
| Student (completed) | `sadia.islam@student.pensms.test` |

- One sign-in page for both roles; each role lands on its own dashboard. Staff cannot open student pages and students cannot open staff pages or APIs.
- With `DEMO_MODE="true"` the login page lists demo accounts and the password.
- The brief allows a simple role toggle. Real sign-in was chosen so that "students only see their own data" is enforced by who is signed in, not by UI state.

---

## 10. Business rules

All enforced on the server; formulas are in `src/lib/domain` and unit-tested.

```text
Student ID       SMS-{academicYear}-{NNNN}, unique, generated on creation (per-year sequence, race-safe)

Fee              copied from the programme tariff (programme + academic year) at enrolment
                 amount > 0 and amount >= total already paid; tariff changes never alter existing fees

Outstanding      outstanding = student fee − sum(payments)          (calculated, never stored)

Payment          amount > 0, amount <= outstanding, date not in the future,
                 reference number unique, student must have a fee

Overdue          outstanding > 0 AND today (Asia/Dhaka) > due date
                 a fee due on 30 Sep is overdue from 1 Oct; daysOverdue counts calendar days

Submission       assessment open AND student ENROLLED AND in the assessment's programme
                 PDF or DOCX (extension and MIME type), at most 5 MB
Late             isLate = submittedAt > deadline               (exactly at the deadline is on time)
Replacement      one submission per student per assessment; replace only while now <= deadline

Grade            whole number, 0 <= grade <= 100; one result per student per assessment
Classification   >= 70 Distinction · >= 60 Merit · >= 40 Pass · otherwise Fail
Publishing       students only ever receive published results (filtered in the database query)
```

---

## 11. Design decisions

| Decision | Rationale |
|---|---|
| **Fee is a snapshot, not derived live** (`StudentFee`) | A fee read live from the tariff would change the balance of students who already paid whenever a tariff is edited, and leaves nowhere for scholarships or agreed amounts. The tariff supplies the default; staff can adjust; a changed programme shows a "does not match tariff" notice with an explicit reassign action |
| **Overdue = past the due date with a balance** | The brief asks for overdue flags but no payment schedule. One due date per fee is the simplest rule a Registry understands. Due dates are calendar days in the Registry's time zone (Asia/Dhaka) |
| **"Open" is a staff switch, separate from the deadline** | The brief says uploads go to *open* assessments **and** late work is accepted, so "open" cannot mean "before the deadline". Staff close an assessment when marking starts; late submissions are accepted until then |
| **Results are not withheld automatically for unpaid fees** | That is institutional policy. When publishing for a student with an overdue balance, staff see the amount and confirm |
| **Re-grading keeps the publish state** | Publishing stays an explicit staff action; a grade edit never silently unpublishes. New grades always start withheld |
| **Assessments belong to a programme** | Otherwise every student would see — and be counted as pending for — every assessment |
| **Real sign-in instead of a role toggle** | Makes "own data only" and "published only" real security rules (§27 of the architecture) |
| **One service layer for UI and API** | Server Actions and JSON routes call the same functions, so no rule is implemented twice |
| **Money as `Decimal`, sent to the browser as strings** | No floating-point errors in balances |
| **Row lock on the student for payments and fee changes; advisory lock per year for Student IDs** | Two simultaneous payments cannot overpay; simultaneous enrolments cannot collide on a Student ID (verified with concurrent requests) |
| **Files on private local disk behind an access-checked download route** | Simple for the assessment; storage sits behind an interface so S3-style storage is a single new implementation |

---

## 12. Edge cases handled

Every case gives a clear message or state — never a crash or raw database error. Full list: [architecture.md §25](architecture.md#25-edge-cases).

| Area | Cases |
|---|---|
| Students | duplicate email; invalid email; future date of birth; under 15; academic year out of range; inactive programme not offered; search with no matches; malformed or unknown id → not found |
| Fees | payment ≤ 0; payment above outstanding ("exceeds the outstanding balance of X"); duplicate reference; future payment date; no fee assigned (payments blocked); fee below amount already paid; fully paid (form disabled); tariff edited after enrolment (existing fees unchanged); programme changed (mismatch notice); concurrent payments |
| Assessments | missing fields; deadline in the past on create (allowed, with warning); wrong file type; file over 5 MB (checked in the browser and on the server); submission exactly at the deadline (on time); after the deadline (accepted, flagged late); replacement after the deadline (rejected); closed assessment; student not enrolled; another programme's assessment (not found) |
| Results | grade outside 0–100 or not a whole number; re-grading updates the same row; student outside the assessment's programme; unpublished results never reach the student (page and API); publishing with an overdue balance (warning); new grade after publishing starts withheld |
| Access | signed-out users redirected (pages) or `401` (API); wrong role redirected or `403`; students cannot download other students' files |
| Failures | page errors show a safe message with a reference code (no internal details); database unreachable at sign-in shows "Sign-in is unavailable right now"; loading skeletons while pages load |

---

## 13. Testing

```bash
npm test            # unit and adapter tests (Vitest) — no database needed
npm run lint        # ESLint
npm run build       # type-check and production build
npm run test:e2e    # API end-to-end checks — needs a running build on a freshly seeded database
```

For the end-to-end checks:

```bash
npx prisma migrate reset --force     # development database only: fresh seed
npm run build
npx next start -p 3100 &
npm run test:e2e                     # defaults to http://localhost:3100 (override with E2E_BASE_URL)
```

| Suite | Covers |
|---|---|
| `tests/domain` | outstanding balance, overdue (incl. exactly at the due date), classification boundaries (0, 39, 40, 59, 60, 69, 70, 100), late and replacement at the deadline, Student ID formatting, Dhaka calendar dates |
| `tests/validations` | grade (−1, 0, 40, 70.5, 101…), payment amount and date, email, date of birth |
| `tests/actions` | Server Actions: signed out, wrong role, invalid input, malformed ids, error mapping, student identity from the session |
| `tests/storage` | save, read, delete, no overwrite, path-traversal keys rejected |
| `scripts/e2e-api.mjs` | 106 checks over every JSON route: roles, own-data and published-only rules, every expected message, file upload and replacement, concurrent payments and enrolments |

The staff and student interfaces were also walked through in headless Chrome against a production build (sign-in, every workflow, access boundaries, no horizontal scroll at 375 / 768 / 1024 / 1280 px). Results for each phase are recorded in [PROGRESS.md](PROGRESS.md).

**CI:** `.github/workflows/ci.yml` runs on pull requests from `develop` to `main`: unit tests; then, against a PostgreSQL 16 service, migrations and seed from a clean database (twice, to prove the seed is idempotent), a check that migrations match the schema, the build, and the API end-to-end checks.

---

## 14. AI usage

AI was used throughout as an engineering assistant. The architecture, business rules and final decisions are mine; every AI-produced change was reviewed, run and tested before it was committed.

**Tool:** Claude Code (Anthropic), in VS Code.

**What it was used for**

| Activity | How AI helped |
|---|---|
| Requirements and architecture review | Re-checked `docs/architecture.md` against the assessment brief line by line; found gaps (e.g. no way to assign a per-student fee, assessments not linked to programmes) that became documented decisions |
| Schema and migrations | Reviewed the Prisma schema, constraints and indexes; drafted migrations and the seed |
| Implementation | Scaffolded services, Server Actions, API routes and shadcn/ui screens phase by phase, following the architecture document |
| Tests | Generated unit tests for boundary cases, the API end-to-end script, and headless-browser walkthroughs |
| Edge-case discovery and code review | Suggested cases (concurrent payments, submissions exactly at the deadline, withheld results leaking into page data) that were then tested |
| CI and documentation | GitHub Actions workflow, progress records, the README and this documentation |

**How output was checked, and what that caught**

- Each phase was verified against a running production build before being marked done: unit tests, API checks, real sign-in in a headless browser, and visual review of screenshots. Results are recorded in `docs/PROGRESS.md`.
- Problems found this way and fixed include: two simultaneous enrolments getting the same Student ID (caught by CI, fixed with a database lock); fee due dates being treated as overdue a day early; tables causing horizontal scrolling at tablet width; a "Pending" label on assessments that had already closed; sign-in blaming the password when the database was unreachable.
- I made the product and security decisions (real sign-in over a role toggle, fee snapshots, "open" versus deadline, no automatic withholding), and chose scope deliberately — for example, keeping Prisma 6 rather than rewriting the data layer for Prisma 8, a release candidate, just to use a hosting feature.

---

## 15. Known limitations

- **File storage is local disk.** It does not persist on serverless hosts (e.g. Vercel) and needs a persistent volume on a server. Storage is behind an interface, so an S3-style implementation can replace it.
- **No self-service accounts:** no registration, password reset, email verification, account lockout or rate limiting. Staff create student logins.
- **No submission history:** a replacement overwrites the previous submission (the old file is deleted).
- **One due date per fee:** no instalment or partial-payment schedule, refunds or multiple currencies per student.
- **Single time zone:** Registry dates use Asia/Dhaka.
- **No pagination** on the students list (fine for the demo data size).
- A record page that is not found shows "Page not found" with HTTP status 200 (Next.js streaming; the page is marked `noindex`). The JSON API returns a real 404.
- `next-auth` v5 is a beta release (pinned to an exact version).
- No deployment configuration is included: the app is run locally with `npm run start` (or `npm run dev`).
