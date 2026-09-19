import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"

import { parseMoney } from "@/lib/money"
import { fromDecimal, sumFromDecimal, toDecimal } from "@/lib/services/decimal"
import {
  buildFeeOverviewRow,
  buildFeeSummary,
  feeAssignmentRejected,
  paymentRejected,
  toOverdueStudents,
  totalOutstandingByCurrency,
} from "@/lib/services/shared/fees"

const m = parseMoney
const due = new Date("2026-08-01T00:00:00.000Z")
const now = new Date("2026-09-19T06:00:00.000Z")
const student = { id: "s1", studentId: "SMS-2026-0001", fullName: "Rahim Uddin", enrolmentStatus: "ENROLLED" as const, programme: { code: "BSC-CS", name: "BSc" } }

describe("PostgreSQL Decimal ↔ minor units boundary", () => {
  it("converts Decimal(12, 2) values exactly", () => {
    expect(fromDecimal(new Prisma.Decimal("150000"))).toBe(15000000n)
    expect(fromDecimal(new Prisma.Decimal("150000.5"))).toBe(15000050n)
    expect(fromDecimal(new Prisma.Decimal("0.01"))).toBe(1n)
    expect(fromDecimal(new Prisma.Decimal("9999999999.99"))).toBe(999_999_999_999n)
    expect(fromDecimal(new Prisma.Decimal("0.1").plus("0.2"))).toBe(30n) // Decimal arithmetic is exact too
  })

  it("treats an empty _sum as zero", () => {
    expect(sumFromDecimal(null)).toBe(0n)
    expect(sumFromDecimal(undefined)).toBe(0n)
    expect(sumFromDecimal(new Prisma.Decimal("90000.00"))).toBe(9000000n)
  })

  it("never silently rounds a value with more than 2 decimal places", () => {
    expect(() => fromDecimal(new Prisma.Decimal("1.005"))).toThrow(RangeError)
  })

  it("round-trips to Decimal", () => {
    expect(toDecimal(15000050n).toFixed(2)).toBe("150000.50")
    expect(toDecimal(-5n).equals(new Prisma.Decimal("-0.05"))).toBe(true)
  })
})

describe("buildFeeSummary (shared by PostgreSQL and D1)", () => {
  it("reports an assigned, overdue tariff fee as before", () => {
    expect(
      buildFeeSummary({ fee: { amount: m("150000"), currency: "BDT", dueDate: due, programmeFeeId: "t1" }, totalPaid: m("90000"), tariff: { id: "t1", currency: "BDT" }, now })
    ).toEqual({
      currency: "BDT",
      totalFee: "150000.00",
      totalPaid: "90000.00",
      outstanding: "60000.00",
      dueDate: due,
      isOverdue: true,
      daysOverdue: 49,
      status: "OVERDUE",
      hasFeeAssigned: true,
      matchesTariff: true,
      source: "TARIFF",
    })
  })

  it("reports a manual fee and the no-fee state", () => {
    expect(buildFeeSummary({ fee: { amount: m("120000"), currency: "BDT", dueDate: due, programmeFeeId: null }, totalPaid: 0n, tariff: { id: "t1", currency: "BDT" }, now })).toMatchObject({
      source: "MANUAL",
      matchesTariff: false,
    })
    expect(buildFeeSummary({ fee: null, totalPaid: m("5"), tariff: null, now })).toMatchObject({
      currency: "BDT",
      totalFee: "0.00",
      totalPaid: "5.00",
      status: "NO_FEE",
      hasFeeAssigned: false,
    })
  })
})

describe("fee overview rows and totals", () => {
  it("builds rows for each fee state", () => {
    expect(buildFeeOverviewRow(student, { amount: m("150000"), currency: "BDT", dueDate: due }, m("90000"), now)).toMatchObject({
      status: "OVERDUE",
      outstanding: "60000.00",
      daysOverdue: 49,
    })
    expect(buildFeeOverviewRow(student, { amount: m("150000"), currency: "BDT", dueDate: due }, m("150000"), now)).toMatchObject({ status: "PAID", daysOverdue: 0 })
    expect(buildFeeOverviewRow(student, null, 0n, now)).toMatchObject({ status: "NO_FEE", currency: null, totalFee: "0.00" })
  })

  it("totals outstanding balances per currency, exactly", () => {
    const row = (outstanding: string, currency: string | null) => ({ ...buildFeeOverviewRow(student, null, 0n, now), outstanding, currency })
    expect(totalOutstandingByCurrency([row("60000.10", "BDT"), row("0.20", "BDT"), row("100.00", "USD"), row("5.00", null)])).toEqual([
      { currency: "BDT", amount: "60000.30" },
      { currency: "USD", amount: "100.00" },
    ])
  })

  it("lists overdue students, most overdue first", () => {
    const later = new Date("2026-09-01T00:00:00.000Z")
    const rows = toOverdueStudents(
      [
        { amount: m("1000"), currency: "BDT", dueDate: later, student: { ...student, id: "a", studentId: "SMS-2026-0002" } },
        { amount: m("1000"), currency: "BDT", dueDate: due, student: { ...student, id: "b", studentId: "SMS-2026-0003" } },
        { amount: m("1000"), currency: "BDT", dueDate: due, student: { ...student, id: "c", studentId: "SMS-2026-0004" } },
      ],
      new Map([["c", m("1000")]]),
      now
    )
    expect(rows.map((r) => [r.studentId, r.outstanding])).toEqual([
      ["SMS-2026-0003", "1000.00"],
      ["SMS-2026-0002", "1000.00"],
    ])
  })
})

describe("rule errors keep the PostgreSQL wording", () => {
  it("payments", () => {
    expect(paymentRejected({ ok: false, reason: "EXCEEDS_OUTSTANDING", outstanding: m("60000") }, "BDT").message).toBe(
      "Payment exceeds the outstanding balance of 60,000.00 BDT."
    )
    expect(paymentRejected({ ok: false, reason: "NO_FEE" }, "").message).toBe("No fee has been assigned to this student.")
    expect(paymentRejected({ ok: false, reason: "PAID_IN_FULL" }, "BDT").message).toBe("This student has already paid in full.")
  })

  it("fee assignment", () => {
    const below = feeAssignmentRejected({ ok: false, reason: "BELOW_PAID" }, "MANUAL", "BDT", m("100000.50"))
    expect([below.code, below.message]).toEqual(["VALIDATION", "Fee cannot be less than the amount already paid (100,000.50 BDT)."])
    expect(feeAssignmentRejected({ ok: false, reason: "BELOW_PAID" }, "TARIFF", "BDT", m("1")).code).toBe("CONFLICT")
    expect(feeAssignmentRejected({ ok: false, reason: "CURRENCY_LOCKED" }, "MANUAL", "USD", 0n).message).toBe(
      "The currency cannot change after payments have been recorded."
    )
  })
})
