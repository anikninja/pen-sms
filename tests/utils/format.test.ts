import { describe, expect, it } from "vitest"

import { formatCurrency } from "@/lib/utils/format"

describe("formatCurrency", () => {
  it("shows DTO money strings as before (en-US grouping, 2 decimals)", () => {
    expect(formatCurrency("150000.00", "BDT")).toBe("150,000.00 BDT")
    expect(formatCurrency("60000.00", "BDT")).toBe("60,000.00 BDT")
    expect(formatCurrency("100000.50", "BDT")).toBe("100,000.50 BDT")
    expect(formatCurrency("0.00", "BDT")).toBe("0.00 BDT")
    expect(formatCurrency("999.5", "USD")).toBe("999.50 USD")
  })

  it("is identical to the previous Intl.NumberFormat output", () => {
    const previous = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    for (const value of ["0.01", "1.00", "49999.50", "435000.00", "1234567.89", "9999999999.99"]) {
      expect(formatCurrency(value, "BDT")).toBe(`${previous.format(Number(value))} BDT`)
    }
  })

  it("formats totals beyond a single amount's range exactly", () => {
    expect(formatCurrency("123456789012345.67", "BDT")).toBe("123,456,789,012,345.67 BDT")
  })

  it("refuses values that are not money strings instead of printing NaN", () => {
    expect(() => formatCurrency("abc", "BDT")).toThrow(RangeError)
  })
})
