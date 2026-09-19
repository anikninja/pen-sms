import { describe, expect, it } from "vitest"

import { parseMoney } from "@/lib/money"
import { moneySchema } from "@/lib/validations/common"

const schema = moneySchema("Must be greater than zero.")
const error = (value: unknown) => {
  const result = schema.safeParse(value)
  return result.success ? null : result.error.issues[0]?.message
}

describe("moneySchema", () => {
  it("normalises to a 2-decimal string that converts exactly to minor units", () => {
    expect(schema.parse("100")).toBe("100.00")
    expect(schema.parse("100.5")).toBe("100.50")
    expect(schema.parse(" 007.10 ")).toBe("7.10")
    expect(schema.parse(120000)).toBe("120000.00")
    expect(parseMoney(schema.parse("100.50"))).toBe(10050n)
  })

  it("accepts the largest Decimal(12, 2) amount and rejects one paisa more", () => {
    expect(schema.parse("9999999999.99")).toBe("9999999999.99")
    expect(error("10000000000.00")).toBe("Amount is too large.")
    expect(error("99999999999999999999")).toBe("Amount is too large.")
  })

  it("rejects more than 2 decimal places, however small", () => {
    expect(error("10.555")).toBe("Amount can have at most 2 decimal places.")
    expect(error("0.001")).toBe("Amount can have at most 2 decimal places.")
    expect(error(0.1 + 0.2)).toBe("Amount can have at most 2 decimal places.") // 0.30000000000000004
  })

  it("rejects zero and negatives before looking at decimals (existing message order)", () => {
    expect(error("0")).toBe("Must be greater than zero.")
    expect(error("0.00")).toBe("Must be greater than zero.")
    expect(error("-0.001")).toBe("Must be greater than zero.")
    expect(error("-5.555")).toBe("Must be greater than zero.")
  })

  it("rejects values that are not plain decimals", () => {
    for (const bad of ["", "abc", "1e5", "1,000", "+5", ".5", "5.", "NaN"]) {
      expect(error(bad), bad).toBe("Enter a valid amount.")
    }
    expect(error(1e21)).toBe("Enter a valid amount.") // String(1e21) is "1e+21"
    expect(error(null)).toBe("Enter an amount.")
  })
})
