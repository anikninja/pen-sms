import { describe, expect, it } from "vitest"

import { ageOn, isIsoDate, registryToday } from "@/lib/domain/dates"

describe("registryToday", () => {
  it("uses the Dhaka calendar date, not UTC", () => {
    // 20:00 UTC on 16 Sep is 02:00 on 17 Sep in Dhaka (UTC+6).
    expect(registryToday(new Date("2026-09-16T20:00:00.000Z"))).toBe("2026-09-17")
    expect(registryToday(new Date("2026-09-16T10:00:00.000Z"))).toBe("2026-09-16")
  })
})

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2024-02-29")).toBe(true)
    expect(isIsoDate("2026-02-29")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate("16/09/2026")).toBe(false)
  })
})

describe("ageOn", () => {
  it("counts completed years", () => {
    expect(ageOn("2011-09-16", "2026-09-16")).toBe(15)
    expect(ageOn("2011-09-17", "2026-09-16")).toBe(14)
    expect(ageOn("2000-01-01", "2026-09-16")).toBe(26)
  })
})
