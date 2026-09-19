/**
 * Fee rules on exact minor-unit amounts (`bigint`, see src/lib/money.ts). Shared by the
 * PostgreSQL services (which convert from Decimal) and the D1 services (which store bigint).
 */
const DAY_MS = 24 * 60 * 60 * 1000

export type FeeStatus = "NO_FEE" | "PAID" | "OVERDUE" | "OUTSTANDING"

export function sumPayments(payments: readonly bigint[]): bigint {
  return payments.reduce((total, amount) => total + amount, 0n)
}

/** Assigned fee minus payments, never below zero (architecture.md §7). */
export function calculateOutstanding(totalFee: bigint, payments: readonly bigint[]): bigint {
  const outstanding = totalFee - sumPayments(payments)
  return outstanding < 0n ? 0n : outstanding
}

/** Overdue only when something is still owed and now is strictly after the due date. */
export function isOverdue(outstanding: bigint, dueDate: Date | null, now: Date): boolean {
  if (!dueDate) return false
  return outstanding > 0n && now.getTime() > dueDate.getTime()
}

/** Whole days since the due date; 0 when not yet past it. */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS))
}

/** An assigned fee must be positive and never below what the student has already paid (§6A). */
export function isValidFeeAmount(amount: bigint, totalPaid: bigint): boolean {
  return amount > 0n && amount >= totalPaid
}

export function feeStatus(hasFee: boolean, outstanding: bigint, dueDate: Date | null, now: Date): FeeStatus {
  if (!hasFee) return "NO_FEE"
  if (outstanding <= 0n) return "PAID"
  return isOverdue(outstanding, dueDate, now) ? "OVERDUE" : "OUTSTANDING"
}

export type PaymentCheck =
  | { ok: true; outstanding: bigint }
  | { ok: false; reason: "NO_FEE" }
  | { ok: false; reason: "PAID_IN_FULL" }
  | { ok: false; reason: "EXCEEDS_OUTSTANDING"; outstanding: bigint }

/**
 * Whether a payment may be recorded (§7), in the order the Registry reports problems:
 * no fee assigned, already paid in full, more than the outstanding balance.
 */
export function checkPayment(feeAmount: bigint | null, totalPaid: bigint, amount: bigint): PaymentCheck {
  if (feeAmount === null) return { ok: false, reason: "NO_FEE" }
  const outstanding = calculateOutstanding(feeAmount, [totalPaid])
  if (outstanding <= 0n) return { ok: false, reason: "PAID_IN_FULL" }
  if (amount > outstanding) return { ok: false, reason: "EXCEEDS_OUTSTANDING", outstanding }
  return { ok: true, outstanding }
}

export type FeeAssignmentCheck = { ok: true } | { ok: false; reason: "CURRENCY_LOCKED" } | { ok: false; reason: "BELOW_PAID" }

/**
 * Whether a fee may be (re)assigned (§6A): the currency is fixed once payments exist, and the fee
 * can never drop below what has been paid.
 */
export function checkFeeAssignment(input: {
  amount: bigint
  currency: string
  /** Currency of the fee currently assigned, or null when there is none. */
  currentCurrency: string | null
  totalPaid: bigint
}): FeeAssignmentCheck {
  if (input.totalPaid > 0n && input.currentCurrency !== null && input.currentCurrency !== input.currency) {
    return { ok: false, reason: "CURRENCY_LOCKED" }
  }
  if (!isValidFeeAmount(input.amount, input.totalPaid)) return { ok: false, reason: "BELOW_PAID" }
  return { ok: true }
}
