import { describe, expect, it } from "vitest"

import { Prisma } from "@prisma/client"

import { ageOn, calendarDaysPast, endOfRegistryDay, isIsoDate, isoDateToUtc, registryToday } from "@/lib/domain/dates"
import { isOverdue } from "@/lib/domain/fees"

describe("endOfRegistryDay (calendar due dates)", () => {
  const due = isoDateToUtc("2026-09-30")
  const deadline = endOfRegistryDay(due)
  const owed = new Prisma.Decimal(100)

  it("is 23:59:59.999 in Dhaka on the due date", () => {
    expect(deadline.toISOString()).toBe("2026-09-30T17:59:59.999Z")
  })

  it("is not overdue at any time on the due date in Dhaka", () => {
    expect(isOverdue(owed, deadline, new Date("2026-09-30T06:00:00+06:00"))).toBe(false)
    expect(isOverdue(owed, deadline, new Date("2026-09-30T23:59:59+06:00"))).toBe(false)
  })

  it("is overdue from the start of the next day in Dhaka", () => {
    expect(isOverdue(owed, deadline, new Date("2026-10-01T00:00:00+06:00"))).toBe(true)
  })

  it("counts calendar days past the due date in Dhaka", () => {
    expect(calendarDaysPast(due, new Date("2026-09-30T23:00:00+06:00"))).toBe(0)
    expect(calendarDaysPast(due, new Date("2026-10-01T00:00:00+06:00"))).toBe(1)
    expect(calendarDaysPast(due, new Date("2026-10-02T23:59:00+06:00"))).toBe(2)
    expect(calendarDaysPast(due, new Date("2026-09-01T12:00:00+06:00"))).toBe(0)
  })
})

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
