import { describe, expect, it } from "vitest"

import {
  calculateOutstanding,
  checkFeeAssignment,
  checkPayment,
  daysOverdue,
  feeStatus,
  isOverdue,
  isValidFeeAmount,
  sumPayments,
} from "@/lib/domain/fees"
import { formatMoney, parseMoney } from "@/lib/money"

/** Decimal string → minor units, so fixtures read like the amounts users see. */
const m = (value: string) => parseMoney(value)

describe("calculateOutstanding", () => {
  it("equals the fee when there are no payments", () => {
    expect(formatMoney(calculateOutstanding(m("150000.00"), []))).toBe("150000.00")
  })

  it("subtracts partial payments exactly (no float drift)", () => {
    expect(formatMoney(calculateOutstanding(m("150000.00"), [m("50000.10"), m("40000.20")]))).toBe("59999.70")
    expect(formatMoney(calculateOutstanding(m("0.30"), [m("0.10"), m("0.20")]))).toBe("0.00")
  })

  it("is zero when paid exactly", () => {
    expect(calculateOutstanding(m("250000"), [m("250000")])).toBe(0n)
  })

  it("never goes below zero on overpayment", () => {
    expect(calculateOutstanding(m("100"), [m("150")])).toBe(0n)
  })

  it("stays exact at the largest amounts", () => {
    expect(calculateOutstanding(m("9999999999.99"), [m("0.01")])).toBe(m("9999999999.98"))
  })
})

describe("isOverdue", () => {
  const due = new Date("2026-06-30T00:00:00.000Z")
  const before = new Date("2026-06-29T12:00:00.000Z")
  const after = new Date("2026-07-01T00:00:00.000Z")

  it("is false when nothing is outstanding, even past due", () => {
    expect(isOverdue(0n, due, after)).toBe(false)
  })

  it("is false when outstanding but not yet due", () => {
    expect(isOverdue(m("100"), due, before)).toBe(false)
  })

  it("is true when outstanding and past due", () => {
    expect(isOverdue(m("100"), due, after)).toBe(true)
    expect(isOverdue(1n, due, after)).toBe(true) // a single paisa still counts
  })

  it("is false exactly at the due date (strictly greater)", () => {
    expect(isOverdue(m("100"), due, new Date(due))).toBe(false)
  })

  it("is false without a due date", () => {
    expect(isOverdue(m("100"), null, after)).toBe(false)
  })
})

describe("isValidFeeAmount", () => {
  it("rejects zero", () => expect(isValidFeeAmount(0n, 0n)).toBe(false))
  it("rejects an amount below what was paid", () => expect(isValidFeeAmount(m("80000"), m("90000"))).toBe(false))
  it("accepts an amount equal to what was paid", () => expect(isValidFeeAmount(m("90000"), m("90000"))).toBe(true))
  it("accepts an amount above what was paid", () => expect(isValidFeeAmount(m("150000"), m("90000"))).toBe(true))
})

describe("feeStatus and helpers", () => {
  const due = new Date("2026-06-30T00:00:00.000Z")
  const after = new Date("2026-07-03T06:00:00.000Z")

  it("classifies each state", () => {
    expect(feeStatus(false, 0n, null, after)).toBe("NO_FEE")
    expect(feeStatus(true, 0n, due, after)).toBe("PAID")
    expect(feeStatus(true, m("10"), due, after)).toBe("OVERDUE")
    expect(feeStatus(true, m("10"), due, new Date("2026-06-01"))).toBe("OUTSTANDING")
  })

  it("counts whole days overdue", () => {
    expect(daysOverdue(due, after)).toBe(3)
    expect(daysOverdue(due, new Date("2026-06-01"))).toBe(0)
  })

  it("sums payments", () => {
    expect(formatMoney(sumPayments([m("1.10"), m("2.20")]))).toBe("3.30")
  })
})

describe("checkPayment", () => {
  it("accepts a partial payment and reports the balance before it", () => {
    expect(checkPayment(m("150000"), m("90000"), m("10000.50"))).toEqual({ ok: true, outstanding: m("60000") })
  })

  it("accepts exactly the outstanding balance", () => {
    expect(checkPayment(m("150000"), m("90000"), m("60000"))).toEqual({ ok: true, outstanding: m("60000") })
  })

  it("rejects one paisa over the outstanding balance", () => {
    expect(checkPayment(m("150000"), m("90000"), m("60000.01"))).toEqual({
      ok: false,
      reason: "EXCEEDS_OUTSTANDING",
      outstanding: m("60000"),
    })
  })

  it("rejects when no fee is assigned", () => {
    expect(checkPayment(null, 0n, m("1"))).toEqual({ ok: false, reason: "NO_FEE" })
  })

  it("rejects when already paid in full (or overpaid)", () => {
    expect(checkPayment(m("150000"), m("150000"), m("1"))).toEqual({ ok: false, reason: "PAID_IN_FULL" })
    expect(checkPayment(m("100"), m("150"), m("1"))).toEqual({ ok: false, reason: "PAID_IN_FULL" })
  })
})

describe("checkFeeAssignment", () => {
  const base = { amount: m("150000"), currency: "BDT", currentCurrency: "BDT", totalPaid: m("100000") }

  it("accepts a fee at or above what was paid", () => {
    expect(checkFeeAssignment(base)).toEqual({ ok: true })
    expect(checkFeeAssignment({ ...base, amount: m("100000") })).toEqual({ ok: true })
  })

  it("rejects a fee below what was paid", () => {
    expect(checkFeeAssignment({ ...base, amount: m("99999.99") })).toEqual({ ok: false, reason: "BELOW_PAID" })
  })

  it("rejects a zero fee even with nothing paid", () => {
    expect(checkFeeAssignment({ ...base, amount: 0n, totalPaid: 0n })).toEqual({ ok: false, reason: "BELOW_PAID" })
  })

  it("locks the currency once payments exist", () => {
    expect(checkFeeAssignment({ ...base, currency: "USD" })).toEqual({ ok: false, reason: "CURRENCY_LOCKED" })
  })

  it("allows a currency change before any payment, or when no fee exists yet", () => {
    expect(checkFeeAssignment({ ...base, currency: "USD", totalPaid: 0n })).toEqual({ ok: true })
    expect(checkFeeAssignment({ ...base, currency: "USD", currentCurrency: null })).toEqual({ ok: true })
  })

  it("checks the currency before the amount (the order the Registry sees errors)", () => {
    expect(checkFeeAssignment({ ...base, currency: "USD", amount: 1n })).toEqual({ ok: false, reason: "CURRENCY_LOCKED" })
  })
})
