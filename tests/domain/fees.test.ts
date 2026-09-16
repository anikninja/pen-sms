import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"

import {
  calculateOutstanding,
  daysOverdue,
  feeStatus,
  isOverdue,
  isValidFeeAmount,
  sumPayments,
} from "@/lib/domain/fees"

const d = (value: string | number) => new Prisma.Decimal(value)

describe("calculateOutstanding", () => {
  it("equals the fee when there are no payments", () => {
    expect(calculateOutstanding(d("150000.00"), []).toFixed(2)).toBe("150000.00")
  })

  it("subtracts partial payments exactly (no float drift)", () => {
    expect(calculateOutstanding(d("150000.00"), [d("50000.10"), d("40000.20")]).toFixed(2)).toBe("59999.70")
    expect(calculateOutstanding(d("0.30"), [d("0.10"), d("0.20")]).toFixed(2)).toBe("0.00")
  })

  it("is zero when paid exactly", () => {
    expect(calculateOutstanding(d("250000"), [d("250000")]).isZero()).toBe(true)
  })

  it("never goes below zero on overpayment", () => {
    expect(calculateOutstanding(d("100"), [d("150")]).toFixed(2)).toBe("0.00")
  })
})

describe("isOverdue", () => {
  const due = new Date("2026-06-30T00:00:00.000Z")
  const before = new Date("2026-06-29T12:00:00.000Z")
  const after = new Date("2026-07-01T00:00:00.000Z")

  it("is false when nothing is outstanding, even past due", () => {
    expect(isOverdue(d(0), due, after)).toBe(false)
  })

  it("is false when outstanding but not yet due", () => {
    expect(isOverdue(d(100), due, before)).toBe(false)
  })

  it("is true when outstanding and past due", () => {
    expect(isOverdue(d(100), due, after)).toBe(true)
  })

  it("is false exactly at the due date (strictly greater)", () => {
    expect(isOverdue(d(100), due, new Date(due))).toBe(false)
  })

  it("is false without a due date", () => {
    expect(isOverdue(d(100), null, after)).toBe(false)
  })
})

describe("isValidFeeAmount", () => {
  it("rejects zero", () => expect(isValidFeeAmount(d(0), d(0))).toBe(false))
  it("rejects an amount below what was paid", () => expect(isValidFeeAmount(d(80000), d(90000))).toBe(false))
  it("accepts an amount equal to what was paid", () => expect(isValidFeeAmount(d(90000), d(90000))).toBe(true))
  it("accepts an amount above what was paid", () => expect(isValidFeeAmount(d(150000), d(90000))).toBe(true))
})

describe("feeStatus and helpers", () => {
  const due = new Date("2026-06-30T00:00:00.000Z")
  const after = new Date("2026-07-03T06:00:00.000Z")

  it("classifies each state", () => {
    expect(feeStatus(false, d(0), null, after)).toBe("NO_FEE")
    expect(feeStatus(true, d(0), due, after)).toBe("PAID")
    expect(feeStatus(true, d(10), due, after)).toBe("OVERDUE")
    expect(feeStatus(true, d(10), due, new Date("2026-06-01"))).toBe("OUTSTANDING")
  })

  it("counts whole days overdue", () => {
    expect(daysOverdue(due, after)).toBe(3)
    expect(daysOverdue(due, new Date("2026-06-01"))).toBe(0)
  })

  it("sums payments", () => {
    expect(sumPayments([d("1.10"), d("2.20")]).toFixed(2)).toBe("3.30")
  })
})
