import { describe, expect, it } from "vitest"

import {
  formatMoney,
  formatMoneyGrouped,
  isAmountInRange,
  isNonPositive,
  MAX_AMOUNT_MINOR,
  parseDecimalParts,
  parseMoney,
  sumMoney,
} from "@/lib/money"

describe("parseMoney (decimal string → minor units)", () => {
  it("converts exactly", () => {
    expect(parseMoney("100.00")).toBe(10000n)
    expect(parseMoney("100.50")).toBe(10050n)
    expect(parseMoney("100.5")).toBe(10050n)
    expect(parseMoney("100")).toBe(10000n)
    expect(parseMoney("0.01")).toBe(1n)
    expect(parseMoney("007.10")).toBe(710n)
  })

  it("handles zero", () => {
    expect(parseMoney("0")).toBe(0n)
    expect(parseMoney("0.00")).toBe(0n)
    expect(parseMoney("-0.00")).toBe(0n)
  })

  it("handles negatives (balances, never input)", () => {
    expect(parseMoney("-0.05")).toBe(-5n)
    expect(parseMoney("-150000.00")).toBe(-15000000n)
  })

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in minor units it is.
    expect(parseMoney("0.10") + parseMoney("0.20")).toBe(parseMoney("0.30"))
    expect(parseMoney("9999999999.99")).toBe(999_999_999_999n)
    // Beyond Number.MAX_SAFE_INTEGER — still exact (sums are not range-limited).
    expect(parseMoney("123456789012345678.91")).toBe(12345678901234567891n)
  })

  it("rejects more than 2 decimal places", () => {
    expect(() => parseMoney("10.555")).toThrow(RangeError)
    expect(() => parseMoney("0.001")).toThrow(RangeError)
  })

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", " ", "abc", "1e5", "1,000.00", "+5", "5.", ".5", "--1", "1.2.3", "NaN", "Infinity", " 5"]) {
      expect(() => parseMoney(bad), bad).toThrow(RangeError)
    }
  })
})

describe("formatMoney (minor units → decimal string)", () => {
  it("formats with exactly 2 decimals", () => {
    expect(formatMoney(10050n)).toBe("100.50")
    expect(formatMoney(10000n)).toBe("100.00")
    expect(formatMoney(5n)).toBe("0.05")
    expect(formatMoney(0n)).toBe("0.00")
    expect(formatMoney(-5n)).toBe("-0.05")
    expect(formatMoney(-15000000n)).toBe("-150000.00")
  })

  it("round-trips every boundary value", () => {
    for (const value of ["0.00", "0.01", "0.99", "1.00", "59999.70", "9999999999.99", "-0.01"]) {
      expect(formatMoney(parseMoney(value))).toBe(value)
    }
    expect(formatMoney(MAX_AMOUNT_MINOR)).toBe("9999999999.99")
  })
})

describe("formatMoneyGrouped", () => {
  it("adds en-US thousands separators", () => {
    expect(formatMoneyGrouped(15000000n)).toBe("150,000.00")
    expect(formatMoneyGrouped(6000000n)).toBe("60,000.00")
    expect(formatMoneyGrouped(99999n)).toBe("999.99")
    expect(formatMoneyGrouped(100000n)).toBe("1,000.00")
    expect(formatMoneyGrouped(0n)).toBe("0.00")
    expect(formatMoneyGrouped(-123456789n)).toBe("-1,234,567.89")
    expect(formatMoneyGrouped(MAX_AMOUNT_MINOR)).toBe("9,999,999,999.99")
  })

  it("matches Intl en-US grouping for representative values", () => {
    const intl = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    for (const value of ["0.05", "1.00", "999.99", "1000.00", "150000.00", "60000.01", "1234567.89"]) {
      expect(formatMoneyGrouped(parseMoney(value))).toBe(intl.format(Number(value)))
    }
  })
})

describe("range and helpers", () => {
  it("accepts exactly the Decimal(12, 2) range", () => {
    expect(isAmountInRange(MAX_AMOUNT_MINOR)).toBe(true)
    expect(isAmountInRange(MAX_AMOUNT_MINOR + 1n)).toBe(false)
    expect(isAmountInRange(-MAX_AMOUNT_MINOR)).toBe(true)
    expect(isAmountInRange(-MAX_AMOUNT_MINOR - 1n)).toBe(false)
  })

  it("keeps the largest amount a safe JavaScript integer (D1 binds Int64 as Number)", () => {
    expect(MAX_AMOUNT_MINOR <= BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it("sums exactly", () => {
    expect(sumMoney([])).toBe(0n)
    expect(sumMoney([110n, 220n])).toBe(330n)
  })

  it("decides sign on the digits, without floats", () => {
    expect(isNonPositive(parseDecimalParts("0")!)).toBe(true)
    expect(isNonPositive(parseDecimalParts("-0.00")!)).toBe(true)
    expect(isNonPositive(parseDecimalParts("0.000")!)).toBe(true)
    expect(isNonPositive(parseDecimalParts("-5")!)).toBe(true)
    expect(isNonPositive(parseDecimalParts("0.001")!)).toBe(false)
    expect(isNonPositive(parseDecimalParts("10")!)).toBe(false)
  })
})
