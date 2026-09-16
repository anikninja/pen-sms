import { Prisma, type EnrolmentStatus } from "@prisma/client"

import { isoDateToUtc } from "@/lib/domain/dates"
import {
  calculateOutstanding,
  daysOverdue,
  feeStatus,
  isOverdue,
  isValidFeeAmount,
  type FeeStatus,
} from "@/lib/domain/fees"
import { DomainError, fieldConflict, fieldError, isUniqueViolation } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { formatCurrency, toIsoDate } from "@/lib/utils/format"
import type { FeeAssignInput, PaymentCreateInput } from "@/lib/validations/fees"

const ZERO = new Prisma.Decimal(0)

/** Money is always a string in DTOs — Decimal cannot reach client components (§7). */
export type FeeSummary = {
  currency: string
  totalFee: string
  totalPaid: string
  outstanding: string
  dueDate: Date | null
  isOverdue: boolean
  daysOverdue: number
  status: FeeStatus
  hasFeeAssigned: boolean
  /** false when the fee was set manually or no longer matches the current programme/year tariff */
  matchesTariff: boolean
  source: "TARIFF" | "MANUAL" | null
}

export type PaymentDto = {
  id: string
  amount: string
  paymentDate: string // YYYY-MM-DD
  referenceNumber: string
  createdAt: Date
}

export type OverdueStudent = {
  id: string
  studentId: string
  fullName: string
  enrolmentStatus: EnrolmentStatus
  programme: { code: string; name: string }
  currency: string
  outstanding: string
  dueDate: Date
  daysOverdue: number
}

type Db = Prisma.TransactionClient | typeof prisma

async function totalPaid(db: Db, studentId: string): Promise<Prisma.Decimal> {
  const { _sum } = await db.payment.aggregate({ where: { studentId }, _sum: { amount: true } })
  return _sum.amount ?? ZERO
}

/** Serialises payment recording and fee changes for one student (read-then-write safety, §7). */
async function lockStudent(tx: Prisma.TransactionClient, studentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE
  `
  if (rows.length === 0) throw new DomainError("NOT_FOUND", "Student not found.")
}

export async function getStudentFeeSummary(studentId: string, now = new Date()): Promise<FeeSummary> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { programmeId: true, academicYear: true, fee: true },
  })
  if (!student) throw new DomainError("NOT_FOUND", "Student not found.")

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
  if (!fee) {
    return {
      currency: tariff?.currency ?? "BDT",
      totalFee: "0.00",
      totalPaid: paid.toFixed(2),
      outstanding: "0.00",
      dueDate: null,
      isOverdue: false,
      daysOverdue: 0,
      status: "NO_FEE",
      hasFeeAssigned: false,
      matchesTariff: false,
      source: null,
    }
  }

  const outstanding = calculateOutstanding(fee.amount, [paid])
  const overdue = isOverdue(outstanding, fee.dueDate, now)
  return {
    currency: fee.currency,
    totalFee: fee.amount.toFixed(2),
    totalPaid: paid.toFixed(2),
    outstanding: outstanding.toFixed(2),
    dueDate: fee.dueDate,
    isOverdue: overdue,
    daysOverdue: overdue ? daysOverdue(fee.dueDate, now) : 0,
    status: feeStatus(true, outstanding, fee.dueDate, now),
    hasFeeAssigned: true,
    matchesTariff: tariff !== null && fee.programmeFeeId === tariff.id,
    source: fee.programmeFeeId ? "TARIFF" : "MANUAL",
  }
}

export async function listPayments(studentId: string): Promise<PaymentDto[]> {
  const rows = await prisma.payment.findMany({
    where: { studentId },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, amount: true, paymentDate: true, referenceNumber: true, createdAt: true },
  })
  return rows.map((row) => ({ ...row, amount: row.amount.toFixed(2), paymentDate: toIsoDate(row.paymentDate) }))
}

export async function getStudentFees(studentId: string) {
  const [summary, payments] = await Promise.all([getStudentFeeSummary(studentId), listPayments(studentId)])
  return { summary, payments }
}

/** Records a payment. The outstanding balance is recomputed inside the locked transaction (§7). */
export async function createPayment(studentId: string, input: PaymentCreateInput): Promise<PaymentDto> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockStudent(tx, studentId)

      const fee = await tx.studentFee.findUnique({ where: { studentId } })
      if (!fee) throw new DomainError("CONFLICT", "No fee has been assigned to this student.")

      const outstanding = calculateOutstanding(fee.amount, [await totalPaid(tx, studentId)])
      if (outstanding.lte(0)) throw new DomainError("CONFLICT", "This student has already paid in full.")

      if (new Prisma.Decimal(input.amount).gt(outstanding)) {
        throw fieldError(
          "amount",
          `Payment exceeds the outstanding balance of ${formatCurrency(outstanding, fee.currency)}.`
        )
      }

      return tx.payment.create({
        data: {
          studentId,
          amount: input.amount,
          paymentDate: isoDateToUtc(input.paymentDate),
          referenceNumber: input.referenceNumber,
        },
      })
    })
    return { ...row, amount: row.amount.toFixed(2), paymentDate: toIsoDate(row.paymentDate) }
  } catch (error) {
    if (isUniqueViolation(error, "referenceNumber")) {
      throw fieldConflict("referenceNumber", "This payment reference already exists.")
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
      if (!tariff) {
        throw new DomainError("CONFLICT", "No fee tariff exists for this student's programme and academic year.")
      }
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
    if (paid.gt(0) && student.fee && student.fee.currency !== data.currency) {
      throw new DomainError("CONFLICT", "The currency cannot change after payments have been recorded.")
    }
    if (!isValidFeeAmount(data.amount, paid)) {
      const message = `Fee cannot be less than the amount already paid (${formatCurrency(paid, data.currency)}).`
      throw input.source === "MANUAL" ? fieldError("amount", message) : new DomainError("CONFLICT", message)
    }

    await tx.studentFee.upsert({ where: { studentId }, create: { studentId, ...data }, update: data })
  })

  return getStudentFeeSummary(studentId)
}

/** Students with an outstanding balance past their due date, most overdue first (§19). */
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
  const paidByStudent = new Map(sums.map((sum) => [sum.studentId, sum._sum.amount ?? ZERO]))

  return fees
    .map((fee) => ({ fee, outstanding: calculateOutstanding(fee.amount, [paidByStudent.get(fee.student.id) ?? ZERO]) }))
    .filter(({ fee, outstanding }) => isOverdue(outstanding, fee.dueDate, now))
    .map(({ fee, outstanding }) => ({
      ...fee.student,
      currency: fee.currency,
      outstanding: outstanding.toFixed(2),
      dueDate: fee.dueDate,
      daysOverdue: daysOverdue(fee.dueDate, now),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.studentId.localeCompare(b.studentId))
}
