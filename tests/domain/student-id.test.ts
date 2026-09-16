import { describe, expect, it } from "vitest"

import { formatStudentId, parseStudentIdSequence } from "@/lib/domain/student-id"

describe("formatStudentId", () => {
  it("pads the sequence to 4 digits", () => {
    expect(formatStudentId(2026, 1)).toBe("SMS-2026-0001")
  })

  it("rolls over 9 → 10 → 100", () => {
    expect(formatStudentId(2026, 9)).toBe("SMS-2026-0009")
    expect(formatStudentId(2026, 10)).toBe("SMS-2026-0010")
    expect(formatStudentId(2026, 100)).toBe("SMS-2026-0100")
  })

  it("keeps growing past 9999", () => {
    expect(formatStudentId(2026, 10000)).toBe("SMS-2026-10000")
  })

  it("rejects invalid sequences", () => {
    expect(() => formatStudentId(2026, 0)).toThrow(RangeError)
    expect(() => formatStudentId(2026, 1.5)).toThrow(RangeError)
  })
})

describe("parseStudentIdSequence", () => {
  it("round-trips", () => {
    expect(parseStudentIdSequence(formatStudentId(2026, 42))).toBe(42)
    expect(parseStudentIdSequence("SMS-2026-10000")).toBe(10000)
  })

  it("returns NaN for anything else", () => {
    expect(parseStudentIdSequence("SMS-2026-12")).toBeNaN()
    expect(parseStudentIdSequence("abc")).toBeNaN()
  })
})
