# Student Management System — Registry Module
## Architecture & Database Design

> **Purpose:** Architecture specification for the PEN Global technical assessment.
>
> **Required stack:** Next.js 16+ (App Router), PostgreSQL, Prisma ORM, Tailwind CSS or a component library (Shadcn UI preferred).
>
> **Assessment constraint:** This is a focused Registry module, not a full Student Management System. Prioritize deliberate product decisions, edge cases, clean schema/API design, and a working end-to-end MVP.
>
> **This document is the single specification for the build.** Where the code and this document disagree, fix one of them in the same change. Progress is tracked in [PROGRESS.md](PROGRESS.md); a one-line-per-step history is kept in [development_log.md](development_log.md) (§2.4).

---

## 1. Assessment Scope

The application covers four daily Registry workflows:

1. Student Enrolment
2. Fees & Payments
3. Assessment Submission
4. Marksheet & Results

The assessment requires:

- Next.js 16+ with App Router
- PostgreSQL
- Prisma ORM
- Real database data
- No separate backend framework
- GitHub repository
- README with local setup, environment variables, and AI usage
- Seed script with at least 5 students, 2 programmes, fees, and sample grades
- Staff view and Student view
- Authentication is optional; a simple role toggle is acceptable

## 1.1 Requirement Traceability

The source of truth is the PEN Global assessment brief (PDF). It is marked for recruitment use only, so it is **not committed**; the requirements are paraphrased here. Every requirement maps to a section of this document.

| ID | Requirement (paraphrased from the brief) | Addressed in |
|---|---|---|
| E1 | Create student records: full name, email, date of birth, programme, academic year, enrolment status | §4.2, §20 |
| E2 | Auto-generate a unique Student ID (e.g. `SMS-2025-0001`) | §4.2 |
| E3 | Enrolment statuses: Enrolled, Deferred, Withdrawn, Completed | §5 |
| E4 | Search and filter students by name, ID, programme, or status | §20 |
| F1 | Assign a fee amount to each student based on their programme | §6, §6A, §21 |
| F2 | Record payment transactions: amount, date, reference number | §7, §21 |
| F3 | Show outstanding balance in real time | §7 |
| F4 | Flag students with an overdue balance on the Registry dashboard | §19 |
| A1 | Staff create an assessment: title, module, submission deadline | §8, §22 |
| A2 | Students upload a PDF or DOCX against an **open** assessment | §8, §9 |
| A3 | One submission per student per assessment; allow resubmission **before the deadline** | §9 |
| A4 | Late submissions are accepted but visually flagged | §10 |
| R1 | Staff enter a numeric grade (0–100) per student per assessment | §11, §23 |
| R2 | Classification: Pass ≥ 40, Merit ≥ 60, Distinction ≥ 70 | §12 |
| R3 | Staff publish or withhold results **per student** | §13, §23 |
| R4 | Students see their marksheet only after it has been published | §13, §24 |
| S1 | GitHub repository; README with local setup, `.env` variables, and AI usage | §37, §38 |
| S2 | Seed script: at least 5 students, 2 programmes, fees, and sample grades | §28 |
| S3 | Staff view and Student view; a simple role toggle is acceptable (we built real sign-in, §27) | §27 |
| T1 | Clean schema, **working API routes**, basic error handling | §16, §17.1, §29, §31 |
| C1 | Next.js 16+ App Router; PostgreSQL + Prisma with committed schema; Tailwind / shadcn; no other backend framework; no mocked `useState` data; `.env` example, no committed credentials | §2, §33 |

### How the brief is graded

| Dimension | Weight | What it means for this build |
|---|---|---|
| Stakeholder understanding | 30% | Data model and UI match how a Registry team works (§6A, §8, §13) |
| Feature intuition | 30% | Edge cases handled without being told: overdue fees, late submissions, withheld results (§25) |
| Technical quality | 25% | Clean schema, working API routes, basic error handling (§16, §17.1, §31) |
| AI usage | 15% | README explains how AI was used during the build (§38) |

## 1.2 Requirements Review — 2026-09-16

A line-by-line re-check of the brief against the first draft of this document found these gaps. Each is resolved in the sections listed.

| # | Gap in the first draft | What the brief says | Resolution |
|---|---|---|---|
| 1 | The fee was derived live from the programme tariff. Staff had no in-app way to assign a fee, and editing a tariff would rewrite the balance of students who had already paid. | Assign a fee amount to each student based on their programme (F1) | New `StudentFee` entity: copied from the programme tariff at enrolment, adjustable by staff (§6A) |
| 2 | Assessments were not linked to a programme, so every student would see, and be counted as pending for, every assessment. | Students submit against assessments created by staff (A1–A2) | `Assessment.programmeId` (§8, §19) |
| 3 | No concept of an open assessment, so late submissions could be accepted forever. | Upload against an **open** assessment (A2) | `Assessment.isOpen`, controlled by staff (§8, §9) |
| 4 | An earlier implementation plan allowed resubmission at any time. | Allow resubmission **before the deadline** (A3) | Replacing a submission after the deadline is rejected; a first late submission is still accepted (§9, §10) |
| 5 | Publishing was designed per result and per assessment only. | Publish or withhold results **per student** (R3) | Per-student marksheet publish / withhold (§13, §23) |
| 6 | An earlier implementation plan removed every API route except file download. | Working API routes are graded (T1) | Small JSON API of Route Handlers over the shared service layer (§17.1, §29) |
| 7 | Deferred, withdrawn and completed students could submit and were counted as pending. | Stakeholder understanding (30%) | Only `ENROLLED` students of the assessment's programme can submit or count as pending (§9, §19) |

---

# 2. Architecture

## 2.1 High-Level Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    Next.js Application                  │
│                    App Router                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Staff UI                         Student UI             │
│  ├── Dashboard                   ├── Dashboard           │
│  ├── Students                    ├── Fees                │
│  ├── Fees & Payments             ├── Assessments         │
│  ├── Assessments                 └── Marksheet            │
│  └── Results                                             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│              Application / Domain Logic                 │
│                                                         │
│  Student Service                                      │
│  Fee Service                                          │
│  Assessment Service                                   │
│  Submission Service                                   │
│  Result Service                                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                 Next.js Server Layer                     │
│                                                         │
│  Server Actions / Route Handlers                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    Prisma ORM                            │
├─────────────────────────────────────────────────────────┤
│                  PostgreSQL                              │
└─────────────────────────────────────────────────────────┘
```

## 2.2 Architectural Principles

- Use Next.js App Router.
- Keep server-side business rules on the server.
- Use Prisma as the database access layer.
- PostgreSQL is the source of truth.
- Do not mock application data in `useState`.
- Use Server Actions for suitable mutations.
- Use Route Handlers when an HTTP endpoint is genuinely useful.
- Keep domain/business logic separate from presentation where practical.
- Do not introduce another backend framework.
- Avoid unnecessary infrastructure and overengineering.

## 2.3 Technology Stack and Versions

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19 |
| Language | TypeScript, `strict: true`. No `any` in domain or service code. |
| Database | PostgreSQL |
| ORM | Prisma 6.12 (`prisma-client-js`), configured in `prisma.config.ts` |
| Authentication | Auth.js — `next-auth@5.0.0-beta.32` (pinned: v5 is a beta) and `bcryptjs` (§27) |
| Validation | Zod 4, always on the server |
| UI | Tailwind CSS 4 and shadcn/ui (Base UI primitives, `cn` class-merging package) |
| Dates | Built-in `Intl` (no date library needed, §30) |
| Tests | Vitest (`vitest`), Node environment; `@types/node` 22 to match the Node 22 runtime |
| Scripts | `tsx` (runs `prisma/seed.ts`) |

Any other dependency needs a reason, recorded in PROGRESS.md.

### Version notes

- **Next.js 16:** `cookies()`, `headers()`, route `params` and `searchParams` are async — `await` them.
- **Next.js 16:** middleware is now **Proxy** (`src/proxy.ts`) and runs on the Node.js runtime.
- **Next.js 16:** `next build` does not run ESLint. Run `npm run lint` separately.
- **Next.js 16:** uploads go through Server Actions, so set `experimental.serverActions.bodySizeLimit: "6mb"` in `next.config.ts` (files are capped at 5 MB, §32).
- **Prisma 6.12:** `prisma.config.ts` is early access — it needs `earlyAccess: true` and has no `datasource` key; the URL comes from `env("DATABASE_URL")` in the schema. The seed command is `package.json` → `prisma.seed`.
- **Prisma `Decimal`** values cannot cross the server → client component boundary. Convert money to strings in the service DTO (§7).

## 2.4 Working Rules

1. **Verify, don't assume.** Run the migration, the seed, the tests and the build, and load the page before marking anything done.
2. **Report honestly.** Failed checks and skipped work are written down in PROGRESS.md, not left out.
3. **No mocked data.** Every screen reads from PostgreSQL. If a screen has no data, fix the seed.
4. **Server-side enforcement is what counts.** A rule enforced only by a disabled button or a hidden element is not implemented.
5. **After every completed piece of work:**
   - update [PROGRESS.md](PROGRESS.md) (checklist, verification, open items, decisions);
   - append one line to [development_log.md](development_log.md).
6. **Commit per logical step** with conventional commits (`feat(students): server-side search and filters`). No single giant commit.
7. **When this document is silent,** choose the simplest option consistent with §42, then record the decision here and in the PROGRESS.md decision log.

---

# 3. Domain Model

## 3.1 Core Entities

The domain consists of eight core entities:

```text
Programme
    │
    ├──────────< ProgrammeFee          (fee tariff per academic year)
    │                  ┆
    │                  ┆ copied at enrolment
    │                  ▼
    ├──────────< Student ────────── StudentFee   (0..1, the fee actually assigned)
    │               │
    │               ├──────< Payment
    │               ├──────< Submission >──────┐
    │               └──────< Result >──────────┤
    │                                          │
    └──────────< Assessment ───────────────────┘
```

Entities:

1. `Programme`
2. `ProgrammeFee`
3. `StudentFee`
4. `Student`
5. `Payment`
6. `Assessment`
7. `Submission`
8. `Result`

---

# 4. Database Schema

The authoritative schema is [`prisma/schema.prisma`](../prisma/schema.prisma); migrations are in `prisma/migrations`. This section explains each model and its rules. A schema change always ships with a migration and an update to this section.

## 4.1 Programme

Represents an academic programme.

```text
Programme
---------
id
code
name
description
active
createdAt
updatedAt
```

### Rules

- `id`: internal UUID.
- `code`: required and unique.
- `name`: required.
- `active`: boolean.
- A programme can have many students.
- A programme can have many programme fee definitions.

Example:

```text
BSC-CS | BSc Computer Science
MBA    | Master of Business Administration
```

---

## 4.2 Student

The central academic entity.

```text
Student
-------
id
studentId
fullName
email
dateOfBirth
programmeId
academicYear
enrolmentStatus
createdAt
updatedAt
```

### Rules

- `id`: internal UUID.
- `studentId`: required and unique business identifier.
- `fullName`: required.
- `email`: required.
- `dateOfBirth`: required.
- `programmeId`: required.
- `academicYear`: required.
- `enrolmentStatus`: enum.
- A student belongs to one programme.
- A student has zero or one assigned fee (`StudentFee`, §6A).
- A student can have many payments.
- A student can have many submissions.
- A student can have many results.

### Student ID

Automatically generate IDs in the format:

```text
SMS-2025-0001
SMS-2025-0002
SMS-2025-0003
```

Do not use the internal database ID as the business-facing Student ID.

The year in the Student ID is the student's academic year at creation. The Student ID never changes afterwards, even if the academic year or programme is edited.

### Race-safe generation

Format `SMS-{academicYear}-{sequence padded to 4}`. Generate **inside a transaction**:

1. Take a transaction-scoped PostgreSQL advisory lock for that year (`pg_advisory_xact_lock`), so enrolments for the same year generate IDs one at a time.
2. Find the highest existing `studentId` with the prefix `SMS-{year}-` (numeric maximum).
3. Increment its sequence.
4. Insert the student, plus its `StudentFee` when a tariff matches (§6A). Committing releases the lock.
5. As a safety net only, retry on Prisma error `P2002` (unique violation on `studentId`) — up to 3 attempts.

Retrying alone is **not** enough: under a burst, every transaction reads the same maximum and only one wins each round (found by CI with 5 simultaneous enrolments).

Never derive the business `studentId` from the internal `id`.

```text
id        → internal identifier
studentId → business identifier
```

---

# 5. Enrolment Status

Use a Prisma enum rather than arbitrary strings.

```text
ENROLLED
DEFERRED
WITHDRAWN
COMPLETED
```

These correspond to the required assessment statuses.

---

# 6. ProgrammeFee (Fee Tariff)

Represents the standard fee for a programme in an academic year. It is the **default** used when a fee is assigned to a student (§6A). It is not the student's fee itself: changing a tariff never changes fees already assigned.

```text
ProgrammeFee
------------
id
programmeId
academicYear
amount
currency
dueDate
createdAt
updatedAt
```

### Rules

- `programmeId`: required foreign key.
- `academicYear`: required.
- `amount`: positive monetary amount.
- `currency`: required; use `BDT` for demo data unless another requirement is introduced.
- `dueDate`: default payment deadline, copied into each assigned `StudentFee`.
- A programme can have different fees for different academic years.

Example:

```text
Programme: BSc Computer Science
Academic Year: 2025
Amount: 150000
Currency: BDT
Due Date: 2025-10-31
```

### Product Decision — Overdue Balance

The assessment requires overdue balances but does not specify a detailed payment schedule.

For this MVP:

```text
overdue = today (Dhaka) > studentFee.dueDate AND outstandingBalance > 0
```

Document this as an explicit product decision in the README.

---

# 6A. StudentFee

Represents the fee actually assigned to one student.

```text
StudentFee
----------
id
studentId
programmeFeeId
amount
currency
dueDate
createdAt
updatedAt
```

### Rules

- `studentId`: required and unique — one assigned fee per student.
- `programmeFeeId`: optional. The tariff the fee was copied from; `null` when staff set the fee manually.
- `amount`: greater than zero, and never below the total the student has already paid.
- `currency` and `dueDate`: required.
- **On student creation**, if a `ProgrammeFee` exists for `(programmeId, academicYear)`, a `StudentFee` is created in the same transaction by copying `amount`, `currency` and `dueDate`.
- If no tariff exists, the student has **no assigned fee**. The UI shows "No fee assigned" (not "0 BDT outstanding"), payments are blocked, and staff can assign a fee manually.
- Staff can **adjust** the amount or due date, for example for a scholarship or an agreed extension.
- Editing a student's programme or academic year does **not** silently change their fee. The staff UI shows that the assigned fee no longer matches the programme tariff and offers an explicit "Reassign from tariff" action.

### Product Decision — Assigned (snapshot) fee, not derived fee

The brief says to *assign a fee amount to each student based on their programme*.

A fee derived live from `ProgrammeFee` has two problems a Registry would reject:

1. Editing a tariff rewrites the balance of every existing student, including students who have already paid in full.
2. There is nowhere to record a student-specific amount (scholarship, discount, agreed arrangement).

So the programme tariff supplies the default, and the student's fee is copied into `StudentFee` at enrolment. The outstanding balance is still calculated, never stored (§7).

---

# 7. Payment

Represents an individual payment transaction.

```text
Payment
-------
id
studentId
amount
paymentDate
referenceNumber
createdAt
updatedAt
```

### Rules

- A payment belongs to exactly one student.
- `amount` must be greater than zero.
- `referenceNumber` should be unique.
- Payment cannot exceed the student's current outstanding balance.
- Payment date is required and cannot be in the future.
- A payment is rejected when the student has no assigned fee.

### Outstanding Balance

Do not store `outstandingBalance` as a manually editable field.

Calculate:

```text
Outstanding Balance =
StudentFee.amount - SUM(Payments)
```

This avoids data inconsistency. Displayed outstanding is never below zero.

Example:

```text
Assigned Fee:       150,000 BDT
Payment #1:          50,000 BDT
Payment #2:          40,000 BDT
--------------------------------
Paid:                90,000 BDT
Outstanding:         60,000 BDT
```

### Money

- All monetary columns are `Decimal @db.Decimal(12, 2)`.
- All arithmetic uses `Prisma.Decimal` (`.plus()`, `.minus()`, `.gt()`, `.lte()`). **Never** convert to JavaScript `number` for arithmetic.
- Services return DTOs with money already as strings, because `Decimal` cannot be passed to client components:

```ts
type FeeSummary = {
  currency: string;          // "BDT"
  totalFee: string;          // "150000.00"
  totalPaid: string;         // "90000.00"
  outstanding: string;       // "60000.00"
  dueDate: Date | null;
  isOverdue: boolean;
  hasFeeAssigned: boolean;   // false when the student has no StudentFee
  matchesTariff: boolean;    // false when the fee differs from the tariff for the student's current programme/year
};
```

- Display uses one helper: `src/lib/utils/format.ts` → `formatCurrency(value, currency)`.

### Transactions

"Payment ≤ outstanding" is a read-then-write race. Recording a payment runs in `prisma.$transaction`: recompute the outstanding balance **inside** the transaction, validate, then insert. The same applies to assigning or adjusting a fee (compare against total paid inside the transaction). Failures return a domain error, never a raw Prisma error.

Both operations first lock the student's row (`SELECT … FROM "Student" WHERE id = … FOR UPDATE`), so concurrent payments and fee changes for one student run one at a time. Verified: five simultaneous 40,000 BDT payments against a 150,000 BDT fee accept exactly three.

---

# 8. Assessment

Represents an assessment created by staff for one programme.

```text
Assessment
----------
id
programmeId
title
module
submissionDeadline
isOpen
createdAt
updatedAt
```

### Rules

- `programmeId`: required. Only students of this programme see the assessment, submit to it, or receive a result for it.
- `title`: required.
- `module`: required (free text, e.g. "Database Systems").
- `submissionDeadline`: required.
- `isOpen`: boolean, default `true`. Staff close an assessment to stop accepting submissions.
- Assessment can have many submissions.
- Assessment can have many results.

### Product Decision — What "open" means

The brief says students upload *against an open assessment*, and also that *late submissions are accepted*. So "open" cannot mean "before the deadline".

`isOpen` is a staff-controlled state:

```text
isOpen = true   → submissions accepted (after the deadline they are flagged late)
isOpen = false  → all new submissions and replacements rejected
```

Without it, late submissions would be accepted indefinitely, including after marking has started. Grades can still be entered for a closed assessment.

---

# 9. Submission

Represents a student's submission for an assessment.

```text
Submission
----------
id
studentId
assessmentId
fileName
fileUrl
fileType
fileSize
submittedAt
isLate
createdAt
updatedAt
```

### Rules

- Submission belongs to one student.
- Submission belongs to one assessment.
- The assessment must be open (`isOpen = true`).
- The student must be `ENROLLED` and belong to the assessment's programme.
- Maximum file size: 5 MB.
- File type is checked by **both** extension and MIME type (§32).
- The replacement deadline check uses the server clock at write time.
- Accept PDF and DOCX only.
- Store file metadata in PostgreSQL, not binary document contents.
- Store the actual document using the selected file-storage mechanism.
- A student has one active submission per assessment.
- Use a unique constraint on:

```text
(studentId, assessmentId)
```

### Resubmission

The brief allows resubmission **before the deadline**.

```text
canReplace = now <= assessment.submissionDeadline AND assessment.isOpen
```

Before, or exactly at, the deadline, a resubmission replaces the existing record:

```text
fileUrl      → latest file
fileName     → latest file
fileType     → latest file
fileSize     → latest file
submittedAt  → latest submission time (server clock)
isLate       → recalculated
```

- The previous file is deleted from storage after the new one is saved.
- After the deadline, replacing an existing submission is **rejected**: "The deadline has passed. Your existing submission can no longer be replaced."
- A **first** submission after the deadline is still accepted and flagged late (§10). Only replacement is blocked.

Rationale: after the deadline, staff may already be marking the submitted work. Replacing it would change work that is under review.

A full submission-version history is intentionally not required for this assessment.

---

# 10. Late Submission

Late submissions are accepted but must be visibly flagged.

Calculate this on the server:

```text
isLate = submittedAt > assessment.submissionDeadline
```

Do not trust a client-provided `isLate` value.

Submitting exactly at the deadline is **on time** (the comparison is strictly greater than).

A first submission made after the deadline, while the assessment is still open, should:

- Be accepted.
- Be stored.
- Have `isLate = true`.
- Be visibly marked in the Staff UI.

---

# 11. Result

Represents a student's grade for an assessment.

```text
Result
------
id
studentId
assessmentId
grade
published
createdAt
updatedAt
```

### Rules

- `grade` must be between 0 and 100.
- One result per student per assessment.
- A result can only be entered for a student of the assessment's programme.
- `grade` is a whole number.
- Unique constraint:

```text
(studentId, assessmentId)
```

- `published = false` by default.
- Students can only see published results.

---

# 12. Grade Classification

Do not store classification as independent mutable data.

Calculate it from the numeric grade:

```text
70–100 → Distinction
60–69  → Merit
40–59  → Pass
0–39   → Fail
```

Application logic:

```typescript
if (grade >= 70) return "Distinction";
if (grade >= 60) return "Merit";
if (grade >= 40) return "Pass";
return "Fail";
```

This prevents classification and grade from becoming inconsistent.

---

# 13. Result Publishing

Results have two states:

```text
published = false
published = true
```

### Staff

Staff can:

- Enter and save a grade.
- Publish or withhold a single result.
- Publish or withhold a **student's whole marksheet** (all of that student's results) in one action. The brief asks for publish / withhold *per student*.
- Publish all results for one assessment (bulk convenience).

### Student

Student queries must only return:

```text
published = true
```

A withheld result must not be exposed through the Student UI or Student-facing server query.

This is a business rule and should be enforced server-side, not merely hidden with frontend conditions.

### Product Decision — Withheld results and unpaid fees

In Registry practice, results are often withheld because of unpaid fees. Whether that happens is institutional policy, so the system does **not** withhold automatically. When staff publish results for a student with an overdue balance, the UI shows the overdue amount and asks for confirmation. Staff make the call.

A grade entered after a marksheet was published starts unpublished, like every new result.

### Product Decision — Re-grading a published result

Changing the grade of an existing result keeps its current publish state. A published result that is re-graded stays published with the new grade; staff withhold it first if the change needs review. This keeps "publish" an explicit staff action instead of something a grade edit silently undoes.

---

# 14. Relationships

## 14.1 Programme → Students

```text
Programme 1 ──────── * Student
```

## 14.2 Programme → Programme Fees

```text
Programme 1 ──────── * ProgrammeFee
```

## 14.3 Student → Payments

```text
Student 1 ──────── * Payment
```

## 14.4 Student → Submissions

```text
Student 1 ──────── * Submission
```

## 14.5 Assessment → Submissions

```text
Assessment 1 ──────── * Submission
```

## 14.6 Student → Results

```text
Student 1 ──────── * Result
```

## 14.7 Assessment → Results

```text
Assessment 1 ──────── * Result
```

## 14.8 Student → StudentFee

```text
Student 1 ──────── 0..1 StudentFee
```

## 14.9 ProgrammeFee → StudentFees

```text
ProgrammeFee 0..1 ──────── * StudentFee   (source tariff; null when set manually)
```

## 14.10 Programme → Assessments

```text
Programme 1 ──────── * Assessment
```

---

# 15. ERD

GitHub renders this diagram. `createdAt` / `updatedAt` are omitted for readability; field rules are in §4–§11.

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
    Assessment ||--o{ Submission : "receives"
    Assessment ||--o{ Result : "graded in"

    Programme {
        uuid id PK
        string code UK
        string name
        string description "nullable"
        boolean active
    }
    ProgrammeFee {
        uuid id PK
        uuid programmeId FK "unique with academicYear"
        int academicYear
        decimal amount "12,2"
        string currency
        datetime dueDate
    }
    StudentFee {
        uuid id PK
        uuid studentId FK, UK
        uuid programmeFeeId FK "nullable"
        decimal amount "12,2"
        string currency
        datetime dueDate
    }
    Student {
        uuid id PK
        string studentId UK "SMS-YYYY-NNNN"
        string fullName
        string email UK
        datetime dateOfBirth
        uuid programmeId FK
        int academicYear
        enum enrolmentStatus
    }
    Payment {
        uuid id PK
        uuid studentId FK
        decimal amount "12,2"
        datetime paymentDate
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
        string fileUrl
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
```

---

# 16. Constraints and Indexes

## Programme

```text
UNIQUE(code)
INDEX(active)
```

## Student

```text
UNIQUE(studentId)
UNIQUE(email)
INDEX(programmeId)
INDEX(enrolmentStatus)
INDEX(academicYear)
```

If email uniqueness is considered too restrictive for the final product, revisit it. For this assessment, unique email is a sensible assumption.

## ProgrammeFee

```text
INDEX(programmeId)
UNIQUE(programmeId, academicYear)
```

## StudentFee

```text
UNIQUE(studentId)
INDEX(programmeFeeId)
INDEX(dueDate)
```

## Payment

```text
UNIQUE(referenceNumber)
INDEX(studentId)
INDEX(paymentDate)
```

## Assessment

```text
INDEX(programmeId)
INDEX(submissionDeadline)
```

## Submission

```text
UNIQUE(studentId, assessmentId)
INDEX(studentId)
INDEX(assessmentId)
INDEX(isLate)
```

## Result

```text
UNIQUE(studentId, assessmentId)
INDEX(studentId)
INDEX(assessmentId)
INDEX(published)
```

---

# 17. Next.js Route Structure

```text
src/app/
│
├── (staff)/staff/
│   ├── dashboard/
│   ├── students/            list · new · [id] (tabs) · [id]/edit
│   ├── fees/
│   ├── assessments/         list · [id] (submissions + grading)
│   └── results/
│
├── (student)/student/
│   ├── dashboard/
│   ├── fees/
│   ├── assessments/
│   └── marksheet/
│
├── api/                     JSON API (Route Handlers), see §17.1
│
└── layout.tsx
```

Use route groups to keep Staff and Student UI logically separated without changing the URL structure unnecessarily.

## 17.1 JSON API (Route Handlers)

The brief grades *working API routes*. The UI uses Server Actions; the JSON API exposes the same operations over HTTP. Both are thin adapters over the **same service layer**, so no business rule is implemented twice.

| Method | Route | Role | Operation |
|---|---|---|---|
| GET | `/api/students?q=&programme=&status=` | staff | Search and filter students |
| POST | `/api/students` | staff | Create student (Student ID generated, fee assigned from tariff) |
| GET | `/api/students/[id]` | staff | Student details |
| PATCH | `/api/students/[id]` | staff | Update student |
| GET | `/api/students/[id]/fees` | staff | Fee summary and payment history |
| PUT | `/api/students/[id]/fee` | staff | Assign or adjust the student's fee |
| POST | `/api/students/[id]/payments` | staff | Record a payment |
| PUT | `/api/students/[id]/results/[assessmentId]` | staff | Enter or update a grade |
| PATCH | `/api/students/[id]/results/[assessmentId]` | staff | Publish or withhold one result |
| POST | `/api/students/[id]/results/publish` | staff | Publish or withhold a student's whole marksheet |
| GET | `/api/assessments` | staff, student | Staff: all. Student: own programme only |
| POST | `/api/assessments` | staff | Create assessment |
| PATCH | `/api/assessments/[id]` | staff | Edit an assessment, open or close it |
| POST | `/api/assessments/[id]/submissions` | student | Upload or replace own submission (multipart) |
| GET | `/api/me/marksheet` | student | Own **published** results only |
| GET | `/api/files/[submissionId]` | staff, owning student | Download a submitted file |

Conventions:

- `[id]` and `[assessmentId]` are internal UUIDs. The business Student ID is a field, not a route key.
- Role and student identity come from the server-side session (§27), never from the request body or query.
- Every request body and query is validated with Zod (§30).
- Error body: `{ "error": string, "fieldErrors"?: Record<string, string[]> }`.
- Status codes: `200`/`201` success · `400` validation · `401` signed out · `403` wrong role · `404` not found · `409` conflict (duplicate email or reference, deadline passed, closed assessment).
- A malformed id is `404`, the same as an unknown id.
- `GET /api/assessments` for a student returns each assessment of their programme with their own submission, `status` (`SUBMITTED` / `LATE` / `PENDING`), `canUpload` and `uploadBlockedReason`.
- `POST /api/assessments/[id]/submissions` returns `201` for a first submission and `200` for a replacement. Bodies over 5 MB are rejected before being read.
- Handlers live in `src/app/api/**/route.ts`; each one is authorize → validate → service call (`src/lib/api/response.ts` maps errors).

---

# 18. Application Structure

```text
prisma/
  schema.prisma
  migrations/
  seed.ts
storage/
  uploads/.gitkeep                  uploaded files (gitignored)
docs/
  architecture.md                   this specification
  PROGRESS.md                       phase checklist, verification, decisions
  development_log.md                one line per completed step
src/
  auth.ts                           Auth.js configuration (§27)
  proxy.ts                          optimistic route gate (§27.3)
  app/
    layout.tsx                      root html/body
    page.tsx                        redirect to the role's dashboard or /login
    login/page.tsx
    (staff)/staff/                  layout.tsx = requireStaff() + app shell
      dashboard/  students/ (new, [id], [id]/edit)  fees/  assessments/ ([id])  results/
    (student)/student/              layout.tsx = requireStudent() + app shell
      dashboard/  fees/  assessments/  marksheet/
    api/
      auth/[...nextauth]/           Auth.js endpoints
      ...                           JSON API (§17.1), files/[submissionId]
  actions/                          Server Actions: auth, students, payments, assessments, submissions, results
  lib/
    prisma.ts                       Prisma client singleton
    auth/                           session.ts (getSession, requireStaff, requireStudent), roles.ts
    domain/                         pure business rules (§36)
    services/                       database orchestration, returns DTOs
    validations/                    Zod schemas (§30)
    storage/                        FileStorage interface + local implementation (§32)
    api/response.ts                 ActionResult → HTTP (§31)
    utils/format.ts                 currency and date formatting
    errors.ts                       DomainError, ActionResult
  components/
    ui/                             shadcn primitives
    shared/                         status badges, empty state, page header, confirm dialog, useServerAction
    staff/                          student form, fee dialogs, grade table, result publish controls, URL tabs
    student/                        student-portal components
  types/                            type augmentation (next-auth)
tests/
  domain/  validations/  storage/  actions/
vitest.config.mts
```

Do not create unnecessary abstraction layers. Add a service only where it makes domain/application logic clearer or reusable. No repository pattern over Prisma and no dependency-injection container.

---

# 19. Staff View

## Dashboard

The dashboard should immediately surface:

```text
Students
Enrolled Students
Outstanding Fees
Overdue Fees
Pending Submissions
Unpublished Results
```

### Overdue Fees

Columns: Student ID, name, programme, outstanding, days overdue. Show students with:

```text
outstandingBalance > 0
AND
today > dueDate
```

Example:

```text
Overdue Fees

Student       Programme       Outstanding
SMS-2025-001  BSc CS          25,000 BDT
SMS-2025-014  MBA             40,000 BDT
```

### Pending Submissions

A pending submission is an **ENROLLED** student of the assessment's programme who has not submitted to an **open** assessment. Deferred, withdrawn and completed students are not counted, and students are never counted against another programme's assessments.

---

# 20. Staff — Students

Features:

- Student list
- Search by:
  - name
  - Student ID
  - programme
  - status
- Create student
- View student
- Edit student
- View fees/payments
- View submissions
- View results

Required search/filter behavior comes directly from the assessment.

- Search and filters run **on the server**, driven by `searchParams` — never by filtering an array in the browser.
- List columns: Student ID · Name · Programme · Year · Status · actions.
- Student detail page has tabs: Details / Fees / Submissions / Results.
- Inactive programmes are excluded from the create-form programme list.

---

# 21. Staff — Fees

Features:

- Assign a fee from the programme tariff, or adjust it (§6A)
- View student fee
- View total paid
- View outstanding balance
- Record payment
- View payment history
- Identify overdue students

Payment calculation:

```text
Outstanding =
Assigned Student Fee - Total Student Payments
```

Prevent:

```text
payment <= 0
payment > outstanding
duplicate reference number
payment date in the future
payment when no fee is assigned
fee adjusted below the amount already paid
```

UI:

- "Record Payment" dialog: amount, payment date, reference number. Disabled when the student is fully paid or has no fee.
- "Assign / Adjust Fee" dialog: default from the programme tariff, or a manual amount and due date.
- When the assigned fee no longer matches the tariff, show "Fee does not match programme tariff" with a "Reassign from tariff" action.
- A programme tariff management screen is optional; the seed covers tariffs.

---

# 22. Staff — Assessments

Features:

- Create assessment
- Edit assessment where appropriate
- Open or close an assessment for submissions
- View submissions
- See submission status
- See late submission indicator
- The submission list covers ENROLLED students of the assessment's programme: Submitted / Late / Pending, with a download link and inline grade entry
- The list shows submission count and graded count per assessment
- Opening or closing an assessment asks for confirmation

Assessment fields:

```text
Programme
Title
Module
Submission Deadline
Open / Closed
```

---

# 23. Staff — Results

Features:

- Select assessment
- Select student
- Enter grade
- Validate 0–100
- Calculate classification
- Save result
- Publish result
- Withhold result
- Publish or withhold a student's whole marksheet
- Warning before publishing for a student with an overdue balance
- Publishing and withholding ask for confirmation
- Classification updates live as the grade is typed; the server recalculates it

Example:

```text
Student: SMS-2025-0001
Assessment: Database Systems

Grade: 72
Classification: Distinction

[ Save ] [ Publish ]
```

---

# 24. Student View

The Student view should demonstrate the student's complete journey. **Every screen takes the student from the session (§27), never from the URL.**

## Dashboard

Show:

```text
Student Name
Student ID
Programme
Academic Year
Enrolment Status
```

## Fees

Show:

```text
Total Fee
Total Paid
Outstanding Balance
Payment History
Overdue Status
```

When no fee is assigned, show "No fee assigned" instead of a zero balance.

## Assessments

Show:

```text
Assessment
Module
Deadline
Submission Status
Late Flag
```

- Only assessments of the student's own programme are listed.
- Upload is available while the assessment is open and the student is ENROLLED.
- Replacing an existing submission is available until the deadline. After it, the student sees their submission and why it can no longer be replaced.
- Replacing asks for confirmation first. An upload after the deadline warns that it will be marked late.
- The browser checks type, size and a missing file for instant feedback; the server re-checks everything.
- A closed assessment the student never submitted is labelled "Not submitted" (not "Pending").

### At a glance

- **Outstanding balance** with fee status and days overdue (or "No fee assigned").
- **Next deadline:** the soonest *open* assessment whose deadline has not passed, with the student's submission status.
- **Work to do:** open assessments the student can still submit and has not; number of late submissions; number of published results.
- A notice when the student is not ENROLLED, explaining they cannot submit new work.

## Marksheet

Show only published results:

```text
Assessment
Grade
Classification
```

Unpublished results must not appear, and must not be in the data sent to the browser. The filter is in the **database query** (`where: { published: true }`), not a React condition. The marksheet does not show how many results are withheld.

---

# 25. Edge Cases

The assessment places significant weight on feature intuition and edge cases. Treat these as first-class requirements.

## Student

- Duplicate Student ID must never occur.
- Duplicate email should be rejected.
- Invalid email.
- Missing required fields.
- Future date of birth.
- Invalid academic year.
- No search results.
- Inactive programme.

## Fees

- Negative payment.
- Zero payment.
- Payment greater than outstanding balance.
- Duplicate payment reference.
- No payment history.
- Fully paid student.
- Overdue student.
- Student with outstanding but non-overdue balance.
- Student with no assigned fee.
- Fee adjusted below the amount already paid.
- Programme tariff changed after students were enrolled.
- Student's programme or academic year changed after a fee was assigned.
- Future payment date.

## Assessment

- Missing title.
- Missing module.
- Invalid deadline.
- Invalid file type.
- PDF accepted.
- DOCX accepted.
- Unsupported file rejected.
- File too large.
- Submission before deadline.
- Submission exactly at deadline.
- Submission after deadline.
- Resubmission before deadline.
- Resubmission after deadline (rejected; existing submission kept).
- Submission to a closed assessment.
- Submission by a deferred, withdrawn or completed student.
- Submission to another programme's assessment.

## Results

- Grade below 0.
- Grade above 100.
- Grade exactly 40.
- Grade exactly 60.
- Grade exactly 70.
- Unpublished result.
- Published result.
- Student cannot access unpublished result.
- Updating an existing result rather than creating duplicates.
- Grade for a student outside the assessment's programme.
- Non-integer grade.
- Publishing results for a student with an overdue balance (warning, not blocked).
- New grade added after a marksheet was published (starts unpublished).

## 25.1 Expected Messages

Every case produces a clear, user-facing result — never a crash, never a raw database error.

**Student**

| Case | Expected |
|---|---|
| Duplicate Student ID | Impossible by construction: unique constraint + retry (§4.2) |
| Duplicate email | "A student with this email already exists." |
| Invalid email format | Field error |
| Missing required field | Field error |
| Date of birth in the future | "Date of birth must be in the past." |
| Date of birth implying age under 15 | "Student must be at least 15 years old." |
| Academic year outside `2000 … currentYear + 1` | Field error |
| Search returns nothing | Empty state: "No students match your search." |
| Inactive programme | Not offered in the create form |

**Fees**

| Case | Expected |
|---|---|
| Payment ≤ 0 | "Payment amount must be greater than zero." |
| Payment > outstanding | "Payment exceeds the outstanding balance of X." |
| Duplicate reference number | "This payment reference already exists." |
| Future payment date | "Payment date cannot be in the future." |
| No payment history | Empty state |
| Fully paid student | `Paid` badge; payment form disabled |
| No fee assigned | "No fee has been assigned to this student."; payment blocked |
| Fee set to ≤ 0 or below total paid | "Fee cannot be less than the amount already paid (X)." |
| Tariff edited after enrolment | Existing assigned fees unchanged |
| Student's programme or year edited | Fee unchanged; "does not match tariff" notice with reassign action |

**Assessment / Submission**

| Case | Expected |
|---|---|
| Missing title, module or programme | Field error |
| Deadline in the past on create | Allowed, with a warning |
| File is not PDF or DOCX | "Only PDF and DOCX files are accepted." |
| File larger than 5 MB | "File must be smaller than 5 MB." |
| Submitted before or exactly at the deadline | Accepted, `isLate: false` |
| Submitted after the deadline (open assessment) | Accepted, `isLate: true`, flagged in the staff UI |
| Resubmission before or exactly at the deadline | Replaces the record, recalculates `isLate`, deletes the old file |
| Resubmission after the deadline | "The deadline has passed. Your existing submission can no longer be replaced." |
| Closed assessment | "This assessment is closed for submissions." |
| Student not ENROLLED | "Only enrolled students can submit." |
| Another programme's assessment | Not found |

**Results**

| Case | Expected |
|---|---|
| Grade below 0 or above 100 | "Grade must be between 0 and 100." |
| Non-integer grade | Rejected |
| Grade exactly 40 / 60 / 70 | Pass / Merit / Distinction |
| Existing result re-graded | Row updated, never duplicated |
| Student outside the assessment's programme | "This student is not in the assessment's programme." |
| Student requests an unpublished result | Not returned by the query |
| Publishing for a student with an overdue balance | Confirmation shows the overdue amount; not blocked |
| New grade after a marksheet was published | Saved unpublished |

---

# 26. Business Rules

The following rules should be implemented server-side.

## Student ID

```text
Student ID must be unique.
```

## Payment

```text
amount > 0
amount <= outstandingBalance
referenceNumber must be unique
paymentDate <= today
student must have an assigned fee
```

## Outstanding Balance

```text
outstanding =
studentFee.amount - sum(payments)
```

## Fee Assignment

```text
studentFee copied from ProgrammeFee(programmeId, academicYear) at enrolment
studentFee.amount > 0
studentFee.amount >= sum(payments)
tariff changes never modify existing studentFee rows
```

## Overdue

```text
outstanding > 0
AND
today (Dhaka calendar) > dueDate
daysOverdue = calendar days after dueDate
```

A due date is the last day to pay: a fee due on 30 Sep is not overdue at any time on 30 Sep and is 1 day overdue on 1 Oct (implemented by comparing against the end of the due day in Dhaka, `endOfRegistryDay`).

## Submission

```text
assessment.isOpen = true
student.enrolmentStatus = ENROLLED
student.programmeId = assessment.programmeId
fileType ∈ {PDF, DOCX}
fileSize <= 5 MB
```

```text
isLate =
submittedAt > submissionDeadline
```

Late submissions are accepted.

## Resubmission

```text
One active submission per student + assessment.
Replacement allowed only while now <= submissionDeadline.
```

## Grade

```text
0 <= grade <= 100
```

## Classification

```text
grade >= 70 → Distinction
grade >= 60 → Merit
grade >= 40 → Pass
grade < 40  → Fail
```

## Published Results

```text
Student can only retrieve published results.
Staff publish or withhold per result, per student, or per assessment.
```

---

# 27. Role Separation and Authentication

The brief makes authentication optional; a role toggle would be enough. **Decision (2026-09-16):** use real sign-in, with email and password through Auth.js (next-auth v5).

Why: a toggle lets anyone view any student's fees and results by switching views. With sign-in, "students only see their own data" (§13, §24) is enforced by who is signed in, not by UI state.

## 27.1 User model

```text
User
----
id
email          unique, stored lower-case
name
passwordHash   bcrypt
role           STAFF | STUDENT
studentId      FK → Student.id, unique, nullable
createdAt
updatedAt
```

Rules:

- `role` is a Prisma enum, `Role { STAFF, STUDENT }`.
- A STUDENT user links to exactly one `Student`; a STAFF user links to none. Enforced by a database CHECK constraint (`User_role_student_link_check`), not only in code.
- One login per student (`studentId` unique). Deleting a student deletes their login.
- `User` is separate from `Student`: a Student is a Registry record, a User is a login. Staff are not students, and a student record can exist without a login.

## 27.2 Sign-in and session

- Credentials provider. The password is checked with bcrypt; an unknown email and a wrong password take the same time and return the same message, "Invalid email or password."
- Session is a signed, encrypted JWT cookie with an 8-hour lifetime. No session table.
- **The JWT only proves identity.** On every request `getSession()` re-reads the user's role and student link from the database, so a deleted account or a changed role takes effect immediately.
- `AUTH_SECRET` signs the cookie. It lives in `.env` and is never committed.

## 27.3 Enforcement layers

| Layer | File | What it does |
|---|---|---|
| Proxy | `src/proxy.ts` | Optimistic, cookie-only check. Signed out → `/login`; wrong role's area → own dashboard. |
| Layouts | `(staff)/staff/layout.tsx`, `(student)/student/layout.tsx` | `requireStaff()` / `requireStudent()`, checked against the database |
| Pages, Server Actions, API routes | each file | Call `requireStaff()` / `requireStudent()` / `getSession()` themselves. Layouts and pages render in parallel, so a layout check alone is not enough. |
| Queries | services | A student's data is looked up by `session.studentId`, never by a URL, form or body value |

API routes answer `401` when signed out and `403` for the wrong role, instead of redirecting.

The proxy is a convenience, not the security boundary (Next.js docs: Proxy is for optimistic checks only).

## 27.4 Routes

```text
/                    → role dashboard, or /login
/login               → sign-in form; signed-in users are sent to their dashboard
/staff/*             → STAFF only
/student/*           → STUDENT only
/api/auth/*          → Auth.js endpoints
```

## 27.5 Demo accounts

Created by the seed script. Every account uses the password `Password123!`.

```text
Staff    registry@pensms.test
Student  <first>.<last>@student.pensms.test   e.g. rahim.uddin@student.pensms.test (SMS-YYYY-0002)
```

The login page lists them only when `DEMO_MODE="true"`.

## 27.6 Out of scope

Registration, password reset, email verification, OAuth / SSO, account lockout and rate limiting, and staff sub-roles. Staff creating a login when enrolling a student is planned for the student service (Phase 3, §41).

---

# 28. Seed Data

`prisma/seed.ts`, run with `npm run db:seed` (also runs after `prisma migrate reset`).

Rules:

- **Idempotent:** every write is an `upsert` on a unique key, so re-running is safe.
- **Dates are relative to the time the seed runs.** Fixed calendar dates would make every fee overdue when the evaluator runs it later.
- The seed must include at least: 2 programmes, 5 students, fees, payments, assessments, submissions, sample grades, published and unpublished results, an overdue student, a late submission, a pending submission, a closed assessment, and an assigned fee for every student.

Let `Y` = current year and `now` = the time the seed runs.

**Programmes and tariffs**

| Code | Name | Tariff (year Y) | Due date | Purpose |
|---|---|---|---|---|
| `BSC-CS` | BSc Computer Science | 150,000.00 BDT | `now − 30d` | overdue scenario |
| `MBA` | Master of Business Administration | 250,000.00 BDT | `now + 60d` | outstanding but not overdue |

**Students** — IDs `SMS-{Y}-0001` … `SMS-{Y}-0006`, each with a `StudentFee` copied from the tariff and a login (§27.5)

| # | Name | Programme | Status | Payments | Demonstrates |
|---|---|---|---|---|---|
| 1 | Nusrat Jahan | BSC-CS | ENROLLED | 150,000 (full) | fully paid |
| 2 | Rahim Uddin | BSC-CS | ENROLLED | 50,000 + 40,000 | partially paid, **overdue** — default demo student |
| 3 | Abir Hossain | BSC-CS | ENROLLED | none | **overdue**, no payment history (sorts first by name) |
| 4 | Tanvir Ahmed | BSC-CS | DEFERRED | 75,000 | deferred status |
| 5 | Farhana Akter | MBA | ENROLLED | 100,000 | outstanding but **not** overdue |
| 6 | Sadia Islam | MBA | COMPLETED | 250,000 (full) | completed status |

Payment reference numbers: `PAY-{Y}-0001`, `PAY-{Y}-0002`, …

**Assessments**

| Title | Programme | Module | Deadline | Open |
|---|---|---|---|---|
| Database Systems Coursework | BSC-CS | Database Systems | `now − 14d` | yes — late submissions still accepted |
| Algorithms Assignment 1 | BSC-CS | Algorithms | `now + 10d` | yes |
| Business Strategy Report | MBA | Strategy | `now + 21d` | yes |
| Financial Accounting Essay | MBA | Financial Accounting | `now − 45d` | **no** (closed) |

**Submissions** — real, minimal valid PDF files written to `storage/uploads/` so downloads work

- Student 1 → Database Systems, `deadline − 3d`, on time
- Student 2 → Database Systems, `deadline + 2d`, **late**
- Student 4 → Database Systems, `deadline − 1h`, on time (made before the deferral)
- Student 3 → Database Systems, **none** (pending)
- Student 1 → Algorithms, on time
- Student 5 → Business Strategy, on time
- Student 6 → Financial Accounting, `deadline − 5d`, on time (closed assessment)

**Results** — every classification boundary, published and withheld

| Student | Assessment | Grade | Classification | Published |
|---|---|---|---|---|
| 1 | Database Systems | 78 | Distinction | yes |
| 2 | Database Systems | 70 | Distinction (boundary) | yes |
| 4 | Database Systems | 60 | Merit (boundary) | yes |
| 3 | Database Systems | 40 | Pass (boundary) | **no** |
| 5 | Business Strategy | 35 | Fail | **no** |
| 1 | Algorithms | 82 | Distinction | **no** |
| 6 | Financial Accounting | 65 | Merit | yes |

**Accounts** — 1 staff login and 1 login per student; password `Password123!` (§27.5).

---

# 29. API / Server Operations

Each operation is implemented once in the service layer. Server Actions (used by the UI) and Route Handlers (the JSON API, §17.1) both call it.

## Students

```text
createStudent()          // generates Student ID, assigns fee from tariff
getStudents()            // search + filters
getStudent()
updateStudent()
```

## Fees & Payments

```text
getStudentFeeSummary()
assignStudentFee()       // from tariff, or a manual amount
getPayments()
createPayment()
getOverdueStudents()
```

## Assessments

```text
createAssessment()
updateAssessment()
setAssessmentOpen()
getAssessments()         // student: own programme only
getAssessment()
```

## Submissions

```text
submitAssessment()       // create; replace only before the deadline
getStudentSubmissions()
getAssessmentSubmissions()
```

## Results

```text
createOrUpdateResult()
setResultPublished()
setStudentResultsPublished()
setAssessmentResultsPublished()
getStudentPublishedResults()
getAssessmentResults()
```

---

# 30. Validation

Use a consistent schema-validation approach, preferably with Zod.

Validate:

- Student creation/update
- Payment creation
- Assessment creation
- Submission metadata
- Grade entry
- Search/filter parameters
- Sign-in

Validation should exist on the server even if client-side validation is also provided.

Field rules:

| Field | Rule |
|---|---|
| Email | Valid format; trimmed and stored lower-case |
| Date of birth | In the past; student at least 15 years old |
| Academic year | Integer, `2000 … currentYear + 1` |
| Payment amount | Greater than 0, at most 2 decimal places |
| Payment date | Not in the future |
| Payment reference | Letters, numbers, `- _ /`; stored upper-case, so uniqueness ignores case |
| Grade | Integer, `0 … 100` |
| Assessment deadline | ISO 8601 date-time **with** a time zone, e.g. `2026-09-30T23:59:00+06:00`. The staff form uses `datetime-local`, entered in Dhaka time and converted in the browser (`src/lib/utils/datetime.ts`) |
| File | PDF or DOCX by extension **and** MIME type; at most 5 MB; not empty |

Calendar dates (date of birth, payment date, fee due date) are `YYYY-MM-DD`, compared in the Registry time zone **Asia/Dhaka** and stored as UTC midnight. "Today" therefore means today in Dhaka, not in UTC.

Zod schemas live in `src/lib/validations/`.

---

# 31. Error Handling

Every mutation should provide clear failure states.

Examples:

```text
Unable to create student.
A student with this email already exists.
```

```text
Payment exceeds outstanding balance.
```

```text
Only PDF and DOCX files are accepted.
```

```text
Grade must be between 0 and 100.
```

```text
This result is not published.
```

Avoid exposing raw database errors to users.

### Action result shape

Every Server Action returns a result instead of throwing to the client:

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ErrorCode; fieldErrors?: Record<string, string[]> };

type ErrorCode = "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";
```

- Services catch Prisma errors and map them to human messages (`src/lib/errors.ts`).
- `src/lib/api/response.ts` maps the same result to HTTP for the JSON API: `VALIDATION` → 400, `UNAUTHORIZED` → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, `CONFLICT` → 409, `INTERNAL` → 500 with a generic message (§17.1).
- Every successful mutation shows toast feedback.

---

# 32. File Upload Strategy

The database stores metadata only:

```text
fileName
fileUrl
fileType
fileSize
```

Do not store document binaries in PostgreSQL.

### Storage

- Files are written to `storage/uploads/` at the repository root. The folder is gitignored except for a `.gitkeep`.
- It is **outside** `public/`, so files are never served statically.
- All file-system access goes through `src/lib/storage/index.ts`. **No `fs` calls anywhere else.**

```ts
export interface FileStorage {
  save(file: File, key: string): Promise<{ url: string; size: number }>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

- `LocalFileStorage` implements it. Swapping to S3 or Vercel Blob means writing another implementation only.
- Stored key: `${submissionId}-${timestamp}${ext}`, kept in `fileUrl`. Keys are generated on the server and checked against a strict pattern before any file-system call.
- A file is never overwritten. A replacement is written under a new key, the database row is updated, and only then is the old file deleted. If the database update fails, the new file is removed.
- The original name, with any path and control characters stripped, stays in `fileName` and is used in the `Content-Disposition` header.

### Download

- `GET /api/files/[submissionId]` looks the submission up by id, checks the session (staff, or the student who owns it), and streams the file.
- **Never accept a file-system path from the client** (path traversal).

### Accepted files

- Extensions `.pdf`, `.docx` **and** MIME types `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- At most 5 MB.

### Limitation

Local disk does not persist on serverless hosts such as Vercel. The README must say so.

---

# 33. Security Considerations

Authentication is optional in the brief, but this build uses real sign-in (§27):

- Hash passwords with bcrypt; never store or log plain passwords.
- Keep `AUTH_SECRET` in `.env` only.
- Re-check the session and role on the server in every page, Server Action and API route; the proxy is not the security boundary.
- Take the student's identity from the session, never from a URL, form or body.
- Use one generic sign-in error so accounts cannot be discovered.

- Never commit database credentials.
- Provide `.env.example`.
- Validate all server inputs.
- Do not trust client-provided role/business-rule values.
- Enforce published-result filtering server-side.
- Enforce payment limits server-side.
- Enforce grade limits server-side.
- Validate uploaded file type and size.
- Do not expose unnecessary database errors.
- Do not expose private file paths unnecessarily.

---

# 34. UI/UX Principles

Use Shadcn UI where it improves consistency.

Prioritize:

- Clear navigation.
- Responsive layout.
- Tables for Registry data.
- Search and filters.
- Status badges.
- Empty states.
- Loading states.
- Error states.
- Confirmation for important destructive actions.
- Clear success feedback.
- Currency formatting.
- Date/time formatting.
- Obvious late/overdue/published states.

Avoid excessive animations and decorative UI.

The evaluator should understand the system immediately.

## 34.1 Loading, Error and Not-Found States

| State | Where | Behaviour |
|---|---|---|
| Loading | `loading.tsx` in each role area and on record pages (`students/[id]`, `assessments/[id]`) | Skeleton shaped like a page, inside the app shell, so navigation stays usable |
| Page error | `error.tsx` in each role area | "Something went wrong" inside the shell, with **Try again** and **Go to dashboard**. Never shows the error message, only the digest as a reference that matches the server log (§33) |
| Layout or login error | `app/error.tsx` | Same message, full page (e.g. the database is unreachable) |
| Root layout error | `app/global-error.tsx` | Plain last-resort page |
| Not found | `not-found.tsx` in each role area, plus `app/not-found.tsx` for unknown URLs | "Page not found" with a link to the role's dashboard (or `/`) |
| Sign-in while the database is unreachable | Login form | "Sign-in is unavailable right now. Please try again in a moment." — not "Invalid email or password" |

A record page that calls `notFound()` after the shell has started streaming keeps HTTP status 200; Next.js marks it `noindex`. The JSON API returns a real 404.

Layout must not scroll horizontally at 375, 768, 1024 and 1280 px. Wide tables scroll inside their own container; from 768 px the sidebar takes 256 px, so multi-column filter rows start at `lg`.

---

# 35. Dashboard Status Semantics

Use clear visual states:

```text
Enrolled
Deferred
Withdrawn
Completed

Paid
Outstanding
Overdue

Submitted
Pending
Late

Published
Withheld
```

Do not rely only on color. Include text/status labels for accessibility and clarity.

---

# 36. Testing Strategy

Vitest. Run with `npm test`. Business rules are written as pure functions in `src/lib/domain/` (no database access) so they can be unit-tested:

```ts
// src/lib/domain/fees.ts
calculateOutstanding(totalFee: Decimal, payments: Decimal[]): Decimal
isOverdue(outstanding: Decimal, dueDate: Date | null, now: Date): boolean
isValidFeeAmount(amount: Decimal, totalPaid: Decimal): boolean

// src/lib/domain/results.ts
calculateClassification(grade: number): "Distinction" | "Merit" | "Pass" | "Fail"

// src/lib/domain/submissions.ts
isSubmissionLate(submittedAt: Date, deadline: Date): boolean
canReplaceSubmission(now: Date, deadline: Date): boolean

// src/lib/domain/student-id.ts
formatStudentId(year: number, sequence: number): string   // SMS-2026-0001
parseStudentIdSequence(studentId: string): number
```

Exact semantics:

```text
outstanding     = totalFee - sum(payments)
isOverdue       = outstanding > 0 AND now > dueDate      (strictly greater)
isLate          = submittedAt > deadline                 (exactly at the deadline is on time)
canReplace      = now <= deadline                        (exactly at the deadline may still replace)
feeValid        = amount > 0 AND amount >= totalPaid
classification  = grade >= 70 Distinction · >= 60 Merit · >= 40 Pass · otherwise Fail
```

## Required unit tests

| Function | Cases |
|---|---|
| `calculateOutstanding` | no payments, partial, exact, overpayment guard |
| `isOverdue` | nothing outstanding and past due; outstanding before due; outstanding after due; exactly at due date |
| `calculateClassification` | 0, 39, 40, 59, 60, 69, 70, 100 |
| `isSubmissionLate` | before, exactly at, after the deadline |
| `canReplaceSubmission` | before, exactly at, after the deadline |
| `isValidFeeAmount` | zero, below paid, equal to paid, above paid |
| `formatStudentId` | padding; sequence 9 → 10 → 100 |

## Required validation tests

- Grade: `-1`, `0`, `40`, `60`, `70`, `100`, `101`, `70.5`
- Payment: `0`, `-100`, valid amount, future date
- Email: valid, invalid
- Date of birth: future, under 15

## Adapter and storage tests

- `tests/actions/` — Server Actions with the session and services mocked: signed out, wrong role, invalid input, malformed ids, error mapping, and that a student's identity always comes from the session.
- `tests/storage/` — `LocalFileStorage` save / read / delete, no overwrite, and rejection of path-traversal keys.

## End-to-end checks

Access rules (published results only, own data only, role areas), every JSON API route, the §25.1 messages and the concurrency cases are checked against a running build and recorded in PROGRESS.md. Service-level integration tests against a test database are optional and never replace the unit tests.

---

# 37. README Requirements

The final README should contain, in this order:

```text
1.  Project Overview
2.  Features — staff and student, separately
3.  Architecture — layer diagram, ERD, JSON API route table with curl examples
4.  Technology Stack
5.  Prerequisites
6.  Environment Variables — every variable, with a description
7.  Local Setup — copy-pasteable, from clone to running app
8.  Database Setup and Migration
9.  Seed Data — what it creates and which scenario each student demonstrates
10. Demo Accounts and Sign-in — logins, shared demo password, DEMO_MODE
11. Business Rules — the formulas, stated plainly
12. Design Decisions — every "Product Decision" in this document, with its rationale
13. Edge Cases Handled
14. Testing — how to run, what is covered
15. AI Usage — tools, what they were used for, and that all output was reviewed, tested and adapted
16. Known Limitations — local file storage on serverless hosts, no registration / password reset / rate limiting, no submission version history, no partial-payment schedule
```

The assessment explicitly requires local setup instructions, `.env` variables, and a short explanation of AI usage.

---

# 38. AI Usage Policy for This Project

AI usage is explicitly encouraged by the assessment.

Use AI as an engineering assistant for:

- Architecture review.
- Schema review.
- React scaffolding.
- Validation.
- Test-case generation.
- Edge-case discovery.
- Code review.
- Documentation.

Do not blindly accept generated code.

The developer owns:

- Architecture decisions.
- Business rules.
- Final implementation.
- Testing.
- Debugging.
- Security decisions.

README should state what AI was used for and that generated output was reviewed and adapted.

---

# 39. What NOT to Build

Do not overengineer this assessment.

Avoid:

- Microservices.
- Kafka.
- Kubernetes.
- Redis unless genuinely needed.
- Separate backend framework.
- Complex RBAC.
- SSO.
- Multi-tenancy.
- Full accounting system.
- Full LMS.
- Complex notification infrastructure.
- Enterprise workflow engine.
- AI chatbot unrelated to the required Registry workflows.
- GraphQL or tRPC.
- Email or notification infrastructure.
- Dark mode, animation libraries, i18n, or a custom design system.
- A repository pattern over Prisma or a dependency-injection container.
- API routes that re-implement business logic instead of calling the service layer, or routes beyond §17.1.

The assessment explicitly states that this is not a full platform.

---

# 40. Definition of Done

The application is considered complete when:

### Student Enrolment

- [ ] Staff can create students.
- [ ] Student ID is automatically generated.
- [ ] Student ID is unique.
- [ ] Students can be searched.
- [ ] Students can be filtered.
- [ ] Status works.

### Fees

- [ ] Programme fees exist.
- [ ] A fee is assigned to each student from the programme tariff and can be adjusted.
- [ ] Payments can be recorded.
- [ ] Outstanding balance is calculated.
- [ ] Overdue students are identified.

### Assessments

- [ ] Staff can create assessments for a programme.
- [ ] Staff can open and close assessments.
- [ ] Students can submit PDF/DOCX.
- [ ] One active submission per student/assessment.
- [ ] Resubmission before deadline works.
- [ ] Resubmission after deadline is rejected.
- [ ] Late submissions are accepted.
- [ ] Late submissions are visibly flagged.

### Results

- [ ] Staff can enter grades.
- [ ] Grades are validated 0–100.
- [ ] Classification is calculated.
- [ ] Staff can publish/withhold results per result and per student.
- [ ] Students only see published results.

### Authentication

- [x] Staff and students sign in with email and password.
- [x] Staff and student areas are enforced on the server.
- [x] Students only see their own data.

### Engineering

- [ ] PostgreSQL is used.
- [ ] Prisma is used.
- [ ] Prisma schema is committed.
- [ ] JSON API routes work and share the service layer with Server Actions.
- [ ] No mocked application data.
- [ ] Seed data works.
- [ ] Error handling exists.
- [ ] README is complete.
- [ ] `.env.example` exists.
- [ ] AI usage is documented.
- [ ] Code is committed to GitHub.

---

# 41. Implementation Sequence

Do not start by building every UI screen. Finish and verify each phase before the next. Live status for every item is in [PROGRESS.md](PROGRESS.md).

```text
PHASE 1 — Foundation
    Next.js project → PostgreSQL connection → Prisma setup → final schema → migration
    → seed (programmes, tariffs, students, fees)
    Verify: migrate status up to date; tables visible in Prisma Studio; seed runs twice

PHASE 2 — Authentication (§27)
    User model + migration → Auth.js sign-in → session helpers → proxy
    → login page → role-guarded layouts → minimal dashboards → demo accounts in seed
    Verify: both roles sign in; wrong role and signed-out requests are redirected; build passes

PHASE 3 — Domain Logic and API
    Pure domain functions + unit tests (§36) → Zod schemas (§30)
    → services: student (race-safe ID, fee assignment), fee/payment (transactional),
      assessment, submission (storage §32), result
    → Server Actions → JSON API route handlers (§17.1)
    → complete seed: payments, assessments, submissions with files, results (§28)
    Verify: npm test passes; every API route checked with curl; seed from a clean database

PHASE 4 — Staff UI
    Dashboard → Students → Fees → Assessments → Results

PHASE 5 — Student UI
    Dashboard → Fees → Assessments → Marksheet

PHASE 6 — Quality
    Edge cases (§25.1) → error boundaries per route group → loading and empty states
    → confirmation dialogs → toasts → responsive at 375 / 768 / 1280 px
    → consistent currency and date formatting → lint clean

PHASE 7 — Submission
    README (§37) → AI usage → .env.example accurate → seed verified from clean
    → npm run build clean → clean Git history → final walkthrough
```

---

# 42. Engineering Priority

When time is limited, prioritize in this order:

```text
1. Correct business rules
2. Correct database relationships
3. Working end-to-end workflows
4. Edge cases
5. Clear UI/UX
6. Error handling
7. Tests
8. Visual polish
```

Do not sacrifice domain correctness for visual polish.

---

# 43. Final Architecture Decision

The project should remain:

```text
Next.js App Router
        │
        ├── Staff UI
        ├── Student UI
        │
        ├── Server Actions
        ├── Route Handlers
        │
        ├── Application/Domain Logic
        │
        └── Prisma
              │
              ▼
          PostgreSQL
```

Core entities:

```text
Programme
ProgrammeFee
StudentFee
Student
Payment
Assessment
Submission
Result
```

The system should demonstrate:

```text
Requirement
    ↓
Domain Model
    ↓
Business Rules
    ↓
API / Server Logic
    ↓
React UI
    ↓
Validation
    ↓
Testing
    ↓
Deployment-ready Application
```

**Primary objective:** Deliver a focused, reliable Registry module that demonstrates stakeholder understanding, edge-case awareness, technical quality, and responsible AI-assisted development.
