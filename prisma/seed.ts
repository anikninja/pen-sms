/**
 * Demo data. Idempotent: every write is an upsert on a unique key, so it can be re-run safely.
 *
 * Current scope: programmes, fee tariffs, students with assigned fees, and login accounts.
 * Payments, assessments, submissions and results are added in Phase 3 (docs/architecture.md §28, §41).
 *
 * Dates are relative to "now" so the overdue / not-yet-due scenarios stay true whenever it runs.
 */
import { EnrolmentStatus, PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

// Shared by every seeded account. Also shown on the login page when DEMO_MODE="true".
const DEMO_PASSWORD = "Password123!"

const now = new Date()
const YEAR = now.getFullYear()
const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

const PROGRAMMES = [
  {
    code: "BSC-CS",
    name: "BSc Computer Science",
    description: "Four-year undergraduate programme in computer science.",
    fee: { amount: "150000.00", dueDate: daysFromNow(-30) }, // past due → overdue scenario
  },
  {
    code: "MBA",
    name: "Master of Business Administration",
    description: "Two-year postgraduate business programme.",
    fee: { amount: "250000.00", dueDate: daysFromNow(60) }, // not yet due
  },
] as const

// # matches docs/architecture.md §28. Abir Hossain (student 3, overdue with no payments) sorts first by name.
const STUDENTS: {
  seq: number
  fullName: string
  email: string
  dateOfBirth: string
  programme: (typeof PROGRAMMES)[number]["code"]
  status: EnrolmentStatus
}[] = [
  { seq: 1, fullName: "Nusrat Jahan", email: "nusrat.jahan@student.pensms.test", dateOfBirth: "2004-03-14", programme: "BSC-CS", status: "ENROLLED" },
  { seq: 2, fullName: "Rahim Uddin", email: "rahim.uddin@student.pensms.test", dateOfBirth: "2003-11-02", programme: "BSC-CS", status: "ENROLLED" },
  { seq: 3, fullName: "Abir Hossain", email: "abir.hossain@student.pensms.test", dateOfBirth: "2004-07-21", programme: "BSC-CS", status: "ENROLLED" },
  { seq: 4, fullName: "Tanvir Ahmed", email: "tanvir.ahmed@student.pensms.test", dateOfBirth: "2003-05-09", programme: "BSC-CS", status: "DEFERRED" },
  { seq: 5, fullName: "Farhana Akter", email: "farhana.akter@student.pensms.test", dateOfBirth: "1998-09-30", programme: "MBA", status: "ENROLLED" },
  { seq: 6, fullName: "Sadia Islam", email: "sadia.islam@student.pensms.test", dateOfBirth: "1997-01-18", programme: "MBA", status: "COMPLETED" },
]

const STAFF = [{ name: "Registry Admin", email: "registry@pensms.test" }]

const studentIdFor = (seq: number) => `SMS-${YEAR}-${String(seq).padStart(4, "0")}`

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  const programmeIds = new Map<string, string>()
  const tariffs = new Map<string, { id: string; amount: string; currency: string; dueDate: Date }>()

  for (const p of PROGRAMMES) {
    const programme = await prisma.programme.upsert({
      where: { code: p.code },
      update: { name: p.name, description: p.description, active: true },
      create: { code: p.code, name: p.name, description: p.description },
    })
    programmeIds.set(p.code, programme.id)

    const tariff = await prisma.programmeFee.upsert({
      where: { programmeId_academicYear: { programmeId: programme.id, academicYear: YEAR } },
      update: { amount: p.fee.amount, currency: "BDT", dueDate: p.fee.dueDate },
      create: {
        programmeId: programme.id,
        academicYear: YEAR,
        amount: p.fee.amount,
        currency: "BDT",
        dueDate: p.fee.dueDate,
      },
    })
    tariffs.set(p.code, { id: tariff.id, amount: p.fee.amount, currency: "BDT", dueDate: p.fee.dueDate })
  }

  for (const s of STUDENTS) {
    const programmeId = programmeIds.get(s.programme)!
    const tariff = tariffs.get(s.programme)!
    const data = {
      fullName: s.fullName,
      email: s.email,
      dateOfBirth: new Date(`${s.dateOfBirth}T00:00:00.000Z`),
      programmeId,
      academicYear: YEAR,
      enrolmentStatus: s.status,
    }

    const student = await prisma.student.upsert({
      where: { studentId: studentIdFor(s.seq) },
      update: data,
      create: { studentId: studentIdFor(s.seq), ...data },
    })

    // Assigned fee is a snapshot of the tariff (docs/architecture.md §6A).
    const fee = {
      programmeFeeId: tariff.id,
      amount: tariff.amount,
      currency: tariff.currency,
      dueDate: tariff.dueDate,
    }
    await prisma.studentFee.upsert({
      where: { studentId: student.id },
      update: fee,
      create: { studentId: student.id, ...fee },
    })

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

  const counts = await Promise.all([
    prisma.programme.count(),
    prisma.programmeFee.count(),
    prisma.student.count(),
    prisma.studentFee.count(),
    prisma.user.count({ where: { role: "STAFF" } }),
    prisma.user.count({ where: { role: "STUDENT" } }),
  ])
  console.log(
    `Seeded: ${counts[0]} programmes, ${counts[1]} tariffs, ${counts[2]} students, ` +
      `${counts[3]} assigned fees, ${counts[4]} staff users, ${counts[5]} student users.`
  )
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
