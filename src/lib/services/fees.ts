/**
 * Fees and payments on PostgreSQL (the running application).
 *
 * Concurrency relies on PostgreSQL: interactive transactions and a `SELECT … FOR UPDATE` row lock.
 * The fee rules, DTOs and messages are shared with the D1 implementation (src/lib/services/d1/fees.ts)
 * through src/lib/services/shared/fees.ts; money crosses from Decimal(12, 2) to minor units in
 * src/lib/services/decimal.ts.
 */
import { Prisma } from "@prisma/client"

import { isoDateToUtc } from "@/lib/domain/dates"
import { checkFeeAssignment, checkPayment } from "@/lib/domain/fees"
import { DomainError, fieldConflict, isUniqueViolation } from "@/lib/errors"
import { formatMoney, parseMoney } from "@/lib/money"
import { prisma } from "@/lib/prisma"
import { fromDecimal, sumFromDecimal } from "@/lib/services/decimal"
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

export { totalOutstandingByCurrency } from "@/lib/services/shared/fees"
export type { FeeOverviewRow, FeeSummary, OverdueStudent, PaymentDto, TariffDto } from "@/lib/services/shared/fees"

type Db = Prisma.TransactionClient | typeof prisma

async function totalPaid(db: Db, studentId: string): Promise<bigint> {
  const { _sum } = await db.payment.aggregate({ where: { studentId }, _sum: { amount: true } })
  return sumFromDecimal(_sum.amount)
}

/** Serialises payment recording and fee changes for one student (read-then-write safety, §7). */
async function lockStudent(tx: Prisma.TransactionClient, studentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE
  `
  if (rows.length === 0) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
}

export async function getStudentFeeSummary(studentId: string, now = new Date()): Promise<FeeSummary> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { programmeId: true, academicYear: true, fee: true },
  })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  const [paid, tariff] = await Promise.all([
    totalPaid(prisma, studentId),
    prisma.programmeFee.findUnique({
      where: {
        programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear },
      },
      select: { id: true, currency: true },
    }),
  ])

  const { fee } = student
  return buildFeeSummary({
    fee: fee ? { amount: fromDecimal(fee.amount), currency: fee.currency, dueDate: fee.dueDate, programmeFeeId: fee.programmeFeeId } : null,
    totalPaid: paid,
    tariff,
    now,
  })
}

export async function listPayments(studentId: string): Promise<PaymentDto[]> {
  const rows = await prisma.payment.findMany({
    where: { studentId },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, amount: true, paymentDate: true, referenceNumber: true, createdAt: true },
  })
  return rows.map((row) => ({ ...row, amount: formatMoney(fromDecimal(row.amount)), paymentDate: toIsoDate(row.paymentDate) }))
}

/** The tariff for the student's current programme and academic year, if one exists. */
export async function getTariffForStudent(studentId: string): Promise<TariffDto | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { programmeId: true, academicYear: true },
  })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  const tariff = await prisma.programmeFee.findUnique({
    where: { programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear } },
    select: { amount: true, currency: true, dueDate: true },
  })
  return tariff ? { ...tariff, amount: formatMoney(fromDecimal(tariff.amount)) } : null
}

export async function getStudentFees(studentId: string) {
  const [summary, payments, tariff] = await Promise.all([
    getStudentFeeSummary(studentId),
    listPayments(studentId),
    getTariffForStudent(studentId),
  ])
  return { summary, payments, tariff }
}

/** Every student's fee position in two queries — for the Fees list and dashboard totals (§19, §21). */
export async function listFeeOverview(filter: { status?: FeeOverviewRow["status"] } = {}, now = new Date()): Promise<FeeOverviewRow[]> {
  const [students, sums] = await Promise.all([
    prisma.student.findMany({
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
    prisma.payment.groupBy({ by: ["studentId"], _sum: { amount: true } }),
  ])
  const paidByStudent = new Map(sums.map((sum) => [sum.studentId, sumFromDecimal(sum._sum.amount)]))

  const rows = students.map(({ fee, ...student }) =>
    buildFeeOverviewRow(
      student,
      fee ? { amount: fromDecimal(fee.amount), currency: fee.currency, dueDate: fee.dueDate } : null,
      paidByStudent.get(student.id) ?? 0n,
      now
    )
  )

  return filter.status ? rows.filter((row) => row.status === filter.status) : rows
}

/** Records a payment. The outstanding balance is recomputed inside the locked transaction (§7). */
export async function createPayment(
  studentId: string,
  input: PaymentCreateInput
): Promise<PaymentDto & { studentId: string; updatedAt: Date }> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockStudent(tx, studentId)

      const fee = await tx.studentFee.findUnique({ where: { studentId } })
      const check = checkPayment(fee ? fromDecimal(fee.amount) : null, await totalPaid(tx, studentId), parseMoney(input.amount))
      if (!check.ok) throw paymentRejected(check, fee?.currency ?? "")

      return tx.payment.create({
        data: {
          studentId,
          amount: input.amount,
          paymentDate: isoDateToUtc(input.paymentDate),
          referenceNumber: input.referenceNumber,
        },
      })
    })
    return { ...row, amount: formatMoney(fromDecimal(row.amount)), paymentDate: toIsoDate(row.paymentDate) }
  } catch (error) {
    if (isUniqueViolation(error, "referenceNumber")) {
      throw fieldConflict("referenceNumber", DUPLICATE_PAYMENT_REFERENCE)
    }
    throw error
  }
}

/** Assigns the fee from the programme tariff, or sets it manually (scholarship, agreed amount). */
export async function assignStudentFee(studentId: string, input: FeeAssignInput): Promise<FeeSummary> {
  await prisma.$transaction(async (tx) => {
    await lockStudent(tx, studentId)

    const student = await tx.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { programmeId: true, academicYear: true, fee: { select: { currency: true } } },
    })

    let data: { programmeFeeId: string | null; amount: Prisma.Decimal; currency: string; dueDate: Date }
    if (input.source === "TARIFF") {
      const tariff = await tx.programmeFee.findUnique({
        where: {
          programmeId_academicYear: { programmeId: student.programmeId, academicYear: student.academicYear },
        },
      })
      if (!tariff) throw new DomainError("CONFLICT", NO_TARIFF)
      data = { programmeFeeId: tariff.id, amount: tariff.amount, currency: tariff.currency, dueDate: tariff.dueDate }
    } else {
      data = {
        programmeFeeId: null,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        dueDate: isoDateToUtc(input.dueDate),
      }
    }

    const paid = await totalPaid(tx, studentId)
    const check = checkFeeAssignment({
      amount: fromDecimal(data.amount),
      currency: data.currency,
      currentCurrency: student.fee?.currency ?? null,
      totalPaid: paid,
    })
    if (!check.ok) throw feeAssignmentRejected(check, input.source, data.currency, paid)

    await tx.studentFee.upsert({ where: { studentId }, create: { studentId, ...data }, update: data })
  })

  return getStudentFeeSummary(studentId)
}

/**
 * Students with an outstanding balance past their due date, most overdue first (§19).
 * A due date is a calendar day: overdue starts the day after it, in Dhaka.
 */
export async function getOverdueStudents(now = new Date()): Promise<OverdueStudent[]> {
  const fees = await prisma.studentFee.findMany({
    where: { dueDate: { lt: now } },
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
  })
  if (fees.length === 0) return []

  const sums = await prisma.payment.groupBy({
    by: ["studentId"],
    where: { studentId: { in: fees.map((fee) => fee.student.id) } },
    _sum: { amount: true },
  })
  const paidByStudent = new Map(sums.map((sum) => [sum.studentId, sumFromDecimal(sum._sum.amount)]))

  return toOverdueStudents(
    fees.map((fee) => ({ ...fee, amount: fromDecimal(fee.amount) })),
    paidByStudent,
    now
  )
}
