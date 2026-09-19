/**
 * Demo data for the Cloudflare D1 schema — the same programmes, students, fees, payments, logins,
 * assessments, submissions and results as prisma/seed.ts (PostgreSQL), with money in minor units.
 * Keep the two data sets in step while both databases exist.
 *
 * `seedD1(db)` takes any D1 Prisma client and never reads DATABASE_URL, so it cannot reach PostgreSQL.
 * To seed a real D1 database it must run through @prisma/adapter-d1 (inside the Cloudflare Worker,
 * a later phase): Prisma's native SQLite engine stores DateTime values differently from the D1 adapter
 * (integer milliseconds vs ISO text). prisma/d1/seed-local.ts runs it against a throwaway local
 * SQLite file only.
 *
 * Submission files are not written here: `seedD1` returns the PDF bytes for each object key, and the
 * caller puts them into R2 (worker/scripts/seed-local.ts for the local bucket). The keys are fixed,
 * so seeding again overwrites the same objects.
 *
 * Idempotent: every write is an upsert on a unique key (fixed ids for assessments and submissions).
 * No Prisma transactions are used (see src/lib/services/d1/client.ts).
 */
import bcrypt from "bcryptjs"

import { isoDateToUtc, registryToday } from "../../src/lib/domain/dates"
import { formatStudentId } from "../../src/lib/domain/student-id"
import { isSubmissionLate } from "../../src/lib/domain/submissions"
import { parseMoney } from "../../src/lib/money"
import { submissionObjectKey } from "../../src/lib/storage/object-store"
import type { D1Client } from "../../src/lib/services/d1/client"

// Shared by every seeded account. Also shown on the login page when DEMO_MODE="true".
// A public deployment passes its own password instead (worker/scripts/prepare-remote-seed.ts).
const DEMO_PASSWORD = "Password123!"

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

type ProgrammeCode = "BSC-CS" | "MBA"
type EnrolmentStatus = "ENROLLED" | "DEFERRED" | "WITHDRAWN" | "COMPLETED"

export type SeedResult = {
  counts: Record<"programmes" | "tariffs" | "students" | "fees" | "payments" | "users" | "assessments" | "submissions" | "results", number>
  /** Submission files to put into R2, by object key. */
  files: { key: string; bytes: Uint8Array }[]
}

export async function seedD1(db: D1Client, now = new Date(), options: { password?: string } = {}): Promise<SeedResult> {
  const YEAR = now.getFullYear()
  const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY)
  /** A calendar date N days ago (negative = ahead) in the Registry time zone, stored as UTC midnight. */
  const calendarDaysAgo = (days: number) => isoDateToUtc(registryToday(daysFromNow(-days)))
  const studentIdFor = (seq: number) => formatStudentId(YEAR, seq)

  const PROGRAMMES: { code: ProgrammeCode; name: string; description: string; fee: { amount: string; dueDate: Date } }[] = [
    {
      code: "BSC-CS",
      name: "BSc Computer Science",
      description: "Four-year undergraduate programme in computer science.",
      fee: { amount: "150000.00", dueDate: calendarDaysAgo(30) }, // past due → overdue scenario
    },
    {
      code: "MBA",
      name: "Master of Business Administration",
      description: "Two-year postgraduate business programme.",
      fee: { amount: "250000.00", dueDate: calendarDaysAgo(-60) }, // not yet due
    },
  ]

  // Abir Hossain (student 3, overdue with no payments) sorts first by name.
  const STUDENTS: {
    seq: number
    fullName: string
    email: string
    dateOfBirth: string
    programme: ProgrammeCode
    status: EnrolmentStatus
    payments: { amount: string; daysAgo: number }[]
  }[] = [
    { seq: 1, fullName: "Nusrat Jahan", email: "nusrat.jahan@student.pensms.test", dateOfBirth: "2004-03-14", programme: "BSC-CS", status: "ENROLLED", payments: [{ amount: "150000.00", daysAgo: 60 }] },
    { seq: 2, fullName: "Rahim Uddin", email: "rahim.uddin@student.pensms.test", dateOfBirth: "2003-11-02", programme: "BSC-CS", status: "ENROLLED", payments: [{ amount: "50000.00", daysAgo: 75 }, { amount: "40000.00", daysAgo: 40 }] },
    { seq: 3, fullName: "Abir Hossain", email: "abir.hossain@student.pensms.test", dateOfBirth: "2004-07-21", programme: "BSC-CS", status: "ENROLLED", payments: [] },
    { seq: 4, fullName: "Tanvir Ahmed", email: "tanvir.ahmed@student.pensms.test", dateOfBirth: "2003-05-09", programme: "BSC-CS", status: "DEFERRED", payments: [{ amount: "75000.00", daysAgo: 50 }] },
    { seq: 5, fullName: "Farhana Akter", email: "farhana.akter@student.pensms.test", dateOfBirth: "1998-09-30", programme: "MBA", status: "ENROLLED", payments: [{ amount: "100000.00", daysAgo: 20 }] },
    { seq: 6, fullName: "Sadia Islam", email: "sadia.islam@student.pensms.test", dateOfBirth: "1997-01-18", programme: "MBA", status: "COMPLETED", payments: [{ amount: "250000.00", daysAgo: 90 }] },
  ]

  const STAFF = [{ name: "Registry Admin", email: "registry@pensms.test" }]

  // Fixed ids keep assessments and submissions idempotent (they have no natural unique key).
  const ASSESSMENTS = [
    { key: "DB", id: "5e3d0a1c-0000-4000-8000-000000000101", programme: "BSC-CS", title: "Database Systems Coursework", module: "Database Systems", deadline: daysFromNow(-14), isOpen: true },
    { key: "ALGO", id: "5e3d0a1c-0000-4000-8000-000000000102", programme: "BSC-CS", title: "Algorithms Assignment 1", module: "Algorithms", deadline: daysFromNow(10), isOpen: true },
    { key: "STRAT", id: "5e3d0a1c-0000-4000-8000-000000000103", programme: "MBA", title: "Business Strategy Report", module: "Strategy", deadline: daysFromNow(21), isOpen: true },
    { key: "ACC", id: "5e3d0a1c-0000-4000-8000-000000000104", programme: "MBA", title: "Financial Accounting Essay", module: "Financial Accounting", deadline: daysFromNow(-45), isOpen: false },
  ] as const
  type AssessmentKey = (typeof ASSESSMENTS)[number]["key"]

  // Student 3 has no Database Systems submission: the pending case.
  const SUBMISSIONS: { id: string; seq: number; assessment: AssessmentKey; offsetMs: number }[] = [
    { id: "5e3d0a1c-0000-4000-8000-000000000201", seq: 1, assessment: "DB", offsetMs: -3 * DAY },
    { id: "5e3d0a1c-0000-4000-8000-000000000202", seq: 2, assessment: "DB", offsetMs: 2 * DAY }, // late
    { id: "5e3d0a1c-0000-4000-8000-000000000203", seq: 4, assessment: "DB", offsetMs: -1 * HOUR },
    { id: "5e3d0a1c-0000-4000-8000-000000000204", seq: 1, assessment: "ALGO", offsetMs: -12 * DAY }, // 2 days ago
    { id: "5e3d0a1c-0000-4000-8000-000000000205", seq: 5, assessment: "STRAT", offsetMs: -22 * DAY }, // yesterday
    { id: "5e3d0a1c-0000-4000-8000-000000000206", seq: 6, assessment: "ACC", offsetMs: -5 * DAY },
  ]

  // Every classification boundary, published and withheld.
  const RESULTS: { seq: number; assessment: AssessmentKey; grade: number; published: boolean }[] = [
    { seq: 1, assessment: "DB", grade: 78, published: true },
    { seq: 2, assessment: "DB", grade: 70, published: true },
    { seq: 4, assessment: "DB", grade: 60, published: true },
    { seq: 3, assessment: "DB", grade: 40, published: false },
    { seq: 5, assessment: "STRAT", grade: 35, published: false },
    { seq: 1, assessment: "ALGO", grade: 82, published: false },
    { seq: 6, assessment: "ACC", grade: 65, published: true },
  ]

  const passwordHash = await bcrypt.hash(options.password ?? DEMO_PASSWORD, 10)

  // Programmes and tariffs
  const programmes = new Map<ProgrammeCode, { id: string; tariffId: string; amount: bigint; dueDate: Date }>()
  for (const p of PROGRAMMES) {
    const programme = await db.programme.upsert({
      where: { code: p.code },
      update: { name: p.name, description: p.description, active: true },
      create: { code: p.code, name: p.name, description: p.description },
    })
    const amount = parseMoney(p.fee.amount)
    const tariff = await db.programmeFee.upsert({
      where: { programmeId_academicYear: { programmeId: programme.id, academicYear: YEAR } },
      update: { amount, currency: "BDT", dueDate: p.fee.dueDate },
      create: { programmeId: programme.id, academicYear: YEAR, amount, currency: "BDT", dueDate: p.fee.dueDate },
    })
    programmes.set(p.code, { id: programme.id, tariffId: tariff.id, amount, dueDate: p.fee.dueDate })
  }

  // Students, assigned fees, payments, logins
  const studentIds = new Map<number, string>()
  let paymentSeq = 0
  for (const s of STUDENTS) {
    const programme = programmes.get(s.programme)!
    const data = {
      fullName: s.fullName,
      email: s.email,
      dateOfBirth: isoDateToUtc(s.dateOfBirth),
      programmeId: programme.id,
      academicYear: YEAR,
      enrolmentStatus: s.status,
    }
    const student = await db.student.upsert({
      where: { studentId: studentIdFor(s.seq) },
      update: data,
      create: { studentId: studentIdFor(s.seq), ...data },
    })
    studentIds.set(s.seq, student.id)

    // Assigned fee is a snapshot of the tariff (§6A).
    const fee = { programmeFeeId: programme.tariffId, amount: programme.amount, currency: "BDT", dueDate: programme.dueDate }
    await db.studentFee.upsert({ where: { studentId: student.id }, update: fee, create: { studentId: student.id, ...fee } })

    for (const payment of s.payments) {
      const referenceNumber = `PAY-${YEAR}-${String(++paymentSeq).padStart(4, "0")}`
      const paymentData = { studentId: student.id, amount: parseMoney(payment.amount), paymentDate: calendarDaysAgo(payment.daysAgo) }
      await db.payment.upsert({ where: { referenceNumber }, update: paymentData, create: { referenceNumber, ...paymentData } })
    }

    await db.user.upsert({
      where: { email: s.email },
      update: { name: s.fullName, passwordHash, role: "STUDENT", studentId: student.id },
      create: { email: s.email, name: s.fullName, passwordHash, role: "STUDENT", studentId: student.id },
    })
  }

  for (const staff of STAFF) {
    await db.user.upsert({
      where: { email: staff.email },
      update: { name: staff.name, passwordHash, role: "STAFF", studentId: null },
      create: { email: staff.email, name: staff.name, passwordHash, role: "STAFF" },
    })
  }

  // Assessments
  const assessments = new Map<AssessmentKey, { id: string; deadline: Date; title: string }>()
  for (const a of ASSESSMENTS) {
    const data = {
      programmeId: programmes.get(a.programme)!.id,
      title: a.title,
      module: a.module,
      submissionDeadline: a.deadline,
      isOpen: a.isOpen,
    }
    await db.assessment.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } })
    assessments.set(a.key, { id: a.id, deadline: a.deadline, title: a.title })
  }

  // Submissions (rows only; the caller uploads the returned files to R2)
  const files: SeedResult["files"] = []
  for (const s of SUBMISSIONS) {
    const assessment = assessments.get(s.assessment)!
    const student = STUDENTS.find((candidate) => candidate.seq === s.seq)!
    const submittedAt = new Date(assessment.deadline.getTime() + s.offsetMs)
    // Fixed time and nonce: the same key on every run, so re-seeding does not leave old objects behind.
    const key = submissionObjectKey(s.id, ".pdf", new Date(0), "seed")
    const bytes = minimalPdf(`${assessment.title} - ${student.fullName} (${studentIdFor(s.seq)})`)
    files.push({ key, bytes })

    const data = {
      fileName: `${student.fullName.replace(/\s+/g, "_")}_${s.assessment}.pdf`,
      fileUrl: key,
      fileType: "application/pdf",
      fileSize: bytes.byteLength,
      submittedAt,
      isLate: isSubmissionLate(submittedAt, assessment.deadline),
    }
    await db.submission.upsert({
      where: { studentId_assessmentId: { studentId: studentIds.get(s.seq)!, assessmentId: assessment.id } },
      update: data,
      create: { id: s.id, studentId: studentIds.get(s.seq)!, assessmentId: assessment.id, ...data },
    })
  }

  // Results
  for (const r of RESULTS) {
    const key = { studentId: studentIds.get(r.seq)!, assessmentId: assessments.get(r.assessment)!.id }
    await db.result.upsert({
      where: { studentId_assessmentId: key },
      update: { grade: r.grade, published: r.published },
      create: { ...key, grade: r.grade, published: r.published },
    })
  }

  const [programmeCount, tariffs, students, fees, payments, users, assessmentCount, submissions, results] = await Promise.all([
    db.programme.count(),
    db.programmeFee.count(),
    db.student.count(),
    db.studentFee.count(),
    db.payment.count(),
    db.user.count(),
    db.assessment.count(),
    db.submission.count(),
    db.result.count(),
  ])
  return {
    counts: { programmes: programmeCount, tariffs, students, fees, payments, users, assessments: assessmentCount, submissions, results },
    files,
  }
}

/** A small but valid one-page PDF (same as prisma/seed.ts), built without Node's Buffer so it runs in Workers. */
function minimalPdf(text: string): Uint8Array {
  const safe = text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (char) => `\\${char}`)
  const content = `BT /F1 16 Tf 72 720 Td (${safe}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  // Every character is ASCII, so string length equals byte length.
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
