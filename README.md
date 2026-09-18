# PEN SMS — Registry Module

A Student Management System for a university **Registry team**, built with Next.js 16, PostgreSQL and Prisma for the PEN Global technical assessment. Registry staff manage students, fees, assessments and results. Students sign in to see their own fees, submit coursework and read their published results.

> Full technical documentation (architecture, API, business rules, design decisions, edge cases, testing): **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)**

---

## Features

Staff enrol students (each gets an automatic Student ID such as `SMS-2026-0001`), search and filter them, and record fees and payments with a live outstanding balance. Overdue balances are flagged on the dashboard. Staff create assessments for a programme; students upload PDF or DOCX files, can replace them before the deadline, and late work is accepted but clearly marked. Staff enter grades (0–100) that are classified automatically (Pass, Merit, Distinction) and choose when to publish them. Students only ever see their own data, and only published results.

---

## Prerequisites

- **Node.js 22** and npm
- **PostgreSQL** (version 16 is used in CI), running locally or hosted
- Git

---

## Project setup - Local deployment

```bash
# 1. Clone and install
git clone https://github.com/anikninja/pen-sms.git
cd pen-sms
npm install

# 2. Environment
cp .env.example .env
#    then edit .env: DATABASE_URL and AUTH_SECRET

# 3. Database: first create the database, then apply migrations, load demo data (see below)
npm run db:deploy
npm run db:seed

# 4. Build and start
npm run build
npm run start
```

Open **<http://localhost:3000>** and sign in with a [demo account](#demo-accounts-and-sign-in).

For development with hot reload, use `npm run dev` instead of step 4.

---

## Database setup and migrations

1. Create an empty database, e.g. `createdb pen_sms` or `psql -U postgres -c "CREATE DATABASE pen_sms;"`.
2. Point `DATABASE_URL` in `.env` at it.
3. Apply the committed migrations:

```bash
npm run db:deploy        # prisma migrate deploy: creates all tables, never deletes data
```

Other useful commands:

| Command | Use |
|---|---|
| `npx prisma studio` | Browse the data in the browser |
| `npx prisma migrate reset` | Development only: wipes the database, re-applies migrations and re-seeds |

---

## Seed data

```bash
npm run db:seed
```

- Safe to run more than once: it updates the demo records instead of duplicating them.
- Dates are relative to the day you run it, so the overdue, upcoming and late scenarios always stay true.
- It also writes small sample PDF files to `storage/uploads/` so seeded submissions can be downloaded.

### What the seed creates

2 programmes, 6 students with fees and payments, 4 assessments, 6 submissions, 7 grades and 7 logins.

| Student | Programme | Status | What it shows |
|---|---|---|---|
| Nusrat Jahan | BSc Computer Science | Enrolled | Fee fully paid; one grade still withheld |
| **Rahim Uddin** | BSc Computer Science | Enrolled | **Overdue** balance (60,000 BDT) and a **late** submission |
| Abir Hossain | BSc Computer Science | Enrolled | Overdue with no payments; one assessment not submitted |
| Tanvir Ahmed | BSc Computer Science | Deferred | Not enrolled, so cannot submit |
| Farhana Akter | MBA | Enrolled | Balance outstanding but **not yet due** |
| Sadia Islam | MBA | Completed | Fully paid; submitted to an assessment that is now closed |

| Assessment | Programme | Deadline | Open |
|---|---|---|---|
| Database Systems Coursework | BSc CS | 14 days ago | yes (late work still accepted) |
| Algorithms Assignment 1 | BSc CS | in 10 days | yes |
| Business Strategy Report | MBA | in 21 days | yes |
| Financial Accounting Essay | MBA | 45 days ago | **closed** |

Grades cover every classification boundary (35 Fail, 40 Pass, 60 Merit, 65 Merit, 70, 78 and 82 Distinction); four are published and three withheld.

---

## Demo accounts and sign-in

All demo accounts use the password **`Password123!`**.

| Role | Email |
|---|---|
| Staff (Registry) | `registry@pensms.test` |
| Student | `rahim.uddin@student.pensms.test` |

Every seeded student can sign in the same way: `firstname.lastname@student.pensms.test` (e.g. `nusrat.jahan@…`, `tanvir.ahmed@…`, `farhana.akter@…`).

There is one sign-in page for both roles. Staff land on the Registry dashboard, students on their own portal, and neither can open the other's pages. Sign out from the user menu at the bottom of the sidebar.

---

## Staff usage manual

Sign in as `registry@pensms.test`.

| Task | How |
|---|---|
| **See what needs attention** | **Dashboard** shows total and enrolled students, total outstanding, overdue students, pending submissions and unpublished results, plus a list of overdue fees |
| **Enrol a student** | **Students → New student**, fill in the form, then **Create student**. The Student ID is generated and the programme's fee is assigned automatically. Set an *Initial password* to give the student a login |
| **Find a student** | **Students**: type a name or Student ID, choose a programme or status, then **Search**. **Clear** resets the filters |
| **Edit a student** | Open the student, then **Edit** → **Save changes** |
| **Record a payment** | Open the student → **Fees** tab → **Record payment** (amount, payment date, reference number). A payment larger than the outstanding balance is refused |
| **Change a fee** | Open the student → **Fees** tab → **Adjust fee**: keep the programme tariff, or choose *Manual amount* for a scholarship or arrangement |
| **Review all balances** | **Fees**: filter by Overdue, Outstanding, Paid or No fee assigned |
| **Create an assessment** | **Assessments → New assessment**: programme, title, module and deadline (Dhaka time) → **Create assessment** |
| **Review submissions** | Open an assessment to see each student's file (click to download), submission time and a **Late** flag |
| **Stop accepting work** | Open the assessment → **Close submissions** (and **Reopen submissions** to undo) |
| **Enter grades** | On an assessment page, or **Results** → choose the assessment: type a grade (0–100) and click **Save**. The classification appears as you type. New grades start *Withheld* |
| **Publish results** | **Publish** / **Withhold** on one result, **Publish all results** for an assessment, or **Publish marksheet** on a student's **Results** tab. If the student has an overdue balance, the confirmation shows it |

---

## Student usage manual

Sign in as a student, e.g. `rahim.uddin@student.pensms.test`.

| Task | How |
|---|---|
| **See your overview** | **Dashboard** shows your outstanding balance (and days overdue), your next deadline and any work still to submit |
| **Check your fees** | **Fees** shows your total fee, amount paid, outstanding balance, due date and payment history. Payments are recorded by the Registry |
| **Submit coursework** | **Assessments**: under *Upload your work*, choose a PDF or DOCX file (up to 5 MB) → **Submit**. If the deadline has passed, you are warned that the work will be marked late |
| **Replace a submission** | Before the deadline, choose a new file under *Replace your submission* → **Replace**, then confirm with **Replace file**. After the deadline your submission can no longer be replaced |
| **Download your file** | Click the file name on the assessment card |
| **See your results** | **Marksheet** lists your published results with their classification. Results the Registry has not published yet are not shown |

If an upload is not possible, the assessment card explains why: the assessment is closed, you are not currently enrolled, or the deadline for replacing has passed.

---

## Project ownership and credit

**PEN SMS — Registry Module** was designed and built by **Anik Ninja** ([@anikninja](https://github.com/anikninja)) as a technical assessment for PEN Global.

© 2026 Anik Ninja. All rights reserved. The assessment brief is not included in this repository.
