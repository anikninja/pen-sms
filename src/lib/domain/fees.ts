import { Prisma } from "@prisma/client"

type Decimal = Prisma.Decimal
const ZERO = new Prisma.Decimal(0)
const DAY_MS = 24 * 60 * 60 * 1000

export type FeeStatus = "NO_FEE" | "PAID" | "OVERDUE" | "OUTSTANDING"

export function sumPayments(payments: Decimal[]): Decimal {
  return payments.reduce((total, amount) => total.plus(amount), ZERO)
}

/** Assigned fee minus payments, never below zero (architecture.md §7). */
export function calculateOutstanding(totalFee: Decimal, payments: Decimal[]): Decimal {
  const outstanding = totalFee.minus(sumPayments(payments))
  return outstanding.isNegative() ? ZERO : outstanding
}

/** Overdue only when something is still owed and now is strictly after the due date. */
export function isOverdue(outstanding: Decimal, dueDate: Date | null, now: Date): boolean {
  if (!dueDate) return false
  return outstanding.gt(0) && now.getTime() > dueDate.getTime()
}

/** Whole days since the due date; 0 when not yet past it. */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS))
}

/** An assigned fee must be positive and never below what the student has already paid (§6A). */
export function isValidFeeAmount(amount: Decimal, totalPaid: Decimal): boolean {
  return amount.gt(0) && amount.gte(totalPaid)
}

export function feeStatus(
  hasFee: boolean,
  outstanding: Decimal,
  dueDate: Date | null,
  now: Date
): FeeStatus {
  if (!hasFee) return "NO_FEE"
  if (outstanding.lte(0)) return "PAID"
  return isOverdue(outstanding, dueDate, now) ? "OVERDUE" : "OUTSTANDING"
}
