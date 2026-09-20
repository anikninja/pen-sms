/**
 * Demo data — docs/architecture.md §28.
 *
 * Idempotent: every write is an upsert on a unique key (fixed ids for assessments and submissions),
 * so it can be re-run safely. Dates are relative to "now" so the overdue / not-yet-due / late
 * scenarios stay true whenever it runs.
 */
import { EnrolmentStatus, PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

import { isoDateToUtc, registryToday } from "../src/lib/domain/dates"
import { formatStudentId } from "../src/lib/domain/student-id"
import { isSubmissionLate } from "../src/lib/domain/submissions"
import { storage } from "../src/lib/storage"

const prisma = new PrismaClient()

// Shared by every seeded account. Also shown on the login page when DEMO_MODE="true".
const DEMO_PASSWORD = "Password123!"

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const now = new Date()
const YEAR = now.getFullYear()
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY)
/** A calendar date N days ago (negative = ahead) in the Registry time zone, stored as UTC midnight. Fee due dates are calendar dates. */
const calendarDaysAgo = (days: number) => isoDateToUtc(registryToday(daysFromNow(-days)))

type ProgrammeCode = "BSC-CS" | "MBA"

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
  { seq: 1, fullName: "Nusrat Jahan", email: "nusrat.jahan@sms.inxapp.net", dateOfBirth: "2004-03-14", programme: "BSC-CS", status: "ENROLLED", payments: [{ amount: "150000.00", daysAgo: 60 }] },
  { seq: 2, fullName: "Rahim Uddin", email: "rahim.uddin@sms.inxapp.net", dateOfBirth: "2003-11-02", programme: "BSC-CS", status: "ENROLLED", payments: [{ amount: "50000.00", daysAgo: 75 }, { amount: "40000.00", daysAgo: 40 }] },
  { seq: 3, fullName: "Abir Hossain", email: "abir.hossain@sms.inxapp.net", dateOfBirth: "2004-07-21", programme: "BSC-CS", status: "ENROLLED", payments: [] },
  { seq: 4, fullName: "Tanvir Ahmed", email: "tanvir.ahmed@sms.inxapp.net", dateOfBirth: "2003-05-09", programme: "BSC-CS", status: "DEFERRED", payments: [{ amount: "75000.00", daysAgo: 50 }] },
  { seq: 5, fullName: "Farhana Akter", email: "farhana.akter@sms.inxapp.net", dateOfBirth: "1998-09-30", programme: "MBA", status: "ENROLLED", payments: [{ amount: "100000.00", daysAgo: 20 }] },
  { seq: 6, fullName: "Sadia Islam", email: "sadia.islam@sms.inxapp.net", dateOfBirth: "1997-01-18", programme: "MBA", status: "COMPLETED", payments: [{ amount: "250000.00", daysAgo: 90 }] },
]

const STAFF = [{ name: "Registry Admin", email: "registry@sms.inxapp.net" }]

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

const studentIdFor = (seq: number) => formatStudentId(YEAR, seq)

/** A small but valid one-page PDF, so seeded downloads open in a real viewer. */
function minimalPdf(text: string): Buffer {
  const safe = text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (char) => `\\${char}`)
  const content = `BT /F1 16 Tf 72 720 Td (${safe}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, "latin1")
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  // Programmes and tariffs
  const programmes = new Map<ProgrammeCode, { id: string; tariffId: string; amount: string; dueDate: Date }>()
  for (const p of PROGRAMMES) {
    const programme = await prisma.programme.upsert({
      where: { code: p.code },
      update: { name: p.name, description: p.description, active: true },
      create: { code: p.code, name: p.name, description: p.description },
    })
    const tariff = await prisma.programmeFee.upsert({
      where: { programmeId_academicYear: { programmeId: programme.id, academicYear: YEAR } },
      update: { amount: p.fee.amount, currency: "BDT", dueDate: p.fee.dueDate },
      create: { programmeId: programme.id, academicYear: YEAR, amount: p.fee.amount, currency: "BDT", dueDate: p.fee.dueDate },
    })
    programmes.set(p.code, { id: programme.id, tariffId: tariff.id, ...p.fee })
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
    const student = await prisma.student.upsert({
      where: { studentId: studentIdFor(s.seq) },
      update: data,
      create: { studentId: studentIdFor(s.seq), ...data },
    })
    studentIds.set(s.seq, student.id)

    // Assigned fee is a snapshot of the tariff (§6A).
    const fee = { programmeFeeId: programme.tariffId, amount: programme.amount, currency: "BDT", dueDate: programme.dueDate }
    await prisma.studentFee.upsert({ where: { studentId: student.id }, update: fee, create: { studentId: student.id, ...fee } })

    for (const payment of s.payments) {
      const referenceNumber = `PAY-${YEAR}-${String(++paymentSeq).padStart(4, "0")}`
      const paymentData = { studentId: student.id, amount: payment.amount, paymentDate: calendarDaysAgo(payment.daysAgo) }
      await prisma.payment.upsert({
        where: { referenceNumber },
        update: paymentData,
        create: { referenceNumber, ...paymentData },
      })
    }

    await prisma.user.upsert({
      where: { email: s.email },
      update: { name: s.fullName, passwordHash, role: "STUDENT", studentId: student.id },
      create: { email: s.email, name: s.fullName, passwordHash, role: "STUDENT", studentId: student.id },
    })
  }

  for (const staff of STAFF) {
    await prisma.user.upsert({
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
    await prisma.assessment.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } })
    assessments.set(a.key, { id: a.id, deadline: a.deadline, title: a.title })
  }

  // Submissions with real files in storage/uploads
  for (const s of SUBMISSIONS) {
    const assessment = assessments.get(s.assessment)!
    const student = STUDENTS.find((candidate) => candidate.seq === s.seq)!
    const submittedAt = new Date(assessment.deadline.getTime() + s.offsetMs)
    const fileName = `${student.fullName.replace(/\s+/g, "_")}_${s.assessment}.pdf`
    const key = `${s.id}-0.pdf`

    const bytes = minimalPdf(`${assessment.title} - ${student.fullName} (${studentIdFor(s.seq)})`)
    try {
      await storage.save(new Blob([new Uint8Array(bytes)]), key)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }

    const data = {
      fileName,
      fileUrl: key,
      fileType: "application/pdf",
      fileSize: bytes.byteLength,
      submittedAt,
      isLate: isSubmissionLate(submittedAt, assessment.deadline),
    }
    await prisma.submission.upsert({
      where: { studentId_assessmentId: { studentId: studentIds.get(s.seq)!, assessmentId: assessment.id } },
      update: data,
      create: { id: s.id, studentId: studentIds.get(s.seq)!, assessmentId: assessment.id, ...data },
    })
  }

  // Results
  for (const r of RESULTS) {
    const where = {
      studentId_assessmentId: { studentId: studentIds.get(r.seq)!, assessmentId: assessments.get(r.assessment)!.id },
    }
    await prisma.result.upsert({
      where,
      update: { grade: r.grade, published: r.published },
      create: { ...where.studentId_assessmentId, grade: r.grade, published: r.published },
    })
  }

  const [programmeCount, tariffCount, studentCount, feeCount, paymentCount, assessmentCount, submissionCount, lateCount, resultCount, publishedCount, staffCount, studentUserCount] =
    await Promise.all([
      prisma.programme.count(),
      prisma.programmeFee.count(),
      prisma.student.count(),
      prisma.studentFee.count(),
      prisma.payment.count(),
      prisma.assessment.count(),
      prisma.submission.count(),
      prisma.submission.count({ where: { isLate: true } }),
      prisma.result.count(),
      prisma.result.count({ where: { published: true } }),
      prisma.user.count({ where: { role: "STAFF" } }),
      prisma.user.count({ where: { role: "STUDENT" } }),
    ])

  console.log(
    [
      `Seeded: ${programmeCount} programmes, ${tariffCount} tariffs, ${studentCount} students, ${feeCount} assigned fees, ${paymentCount} payments,`,
      `        ${assessmentCount} assessments, ${submissionCount} submissions (${lateCount} late), ${resultCount} results (${publishedCount} published),`,
      `        ${staffCount} staff users, ${studentUserCount} student users.`,
      `Demo password for every account: ${DEMO_PASSWORD}`,
    ].join("\n")
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
