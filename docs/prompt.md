# BUILD PROMPT — Student Management System (Registry Module)

> **You are building this.** Read this file completely before writing any code.
> `architecture.md` in this same directory is the domain specification. This file is the
> **execution contract**: it locks every decision `architecture.md` left open, fixes the
> build order, and defines what "done" means.
>
> **Conflict rule:** where this file and `architecture.md` disagree, **this file wins.**
>
> **Above both sits the assessment brief (PDF).** `architecture.md` §1.1 maps every brief
> requirement to a section, and §1.2 lists the gaps found on re-review (2026-09-16). This file
> was updated to match that review.

---

## 0. Mission

Build a working, end-to-end **Registry module** for a Student Management System covering four
workflows: **Student Enrolment**, **Fees & Payments**, **Assessment Submission**, and
**Marksheet & Results**.

This is a technical assessment. It is graded on:

1. Correct business rules enforced **server-side**
2. Correct database relationships
3. Working end-to-end workflows against a **real** database
4. Edge-case handling
5. Clear UI/UX
6. Error handling
7. Tests
8. Visual polish

That list is in priority order. **Never sacrifice a lower number for a higher one.** If you run
short on time, cut visual polish, then tests — never business rules.

**Target build time: 5 days.** Stay inside scope. Section 14 lists what *not* to build.

---

## 1. Non-negotiable constraints

| Constraint | Rule |
|---|---|
| Framework | Next.js 14+ with **App Router**. No other backend framework. No Express, no NestJS, no tRPC. |
| Database | **PostgreSQL**. Real data. No SQLite, no in-memory. |
| ORM | **Prisma**. Schema committed to the repo. |
| Data | **No mocked application data.** Nothing in `useState`, no hardcoded arrays of students. Every screen reads from Postgres. |
| Styling | Tailwind CSS + **shadcn/ui**. |
| Validation | **Zod**, on the server, always — even where client validation also exists. |
| Auth | Not required. Use the demo role toggle in §3.3. |
| Language | TypeScript, `strict: true`. No `any` in domain or service code. |

---

## 2. Stack and setup commands

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --import-alias "@/*"
npm i prisma @prisma/client zod date-fns
npm i -D vitest @vitejs/plugin-react tsx
npx prisma init --datasource-provider postgresql
npx shadcn@latest init
npx shadcn@latest add button input label select table card badge dialog form sonner tabs separator alert
```

**Version traps you must handle:**

- In **Next.js 15+**, `cookies()`, `headers()`, and route `params` / `searchParams` are **async**.
  `await` them. If you scaffold Next 14, they are sync. Detect which you have and be consistent.
- Prisma `Decimal` values **cannot cross the server→client component boundary**. Convert to
  `string` (or a formatted currency string) inside the server component or service DTO. See §3.2.
- Server Actions handle `FormData` with files natively. Set
  `experimental.serverActions.bodySizeLimit` (Next 14) or `serverActions.bodySizeLimit` (Next 15)
  to `'6mb'` in `next.config.ts`.

---

## 3. LOCKED DECISIONS

`architecture.md` leaves these open. They are now closed. **Do not renegotiate them, do not
"improve" them mid-build.** If you believe one is wrong, say so in your final report — do not
silently deviate.

### 3.1 Money is `Decimal`, never `Float`

All monetary columns are `Decimal @db.Decimal(12, 2)`. All arithmetic uses `Prisma.Decimal`
(`new Prisma.Decimal(...)`, `.plus()`, `.minus()`, `.gt()`, `.lte()`). **Never** convert to
JavaScript `number` for arithmetic — float money produces wrong sums and a visibly broken balance.

### 3.2 Decimal serialization boundary

Services return DTOs where money is already a `string`:

```ts
type FeeSummary = {
  currency: string;          // "BDT"
  totalFee: string;          // "150000.00"
  totalPaid: string;         // "90000.00"
  outstanding: string;       // "60000.00"
  dueDate: Date | null;
  isOverdue: boolean;
  hasFeeAssigned: boolean;   // false when the student has no StudentFee row
  matchesTariff: boolean;    // false when the fee differs from the tariff for the student's current programme/year
};
```

Format for display with a single shared helper: `lib/utils/format.ts` → `formatCurrency(value, currency)`.

### 3.3 Role toggle lives in a cookie, read server-side

`architecture.md` never says where the role lives. If it lives in React state, the server-side
enforcement required by its §13 is impossible. Therefore:

- Cookies: `pp_role` (`"staff" | "student"`) and `pp_student_id` (the business `studentId`, e.g. `SMS-2026-0001`).
- `src/lib/auth/session.ts` exports `getSession(): Promise<Session>` reading those cookies, defaulting to `{ role: "staff" }`.
- A server action `setRole(role, studentId?)` writes the cookies and calls `revalidatePath("/", "layout")`.
- **Every student-facing query derives the student from `getSession()`.** Never from a URL param,
  a form field, or any client-supplied value. A student must not be able to read another
  student's data by changing a URL.
- Structure this so real auth can replace `getSession()` later without touching the domain layer.

### 3.4 File storage: local disk behind an interface

- Files are written to `storage/uploads/` at the repo root. This directory is **gitignored**
  except for a `.gitkeep`.
- It is **outside** `public/` — files are never statically served.
- All filesystem access goes through `src/lib/storage/index.ts`:

```ts
export interface FileStorage {
  save(file: File, key: string): Promise<{ url: string; size: number }>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

  with a `LocalFileStorage` implementation. **No `fs` calls anywhere else in the codebase.**
- Download route: `src/app/api/files/[submissionId]/route.ts`. It looks the submission up by id,
  enforces the session rule from §3.3 (a student may only download their own submission),
  and streams the file. **Never accept a filesystem path from the client** — path traversal.
- Stored key format: `${submissionId}${ext}`. The original filename is kept in `fileName` and
  used for the `Content-Disposition` header.
- **Document in the README** that local disk does not persist on serverless hosts (Vercel), and
  that swapping in S3/Vercel Blob means implementing `FileStorage` only.

### 3.5 Fee assignment is a snapshot; the missing-fee case

The brief says *assign a fee amount to each student based on their programme*. Rationale in
`architecture.md` §6A.

- `ProgrammeFee` is the **tariff** for `(programmeId, academicYear)`. `StudentFee` is the fee
  actually assigned to one student.
- `createStudent` creates the `StudentFee` **in the same transaction** by copying `amount`,
  `currency` and `dueDate` from the matching tariff, with `programmeFeeId` set.
- No matching tariff → no `StudentFee`. This is a first-class state:
  - `hasFeeAssigned: false`, `totalFee: "0.00"`, `isOverdue: false`.
  - The UI shows **"No fee assigned"** — not "0 BDT outstanding".
  - Recording a payment is **rejected** with `"No fee has been assigned to this student."`
- `assignStudentFee` (staff) sets or adjusts the fee, either from the tariff or as a manual amount
  (`programmeFeeId: null`). Rejected when the amount is ≤ 0 or below the total already paid:
  `"Fee cannot be less than the amount already paid (X)."`
- Editing a tariff never changes existing `StudentFee` rows.
- Editing a student's programme or academic year never changes their fee. The fee summary returns
  `matchesTariff: false` and the staff UI offers "Reassign from tariff".
- Overdue uses `StudentFee.dueDate`.

### 3.6 Submission eligibility; resubmission only before the deadline

The brief: *upload against an **open** assessment* · *allow resubmission **before the deadline*** ·
*late submissions are accepted but visually flagged*. `architecture.md` §8–§10.

A submission is accepted only when **all** of these hold, checked server-side:

- `assessment.isOpen` → else `"This assessment is closed for submissions."`
- `student.enrolmentStatus === "ENROLLED"` → else `"Only enrolled students can submit."`
- `student.programmeId === assessment.programmeId` → else not found (the assessment is not
  visible to that student).

Then:

- **No existing submission** → create. Accepted at any time while open; `isLate` computed.
- **Existing submission and `now <= deadline`** → replace the row (unique on
  `studentId + assessmentId`), set `submittedAt = now()`, recalculate `isLate`, and delete the old
  file from storage after the new one is written.
- **Existing submission and `now > deadline`** → **rejected** with
  `"The deadline has passed. Your existing submission can no longer be replaced."`
  The existing file is untouched.
- No version history is kept.

### 3.7 Server Actions for the UI; a thin JSON API over the same services

The brief grades *working API routes*, so Route Handlers are required. They must not duplicate
business logic.

- **UI mutations and reads** use Server Actions and server component queries.
- **JSON API** at `src/app/api/**/route.ts` exposes the same operations. The route list is
  `architecture.md` §17.1 — build exactly those routes, no others.
- Both are adapters: parse input → Zod → service → map the result. **Business rules live only in
  `src/lib/services` and `src/lib/domain`.**
- `src/lib/api/response.ts` maps `ActionResult` to HTTP: `200`/`201` success · `400` validation
  (with `fieldErrors`) · `403` wrong role · `404` not found · `409` conflict (duplicate email or
  reference, deadline passed, closed assessment) · `500` unexpected, with a generic message.
- Error body: `{ "error": string, "fieldErrors"?: Record<string, string[]> }`.
- Role and student identity come from `getSession()` (§3.3), never from the body or query.
- Document every route with a `curl` example in the README.

---

## 4. Prisma schema

Use this verbatim as `prisma/schema.prisma`. It is the corrected, final schema, revised after the
requirements review (`architecture.md` §1.2).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum EnrolmentStatus {
  ENROLLED
  DEFERRED
  WITHDRAWN
  COMPLETED
}

model Programme {
  id          String   @id @default(uuid())
  code        String   @unique
  name        String
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  students    Student[]
  fees        ProgrammeFee[]
  assessments Assessment[]

  @@index([active])
}

// Fee tariff: the default fee for a programme in an academic year.
model ProgrammeFee {
  id           String   @id @default(uuid())
  programmeId  String
  academicYear Int
  amount       Decimal  @db.Decimal(12, 2)
  currency     String   @default("BDT")
  dueDate      DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  programme   Programme    @relation(fields: [programmeId], references: [id], onDelete: Cascade)
  studentFees StudentFee[]

  @@unique([programmeId, academicYear])
  @@index([programmeId])
}

// The fee actually assigned to a student, copied from the tariff at enrolment.
model StudentFee {
  id             String   @id @default(uuid())
  studentId      String   @unique
  programmeFeeId String?
  amount         Decimal  @db.Decimal(12, 2)
  currency       String   @default("BDT")
  dueDate        DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  student      Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  programmeFee ProgrammeFee? @relation(fields: [programmeFeeId], references: [id], onDelete: SetNull)

  @@index([programmeFeeId])
  @@index([dueDate])
}

model Student {
  id              String          @id @default(uuid())
  studentId       String          @unique
  fullName        String
  email           String          @unique
  dateOfBirth     DateTime
  programmeId     String
  academicYear    Int
  enrolmentStatus EnrolmentStatus @default(ENROLLED)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  programme   Programme    @relation(fields: [programmeId], references: [id])
  fee         StudentFee?
  payments    Payment[]
  submissions Submission[]
  results     Result[]

  @@index([programmeId])
  @@index([enrolmentStatus])
  @@index([academicYear])
}

model Payment {
  id              String   @id @default(uuid())
  studentId       String
  amount          Decimal  @db.Decimal(12, 2)
  paymentDate     DateTime
  referenceNumber String   @unique
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([studentId])
  @@index([paymentDate])
}

model Assessment {
  id                 String   @id @default(uuid())
  programmeId        String
  title              String
  module             String
  submissionDeadline DateTime
  isOpen             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  programme   Programme    @relation(fields: [programmeId], references: [id])
  submissions Submission[]
  results     Result[]

  @@index([programmeId])
  @@index([submissionDeadline])
}

model Submission {
  id           String   @id @default(uuid())
  studentId    String
  assessmentId String
  fileName     String
  fileUrl      String
  fileType     String
  fileSize     Int
  submittedAt  DateTime
  isLate       Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  student    Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)
  assessment Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@unique([studentId, assessmentId])
  @@index([studentId])
  @@index([assessmentId])
  @@index([isLate])
}

model Result {
  id           String   @id @default(uuid())
  studentId    String
  assessmentId String
  grade        Int
  published    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  student    Student    @relation(fields: [studentId], references: [id], onDelete: Cascade)
  assessment Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@unique([studentId, assessmentId])
  @@index([studentId])
  @@index([assessmentId])
  @@index([published])
}
```

Notes:
- `academicYear` is `Int` (e.g. `2026`) so it can be range-validated.
- `grade` is `Int` — grades are whole numbers 0–100.
- **Classification is never stored.** It is derived. Same for outstanding balance.
- `StudentFee` is the assigned fee (a snapshot of the tariff); `ProgrammeFee` is only the default.
- `Assessment.programmeId` scopes who sees, submits to, and is graded for an assessment.
- `Assessment.isOpen` is staff-controlled; it is not derived from the deadline.

---

## 5. Domain layer — pure functions first

Write these as **pure, dependency-free functions** in `src/lib/domain/`. They take values, return
values, touch no database. They are the unit-test surface.

```ts
// lib/domain/fees.ts
export function calculateOutstanding(totalFee: Decimal, payments: Decimal[]): Decimal;
export function isOverdue(outstanding: Decimal, dueDate: Date | null, now: Date): boolean;
export function isValidFeeAmount(amount: Decimal, totalPaid: Decimal): boolean;

// lib/domain/results.ts
export type Classification = "Distinction" | "Merit" | "Pass" | "Fail";
export function calculateClassification(grade: number): Classification;

// lib/domain/submissions.ts
export function isSubmissionLate(submittedAt: Date, deadline: Date): boolean;
export function canReplaceSubmission(now: Date, deadline: Date): boolean;

// lib/domain/student-id.ts
export function formatStudentId(year: number, sequence: number): string; // SMS-2026-0001
export function parseStudentIdSequence(studentId: string): number;
```

**Exact semantics — do not deviate:**

```
outstanding      = totalFee - sum(payments)          // never below zero in display
isOverdue        = outstanding > 0 && now > dueDate  // strictly greater
classification   = grade >= 70 ? Distinction
                 : grade >= 60 ? Merit
                 : grade >= 40 ? Pass
                 : Fail
isLate           = submittedAt > deadline            // strictly greater
                                                     // submitting exactly AT the deadline is ON TIME
```

Additional semantics:

```
canReplace       = now <= deadline                   // exactly AT the deadline may still replace
feeValid         = amount > 0 && amount >= totalPaid
```

### Student ID generation must be race-safe

Format `SMS-{academicYear}-{sequence padded to 4}`. Generate **inside a transaction**:

1. `SELECT` the highest existing `studentId` with prefix `SMS-{year}-`, ordered descending.
2. Increment the parsed sequence.
3. Insert the student, plus its `StudentFee` when a tariff matches (§3.5).
4. On Prisma error `P2002` (unique violation on `studentId`), retry — up to 3 attempts.

Never derive the business `studentId` from the internal `id`.

### Payment recording must be transactional

The check "payment ≤ outstanding" is a read-then-write race. Wrap the whole operation in
`prisma.$transaction`: recompute the outstanding balance **inside** the transaction, validate,
then insert. Reject on failure with a domain error, not a raw Prisma error.

The same applies to `assignStudentFee` (compare against total paid inside the transaction) and to
submission replacement (check the deadline against the server clock at write time).

---

## 6. Project structure

```
prisma/
  schema.prisma
  seed.ts
storage/
  uploads/.gitkeep
src/
  app/
    layout.tsx                    # role toggle in a shared header
    page.tsx                      # redirects based on session role
    (staff)/staff/
      dashboard/page.tsx
      students/page.tsx
      students/new/page.tsx
      students/[id]/page.tsx      # tabs: details | fees | submissions | results
      students/[id]/edit/page.tsx
      fees/page.tsx
      assessments/page.tsx
      assessments/[id]/page.tsx   # submissions list + grade entry
      results/page.tsx
    (student)/student/
      dashboard/page.tsx
      fees/page.tsx
      assessments/page.tsx
      marksheet/page.tsx
    api/                          # JSON API route handlers (§3.7, architecture.md §17.1)
      files/[submissionId]/route.ts
  actions/
    students.ts  payments.ts  assessments.ts  submissions.ts  results.ts  session.ts
  lib/
    prisma.ts                     # singleton, guarded against dev hot-reload duplication
    auth/session.ts
    domain/                       # pure functions (§5)
    services/                     # DB-touching orchestration, returns DTOs
    validations/                  # Zod schemas
    storage/                      # FileStorage interface + local impl
    utils/format.ts
    errors.ts                     # DomainError class + ActionResult type
    api/response.ts               # ActionResult → HTTP status + JSON body
  components/
    ui/                           # shadcn
    shared/                       # StatusBadge, EmptyState, DataTable, RoleToggle, Money
    staff/  student/
  types/
tests/
  domain/  validations/
```

**Do not add abstraction layers beyond this.** A service exists only where it makes logic clearer
or reusable. No repository pattern over Prisma. No dependency-injection container.

### Action return shape

Every server action returns a discriminated result — never throws to the client:

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ErrorCode; fieldErrors?: Record<string, string[]> };

type ErrorCode = "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";
```

Catch Prisma errors in the service layer and map them to human messages. **Never surface a raw
database error string to the UI.**

---

## 7. Build phases

Complete each phase and verify it before starting the next. Commit at each phase boundary.

### PHASE 0 — Foundation *(verify before proceeding)*

- [ ] Next.js app scaffolds and runs
- [ ] Postgres reachable; `DATABASE_URL` in `.env`; `.env.example` committed with placeholder values
- [ ] `.env` is gitignored
- [ ] `prisma migrate dev --name init` succeeds
- [ ] `prisma studio` shows all 8 tables

**Verify:** run the migration and open Prisma Studio. Do not proceed on an unverified DB connection.

### PHASE 1 — Domain + seed

- [ ] All pure functions in `src/lib/domain/` written
- [ ] Unit tests for every function, including boundaries (§11)
- [ ] All Zod schemas in `src/lib/validations/`
- [ ] `prisma/seed.ts` per §8, wired as `prisma.seed` in `package.json`
- [ ] `npx prisma migrate reset` runs migration **and** seed cleanly, repeatably

**Verify:** `npm test` passes. `npx prisma migrate reset` twice in a row both succeed.

### PHASE 2 — Services + actions

- [ ] Services for student, fee/payment, assessment, submission, result
- [ ] Server actions wrapping them, all returning `ActionResult`
- [ ] Every mutation validates with Zod **server-side** before touching the DB
- [ ] Student ID generation is transactional and retries on P2002
- [ ] Payment recording is transactional
- [ ] Fee assignment on student creation happens in the same transaction
- [ ] JSON API route handlers (`architecture.md` §17.1) over the same services, verified with `curl`

### PHASE 3 — Staff UI

Dashboard → Students → Fees → Assessments → Results, in that order. See §9.

### PHASE 4 — Student UI

Dashboard → Fees → Assessments → Marksheet. See §10.

### PHASE 5 — Quality

- [ ] Every edge case in §11 handled with a clear message
- [ ] Loading states (`loading.tsx` or Suspense), empty states, error states on every list
- [ ] `error.tsx` boundary per route group
- [ ] Confirmation dialog before publishing/withholding a result
- [ ] Toast feedback on every successful mutation
- [ ] Responsive at 375px, 768px, 1280px
- [ ] Currency and date formatting consistent everywhere

### PHASE 6 — Submission

- [ ] README complete per §13
- [ ] `.env.example` accurate
- [ ] Seed verified from a clean database
- [ ] `npm run build` succeeds with no type errors
- [x] ~~Fix `architecture.md` ERD and stray citation artifact~~ — done 2026-09-16. The ERD is now a
      Mermaid diagram (`architecture.md` §15).
- [ ] Clean, conventional commit history

---

## 8. Seed data specification

**Dates must be computed relative to `new Date()` at seed time.** Do not hardcode calendar dates —
a fixed 2025 due date makes every scenario "overdue" when the evaluator runs it later, destroying
the not-yet-due demo case.

Let `Y = currentYear`, `now = new Date()`.

**Programmes (2)**
| code | name | active |
|---|---|---|
| `BSC-CS` | BSc Computer Science | true |
| `MBA` | Master of Business Administration | true |

**Programme fees (2)**
| programme | year | amount | currency | dueDate | purpose |
|---|---|---|---|---|---|
| BSC-CS | Y | 150000.00 | BDT | `now - 30d` | enables the **overdue** scenario |
| MBA | Y | 250000.00 | BDT | `now + 60d` | enables **outstanding but not overdue** |

**Students (6)** — IDs `SMS-{Y}-0001` … `SMS-{Y}-0006`

| # | Programme | Status | Payments | Demonstrates |
|---|---|---|---|---|
| 1 | BSC-CS | ENROLLED | 150,000 (full) | fully paid |
| 2 | BSC-CS | ENROLLED | 50,000 + 40,000 | partially paid, **overdue** |
| 3 | BSC-CS | ENROLLED | none | **overdue**, no payment history |
| 4 | BSC-CS | DEFERRED | 75,000 | deferred status badge |
| 5 | MBA | ENROLLED | 100,000 | outstanding but **not** overdue |
| 6 | MBA | COMPLETED | 250,000 (full) | completed status badge |

Every student gets a `StudentFee` copied from their programme tariff (`programmeFeeId` set).

Give student 3 a distinct, obvious name in the UI (e.g. sorts near the top) so the overdue case is
easy to find. Payment reference numbers must be unique and realistic (`PAY-{Y}-0001`…).

**Assessments (4)**
| title | programme | module | deadline | isOpen |
|---|---|---|---|---|
| Database Systems Coursework | BSC-CS | Database Systems | `now - 14d` (past) | true — late submissions still accepted |
| Algorithms Assignment 1 | BSC-CS | Algorithms | `now + 10d` | true |
| Business Strategy Report | MBA | Strategy | `now + 21d` | true |
| Financial Accounting Essay | MBA | Financial Accounting | `now - 45d` | **false** (closed) |

**Submissions** — must include at least one late and at least one pending:
- Student 1 → Database Systems, `submittedAt = deadline - 3d`, `isLate: false`
- Student 2 → Database Systems, `submittedAt = deadline + 2d`, **`isLate: true`**
- Student 4 → Database Systems, `submittedAt = deadline - 1h`, `isLate: false` (made before the
  deferral; a deferred student keeps past work but cannot submit new work)
- Student 3 → **no submission** (pending state)
- Student 1 → Algorithms, on time
- Student 5 → Business Strategy, on time
- Student 6 → Financial Accounting, `submittedAt = deadline - 5d`, `isLate: false` (closed assessment)

Seed real placeholder files into `storage/uploads/` so downloads actually work — generate a
minimal valid PDF, don't write a `.txt` named `.pdf`.

**Results** — must include published and unpublished, and hit every classification boundary:
| student | assessment | grade | classification | published |
|---|---|---|---|---|
| 1 | Database Systems | 78 | Distinction | **true** |
| 2 | Database Systems | 70 | Distinction (boundary) | **true** |
| 4 | Database Systems | 60 | Merit (boundary) | **true** |
| 3 | Database Systems | 40 | Pass (boundary) | **false** (withheld) |
| 5 | Business Strategy | 35 | Fail | **false** (withheld) |
| 1 | Algorithms | 82 | Distinction | **false** |
| 6 | Financial Accounting | 65 | Merit | **true** |

The seed must be **idempotent** — use `upsert` on unique keys so re-running is safe.

Set the default demo student cookie target to `SMS-{Y}-0002` (partially paid, overdue, one late
submission, one published result) — it shows the most interesting state in one screen.

---

## 9. Staff UI specification

**Shared header:** app name, nav, and the role toggle (`[ Staff ] [ Student ]`). In student mode,
a select for which seeded student to view.

**Dashboard** — six stat cards, each reading live from the DB:
`Total Students` · `Enrolled Students` · `Total Outstanding` · `Overdue Students` ·
`Pending Submissions` · `Unpublished Results`

`Pending Submissions` counts ENROLLED students of each open assessment's programme who have not
submitted.

Below: an **Overdue Fees** table — student ID, name, programme, outstanding, days overdue.

**Students** — table with search (name / student ID) and filters (programme, status).
Search and filters must be **server-side**, driven by `searchParams`, not client array filtering.
Columns: Student ID · Name · Programme · Year · Status badge · actions.
Create and edit forms. Detail page with tabs: Details / Fees / Submissions / Results.

**Fees** — per student: total fee, total paid, outstanding, due date, overdue badge, payment
history table, and a "Record Payment" dialog (amount, payment date, reference number).
An **Assign / Adjust Fee** dialog is **required**: default from the programme tariff, or a manual
amount and due date. When `matchesTariff` is false, show "Fee does not match programme tariff" with a
"Reassign from tariff" action. When no fee is assigned, show "No fee assigned" and disable Record
Payment.
A programme **tariff** management view is **optional** — seed data covers it. Build it only if
ahead of schedule.

**Assessments** — list with title, programme, module, deadline, Open/Closed badge, submission
count, graded count. Create/edit form (programme is required). Open/Close toggle with confirmation.
Detail page listing every **ENROLLED student of the assessment's programme** and their submission status:
`Submitted` / `Late` / `Pending`, with a download link and inline grade entry.

**Results** — select assessment → table of students → grade input (0–100) → live-calculated
classification → Save → Publish / Withhold. Publishing and withholding require confirmation.
A bulk "publish all for this assessment" action is welcome if cheap.

**Per-student marksheet** (the brief: publish or withhold *per student*) — on the student detail
Results tab, "Publish marksheet" and "Withhold marksheet" act on all of that student's results.
Before publishing for a student with an overdue balance, the confirmation dialog shows the overdue
amount. It warns; it does not block.

---

## 10. Student UI specification

All four screens resolve the student from the session cookie (§3.3), **never** from a URL.

- **Dashboard** — name, student ID, programme, academic year, enrolment status badge, plus
  at-a-glance outstanding balance and next deadline.
- **Fees** — total fee, total paid, outstanding, overdue badge, due date, payment history table.
  When no fee is assigned, show the §3.5 message.
- **Assessments** — assessments of the student's **own programme** only, with module, deadline,
  Open/Closed, submission status, late flag, and an upload control. Upload is shown only while the
  assessment is open and the student is ENROLLED. Replacing an existing submission asks for
  confirmation and is available only until the deadline; after it, show the existing submission
  and why it can no longer be replaced (§3.6).
- **Marksheet** — **published results only**. Assessment · module · grade · classification.
  Unpublished results must not appear, and must not be present in the payload sent to the client.

> The filtering of unpublished results happens in the **database query**
> (`where: { published: true }`), not in a React conditional. An evaluator will check this.

---

## 11. Edge case matrix

Each row must produce a clear, user-facing message — never a crash, never a raw DB error.

**Student**
| Case | Expected |
|---|---|
| Duplicate student ID | Impossible by construction; unique constraint + retry |
| Duplicate email | `"A student with this email already exists."` |
| Invalid email format | Field error from Zod |
| Missing required field | Field error |
| Date of birth in the future | `"Date of birth must be in the past."` |
| Date of birth implying age < 15 | `"Student must be at least 15 years old."` |
| Academic year outside `2000 … currentYear + 1` | Field error |
| Search returns nothing | Empty state: `"No students match your search."` |
| Assigning to an inactive programme | Excluded from the create-form dropdown |

**Fees**
| Case | Expected |
|---|---|
| Payment ≤ 0 | `"Payment amount must be greater than zero."` |
| Payment > outstanding | `"Payment exceeds the outstanding balance of X."` |
| Duplicate reference number | `"This payment reference already exists."` |
| No payment history | Empty state |
| Fully paid student | `Paid` badge, payment form disabled |
| No fee assigned | "No fee assigned", payment blocked (§3.5) |
| Fee adjusted to ≤ 0 or below total paid | `"Fee cannot be less than the amount already paid (X)."` |
| Tariff edited after enrolment | Existing assigned fees unchanged |
| Student's programme/year edited | Fee unchanged; "does not match tariff" notice with reassign action |
| Future payment date | `"Payment date cannot be in the future."` |

**Assessment / Submission**
| Case | Expected |
|---|---|
| Missing title or module | Field error |
| Deadline in the past on create | Allowed, but warn — needed to seed closed assessments |
| File is not PDF or DOCX | `"Only PDF and DOCX files are accepted."` |
| File > 5 MB | `"File must be smaller than 5 MB."` |
| Submitted before deadline | Accepted, `isLate: false` |
| Submitted **exactly at** deadline | Accepted, `isLate: false` |
| Submitted after deadline | **Accepted**, `isLate: true`, visibly flagged in staff UI |
| Missing programme on create | Field error |
| Resubmission before or exactly at deadline | Replaces record, recalculates `isLate`, deletes old file |
| Resubmission after deadline | `"The deadline has passed. Your existing submission can no longer be replaced."` |
| Submission to a closed assessment | `"This assessment is closed for submissions."` |
| Submission by a non-ENROLLED student | `"Only enrolled students can submit."` |
| Submission to another programme's assessment | Not found (the assessment is not visible to the student) |

Validate file type by **both** extension and MIME type:
`application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

**Results**
| Case | Expected |
|---|---|
| Grade < 0 or > 100 | `"Grade must be between 0 and 100."` |
| Grade exactly 40 / 60 / 70 | Pass / Merit / Distinction — cover in tests |
| Non-integer grade | Rejected |
| Existing result re-graded | **Updates** the row, never creates a duplicate |
| Student requests unpublished result | Not returned by the query at all |
| Grade for a student outside the assessment's programme | `"This student is not in the assessment's programme."` |
| Publishing for a student with an overdue balance | Confirmation shows the overdue amount; not blocked |
| New grade after a marksheet was published | Saved unpublished |

---

## 12. Testing

**Vitest.** Mandatory unit coverage:

```
calculateOutstanding()     — zero payments, partial, exact, overpayment guard
isOverdue()                — outstanding=0 past due; outstanding>0 before due;
                             outstanding>0 after due; exactly at due date
calculateClassification()  — 0, 39, 40, 59, 60, 69, 70, 100
isSubmissionLate()         — before, exactly at, after deadline
canReplaceSubmission()     — before, exactly at, after deadline
isValidFeeAmount()         — zero, below paid, equal to paid, above paid
formatStudentId()          — padding, sequence rollover 9 → 10 → 100
```

Plus Zod schema tests: grade `-1`, `0`, `40`, `60`, `70`, `100`, `101`, `70.5`; payment `0`,
`-100`, valid; email valid/invalid; future date of birth.

Service-level integration tests against a test database are **optional** — do them only if Phase 5
finishes early. Never skip the unit tests to make room for them.

---

## 13. README requirements

Sections, in this order:

1. Project overview
2. Features (staff and student, separately)
3. Architecture — include the layer diagram, the ERD, and the JSON API route table with `curl` examples
4. Technology stack
5. Prerequisites
6. Environment variables — every var, with a description
7. Local setup — copy-pasteable, from clone to running app
8. Database setup and migration
9. Seed data — what it creates and which scenario each student demonstrates
10. Demo role toggle — how to switch views and which student to look at
11. Business rules — the formulas, stated plainly
12. **Design decisions** — every locked decision in §3, with its rationale. This section is
    where the assessment's "deliberate product decisions" are actually graded. Write it properly.
13. Edge cases handled
14. Testing — how to run, what is covered
15. **AI usage** — which tools, for what, and the explicit statement that all generated output was
    reviewed, tested, and adapted. Required by the assessment.
16. Known limitations — local file storage and serverless, no auth, no submission version history,
    no partial-payment schedule

---

## 14. Anti-goals — do NOT build

Microservices · message queues · Kubernetes · Redis · a separate backend framework · GraphQL ·
tRPC · complex RBAC · SSO · multi-tenancy · a full accounting system · a full LMS · email or
notification infrastructure · a workflow engine · an AI chatbot · dark mode · animation libraries ·
i18n · a custom design system · a repository pattern over Prisma · a DI container ·
API route handlers that re-implement business logic instead of calling the service layer ·
API routes beyond the list in `architecture.md` §17.1.

This is a focused Registry module, not a platform.

---

## 15. Working agreement

1. **Verify, don't assume.** Run the migration, run the seed, run the tests, load the page. Do not
   report a phase complete on the basis that the code "looks right."
2. **Report failures honestly.** If tests fail, say so and paste the output. If you skipped
   something, say what and why. A truthful partial result is worth more than a confident false one.
3. **No mocked data. Ever.** If a screen has no data, fix the seed — do not hardcode an array.
4. **Server-side enforcement is the graded property.** Any rule enforced only by a disabled button
   or a hidden `<div>` is not implemented.
5. **Commit per phase**, conventional-commit style
   (`feat(students): server-side search and filters`). No single giant commit — clean history is on
   the assessment checklist.
6. **Do not push, do not create a remote, do not open a PR** unless explicitly asked.
7. **Do not install a dependency** not listed in §2 without saying why in your report.
8. When you hit a genuine ambiguity this file does not cover: pick the simplest option consistent
   with §0's priority order, proceed, and **flag it in your final report**. Do not stall.

---

## 16. Definition of done

**Enrolment** — staff create students · student ID auto-generated and unique · search works ·
filters work · all four statuses render.

**Fees** — programme tariffs exist · fee assigned to each student at enrolment and adjustable · payments record ·
outstanding calculates correctly · overdue students identified · missing-fee case handled.

**Assessments** — staff create assessments per programme · staff open and close them · students upload
PDF/DOCX to open assessments of their programme · one active submission per student per assessment ·
resubmission replaces before the deadline and is rejected after it · late submissions accepted and flagged ·
invalid types and oversized files rejected.

**Results** — staff enter grades · 0–100 validated · classification derived · publish and withhold
work per result and per student · students see published results only, enforced in the query.

**Engineering** — PostgreSQL · Prisma · schema committed · no mocked data · seed works from clean ·
error handling on every mutation · JSON API routes work (curl-verified) · unit tests pass · `npm run build` clean · README complete ·
`.env.example` present · AI usage documented · clean commit history.

---

**Primary objective:** a focused, reliable Registry module that demonstrates stakeholder
understanding, edge-case awareness, technical quality, and responsible AI-assisted development.
