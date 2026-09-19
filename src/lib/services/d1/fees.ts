/**
 * Fees and payments on Cloudflare D1 (prisma/d1/schema.prisma). Same rules, DTOs and messages as
 * the PostgreSQL service (src/lib/services/fees.ts); not wired into the application yet.
 *
 * PostgreSQL serialised these writes with `SELECT … FOR UPDATE` inside interactive transactions.
 * D1 has neither, but executes statements one at a time, each atomically. So each write is ONE
 * conditional statement that re-checks the invariant against the committed data as it inserts:
 * - a payment is inserted only if it fits in the outstanding balance at that instant;
 * - a fee is (re)assigned only if it is not below what has been paid, and the currency rule holds.
 * When the statement writes nothing, the current state is read and the shared rules
 * (src/lib/domain/fees.ts) explain why, with the same messages as on PostgreSQL.
 *
 * Money columns hold minor units (bigint); see src/lib/money.ts.
 */
import { isoDateToUtc } from "@/lib/domain/dates"
import { checkFeeAssignment, checkPayment } from "@/lib/domain/fees"
import { DomainError, fieldConflict, isUniqueViolation } from "@/lib/errors"
import { formatMoney, parseMoney } from "@/lib/money"
import type { D1Client } from "@/lib/services/d1/client"
import {
  buildFeeOverviewRow,
  buildFeeSummary,
  DUPLICATE_PAYMENT_REFERENCE,
  feeAssignmentRejected,
  NO_TARIFF,
  paymentRejected,
  toOverdueStudents,
  type FeeOverviewRow,
  type FeeSummary,
  type OverdueStudent,
  type PaymentDto,
  type TariffDto,
} from "@/lib/services/shared/fees"
import { STUDENT_NOT_FOUND } from "@/lib/services/shared/students"
import { toIsoDate } from "@/lib/utils/format"
import type { FeeAssignInput, PaymentCreateInput } from "@/lib/validations/fees"

/** A conditional write found the state changed between the write and the explanation; rare. */
const MAX_WRITE_ATTEMPTS = 3
const BALANCE_CHANGED = "The balance changed while this was being saved. Please try again."

export async function totalPaid(db: D1Client, studentId: string): Promise<bigint> {
  const { _sum } = await db.payment.aggregate({ where: { studentId }, _sum: { amount: true } })
  return _sum.amount ?? 0n
}

export async function getStudentFeeSummary(db: D1Client, studentId: string, now = new Date()): Promise<FeeSummary> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { programmeId: true, academicYear: true, fee: true },
  })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  const [paid, tariff] = await Promise.all([
    totalPaid(db, studentId),
    db.programmeFee.findUnique({
      where: { programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear } },
      select: { id: true, currency: true },
    }),
  ])
  return buildFeeSummary({ fee: student.fee, totalPaid: paid, tariff, now })
}

export async function listPayments(db: D1Client, studentId: string): Promise<PaymentDto[]> {
  const rows = await db.payment.findMany({
    where: { studentId },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, amount: true, paymentDate: true, referenceNumber: true, createdAt: true },
  })
  return rows.map((row) => ({ ...row, amount: formatMoney(row.amount), paymentDate: toIsoDate(row.paymentDate) }))
}

/** The tariff for the student's current programme and academic year, if one exists. */
export async function getTariffForStudent(db: D1Client, studentId: string): Promise<TariffDto | null> {
  const student = await db.student.findUnique({ where: { id: studentId }, select: { programmeId: true, academicYear: true } })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  const tariff = await db.programmeFee.findUnique({
    where: { programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear } },
    select: { amount: true, currency: true, dueDate: true },
  })
  return tariff ? { ...tariff, amount: formatMoney(tariff.amount) } : null
}

export async function getStudentFees(db: D1Client, studentId: string, now = new Date()) {
  const [summary, payments, tariff] = await Promise.all([
    getStudentFeeSummary(db, studentId, now),
    listPayments(db, studentId),
    getTariffForStudent(db, studentId),
  ])
  return { summary, payments, tariff }
}

/** Every student's fee position in two queries — for the Fees list and dashboard totals (§19, §21). */
export async function listFeeOverview(
  db: D1Client,
  filter: { status?: FeeOverviewRow["status"] } = {},
  now = new Date()
): Promise<FeeOverviewRow[]> {
  const [students, sums] = await Promise.all([
    db.student.findMany({
      orderBy: { studentId: "asc" },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        enrolmentStatus: true,
        programme: { select: { code: true, name: true } },
        fee: { select: { amount: true, currency: true, dueDate: true } },
      },
    }),
    db.payment.groupBy({ by: ["studentId"], _sum: { amount: true } }),
  ])
  const paidByStudent = new Map(sums.map((sum) => [sum.studentId, sum._sum.amount ?? 0n]))

  const rows = students.map(({ fee, ...student }) => buildFeeOverviewRow(student, fee, paidByStudent.get(student.id) ?? 0n, now))
  return filter.status ? rows.filter((row) => row.status === filter.status) : rows
}

/**
 * Records a payment (§7). The insert happens only if, at that instant, the student has a fee and
 * the amount is at most the fee minus everything already paid. Two concurrent payments are each
 * checked against the other's committed amount, so together they can never exceed the fee.
 * A repeated request with the same reference number is rejected by the unique index.
 */
export async function createPayment(
  db: D1Client,
  studentId: string,
  input: PaymentCreateInput,
  now = new Date()
): Promise<PaymentDto & { studentId: string; updatedAt: Date }> {
  const amount = parseMoney(input.amount)
  const paymentDate = isoDateToUtc(input.paymentDate)

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const id = crypto.randomUUID()
    let inserted: number
    try {
      inserted = await db.$executeRaw`
        INSERT INTO "Payment" ("id", "studentId", "amount", "paymentDate", "referenceNumber", "createdAt", "updatedAt")
        SELECT ${id}, f."studentId", ${amount}, ${paymentDate}, ${input.referenceNumber}, ${now}, ${now}
        FROM "StudentFee" f
        WHERE f."studentId" = ${studentId}
          AND ${amount} > 0
          AND ${amount} <= f."amount" - (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."studentId" = f."studentId")`
    } catch (error) {
      if (isUniqueViolation(error, "referenceNumber")) {
        throw fieldConflict("referenceNumber", DUPLICATE_PAYMENT_REFERENCE)
      }
      throw error
    }

    if (inserted === 1) {
      return {
        id,
        studentId,
        amount: formatMoney(amount),
        paymentDate: toIsoDate(paymentDate),
        referenceNumber: input.referenceNumber,
        createdAt: now,
        updatedAt: now,
      }
    }

    // Nothing inserted: explain why from the current state, in the PostgreSQL order and wording.
    const [student, fee, paid] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      db.studentFee.findUnique({ where: { studentId }, select: { amount: true, currency: true } }),
      totalPaid(db, studentId),
    ])
    if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
    const check = checkPayment(fee?.amount ?? null, paid, amount)
    if (!check.ok) throw paymentRejected(check, fee?.currency ?? "")
    // The fee grew between the insert and the read; try the conditional insert again.
  }
  throw new DomainError("CONFLICT", BALANCE_CHANGED)
}

/**
 * Assigns the fee from the programme tariff, or sets it manually (§6A) — one INSERT … ON CONFLICT
 * statement, so a student never has two fees and the checks see the payments committed at that
 * instant: the fee is never set below what has been paid, and its currency cannot change once
 * anything has been paid. The tariff (TARIFF) is read inside the same statement.
 */
export async function assignStudentFee(
  db: D1Client,
  studentId: string,
  input: FeeAssignInput,
  now = new Date()
): Promise<FeeSummary> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const written = input.source === "TARIFF" ? await upsertFeeFromTariff(db, studentId, now) : await upsertManualFee(db, studentId, input, now)
    if (written === 1) return getStudentFeeSummary(db, studentId, now)

    // Nothing written: explain why from the current state.
    const student = await db.student.findUnique({
      where: { id: studentId },
      select: { programmeId: true, academicYear: true, fee: { select: { currency: true } } },
    })
    if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

    let fee: { amount: bigint; currency: string }
    if (input.source === "TARIFF") {
      const tariff = await db.programmeFee.findUnique({
        where: { programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear } },
        select: { amount: true, currency: true },
      })
      if (!tariff) throw new DomainError("CONFLICT", NO_TARIFF)
      fee = tariff
    } else {
      fee = { amount: parseMoney(input.amount), currency: input.currency }
    }

    const paid = await totalPaid(db, studentId)
    const check = checkFeeAssignment({ ...fee, currentCurrency: student.fee?.currency ?? null, totalPaid: paid })
    if (!check.ok) throw feeAssignmentRejected(check, input.source, fee.currency, paid)
    // Payments changed between the write and the read; try the conditional write again.
  }
  throw new DomainError("CONFLICT", BALANCE_CHANGED)
}

function upsertFeeFromTariff(db: D1Client, studentId: string, now: Date): Promise<number> {
  return db.$executeRaw`
    INSERT INTO "StudentFee" ("id", "studentId", "programmeFeeId", "amount", "currency", "dueDate", "createdAt", "updatedAt")
    SELECT ${crypto.randomUUID()}, s."id", t."id", t."amount", t."currency", t."dueDate", ${now}, ${now}
    FROM "Student" s
    JOIN "ProgrammeFee" t ON t."programmeId" = s."programmeId" AND t."academicYear" = s."academicYear"
    WHERE s."id" = ${studentId}
      AND t."amount" > 0
      AND t."amount" >= (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."studentId" = s."id")
      AND NOT (
        (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."studentId" = s."id") > 0
        AND EXISTS (SELECT 1 FROM "StudentFee" f WHERE f."studentId" = s."id" AND f."currency" <> t."currency")
      )
    ON CONFLICT ("studentId") DO UPDATE SET
      "programmeFeeId" = excluded."programmeFeeId",
      "amount" = excluded."amount",
      "currency" = excluded."currency",
      "dueDate" = excluded."dueDate",
      "updatedAt" = excluded."updatedAt"`
}

function upsertManualFee(
  db: D1Client,
  studentId: string,
  input: Extract<FeeAssignInput, { source: "MANUAL" }>,
  now: Date
): Promise<number> {
  const amount = parseMoney(input.amount)
  return db.$executeRaw`
    INSERT INTO "StudentFee" ("id", "studentId", "programmeFeeId", "amount", "currency", "dueDate", "createdAt", "updatedAt")
    SELECT ${crypto.randomUUID()}, s."id", NULL, ${amount}, ${input.currency}, ${isoDateToUtc(input.dueDate)}, ${now}, ${now}
    FROM "Student" s
    WHERE s."id" = ${studentId}
      AND ${amount} > 0
      AND ${amount} >= (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."studentId" = s."id")
      AND NOT (
        (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."studentId" = s."id") > 0
        AND EXISTS (SELECT 1 FROM "StudentFee" f WHERE f."studentId" = s."id" AND f."currency" <> ${input.currency})
      )
    ON CONFLICT ("studentId") DO UPDATE SET
      "programmeFeeId" = excluded."programmeFeeId",
      "amount" = excluded."amount",
      "currency" = excluded."currency",
      "dueDate" = excluded."dueDate",
      "updatedAt" = excluded."updatedAt"`
}

/**
 * Students with an outstanding balance past their due date, most overdue first (§19).
 *
 * The PostgreSQL version passes every overdue student's id to `studentId IN (…)`, which would exceed
 * D1's bound-parameter limit (98 per statement in @prisma/adapter-d1) with enough students. Here the
 * payment sums are filtered by relation instead — "payments of students whose fee is past due" — the
 * same set, with a constant number of parameters. Date filters stay in Prisma queries: Prisma owns the
 * DateTime encoding, which differs between its native SQLite engine and the D1 adapter.
 */
export async function getOverdueStudents(db: D1Client, now = new Date()): Promise<OverdueStudent[]> {
  const pastDue = { dueDate: { lt: now } }
  const [fees, sums] = await Promise.all([
    db.studentFee.findMany({
      where: pastDue,
      select: {
        amount: true,
        currency: true,
        dueDate: true,
        student: {
          select: {
            id: true,
            studentId: true,
            fullName: true,
            enrolmentStatus: true,
            programme: { select: { code: true, name: true } },
          },
        },
      },
    }),
    db.payment.groupBy({
      by: ["studentId"],
      where: { student: { is: { fee: { is: pastDue } } } },
      _sum: { amount: true },
    }),
  ])
  if (fees.length === 0) return []

  const paidByStudent = new Map(sums.map((sum) => [sum.studentId, sum._sum.amount ?? 0n]))
  return toOverdueStudents(fees, paidByStudent, now)
}
