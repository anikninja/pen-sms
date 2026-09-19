/**
 * Fee DTOs, summaries and rule errors shared by the PostgreSQL services (src/lib/services/fees.ts)
 * and the D1 services (src/lib/services/d1/fees.ts). Amounts come in as minor-unit bigints and
 * leave as decimal strings; nothing here touches a database client.
 */
import { calendarDaysPast, endOfRegistryDay } from "@/lib/domain/dates"
import type { EnrolmentStatus } from "@/lib/domain/enums"
import {
  calculateOutstanding,
  feeStatus,
  isOverdue,
  type FeeAssignmentCheck,
  type FeeStatus,
  type PaymentCheck,
} from "@/lib/domain/fees"
import { DomainError, fieldError } from "@/lib/errors"
import { formatMoney, parseMoney } from "@/lib/money"
import { formatCurrency } from "@/lib/utils/format"

export const DUPLICATE_PAYMENT_REFERENCE = "This payment reference already exists."
export const NO_TARIFF = "No fee tariff exists for this student's programme and academic year."

/** Money is always a string in DTOs — Decimal and bigint cannot reach client components (§7). */
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

export type TariffDto = { amount: string; currency: string; dueDate: Date }

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

export type FeeOverviewRow = {
  student: {
    id: string
    studentId: string
    fullName: string
    enrolmentStatus: EnrolmentStatus
    programme: { code: string; name: string }
  }
  status: FeeStatus
  currency: string | null
  totalFee: string
  totalPaid: string
  outstanding: string
  dueDate: Date | null
  daysOverdue: number
}

/** An assigned fee in minor units, whichever database it came from. */
export type AssignedFee = { amount: bigint; currency: string; dueDate: Date; programmeFeeId: string | null }

export function buildFeeSummary(input: {
  fee: AssignedFee | null
  totalPaid: bigint
  tariff: { id: string; currency: string } | null
  now: Date
}): FeeSummary {
  const { fee, totalPaid, tariff, now } = input
  if (!fee) {
    return {
      currency: tariff?.currency ?? "BDT",
      totalFee: "0.00",
      totalPaid: formatMoney(totalPaid),
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

  const outstanding = calculateOutstanding(fee.amount, [totalPaid])
  const overdue = isOverdue(outstanding, endOfRegistryDay(fee.dueDate), now)
  return {
    currency: fee.currency,
    totalFee: formatMoney(fee.amount),
    totalPaid: formatMoney(totalPaid),
    outstanding: formatMoney(outstanding),
    dueDate: fee.dueDate,
    isOverdue: overdue,
    daysOverdue: overdue ? calendarDaysPast(fee.dueDate, now) : 0,
    status: feeStatus(true, outstanding, endOfRegistryDay(fee.dueDate), now),
    hasFeeAssigned: true,
    matchesTariff: tariff !== null && fee.programmeFeeId === tariff.id,
    source: fee.programmeFeeId ? "TARIFF" : "MANUAL",
  }
}

export function buildFeeOverviewRow(
  student: FeeOverviewRow["student"],
  fee: { amount: bigint; currency: string; dueDate: Date } | null,
  totalPaid: bigint,
  now: Date
): FeeOverviewRow {
  if (!fee) {
    return {
      student,
      status: "NO_FEE",
      currency: null,
      totalFee: "0.00",
      totalPaid: formatMoney(totalPaid),
      outstanding: "0.00",
      dueDate: null,
      daysOverdue: 0,
    }
  }
  const outstanding = calculateOutstanding(fee.amount, [totalPaid])
  const status = feeStatus(true, outstanding, endOfRegistryDay(fee.dueDate), now)
  return {
    student,
    status,
    currency: fee.currency,
    totalFee: formatMoney(fee.amount),
    totalPaid: formatMoney(totalPaid),
    outstanding: formatMoney(outstanding),
    dueDate: fee.dueDate,
    daysOverdue: status === "OVERDUE" ? calendarDaysPast(fee.dueDate, now) : 0,
  }
}

/** Sums outstanding balances per currency, exactly, e.g. [{ currency: "BDT", amount: "435000.00" }]. */
export function totalOutstandingByCurrency(rows: FeeOverviewRow[]): { currency: string; amount: string }[] {
  const totals = new Map<string, bigint>()
  for (const row of rows) {
    if (!row.currency) continue
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + parseMoney(row.outstanding))
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount: formatMoney(amount) }))
}

/**
 * Students with an outstanding balance past their due date, most overdue first (§19).
 * A due date is a calendar day: overdue starts the day after it, in Dhaka.
 */
export function toOverdueStudents(
  fees: { amount: bigint; currency: string; dueDate: Date; student: Omit<OverdueStudent, "currency" | "outstanding" | "dueDate" | "daysOverdue"> }[],
  paidByStudent: Map<string, bigint>,
  now: Date
): OverdueStudent[] {
  return fees
    .map((fee) => ({ fee, outstanding: calculateOutstanding(fee.amount, [paidByStudent.get(fee.student.id) ?? 0n]) }))
    .filter(({ fee, outstanding }) => isOverdue(outstanding, endOfRegistryDay(fee.dueDate), now))
    .map(({ fee, outstanding }) => ({
      ...fee.student,
      currency: fee.currency,
      outstanding: formatMoney(outstanding),
      dueDate: fee.dueDate,
      daysOverdue: calendarDaysPast(fee.dueDate, now),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.studentId.localeCompare(b.studentId))
}

/** The error the Registry sees for a rejected payment. `currency` is the fee's currency. */
export function paymentRejected(check: Exclude<PaymentCheck, { ok: true }>, currency: string): DomainError {
  switch (check.reason) {
    case "NO_FEE":
      return new DomainError("CONFLICT", "No fee has been assigned to this student.")
    case "PAID_IN_FULL":
      return new DomainError("CONFLICT", "This student has already paid in full.")
    case "EXCEEDS_OUTSTANDING":
      return fieldError(
        "amount",
        `Payment exceeds the outstanding balance of ${formatCurrency(formatMoney(check.outstanding), currency)}.`
      )
  }
}

/** The error for a rejected fee assignment. `currency` is the currency of the fee being assigned. */
export function feeAssignmentRejected(
  check: Exclude<FeeAssignmentCheck, { ok: true }>,
  source: "TARIFF" | "MANUAL",
  currency: string,
  totalPaid: bigint
): DomainError {
  if (check.reason === "CURRENCY_LOCKED") {
    return new DomainError("CONFLICT", "The currency cannot change after payments have been recorded.")
  }
  const message = `Fee cannot be less than the amount already paid (${formatCurrency(formatMoney(totalPaid), currency)}).`
  return source === "MANUAL" ? fieldError("amount", message) : new DomainError("CONFLICT", message)
}
