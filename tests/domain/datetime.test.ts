import { describe, expect, it } from "vitest"

import { registryDateTimeLocalToIso, toRegistryDateTimeLocal } from "@/lib/utils/datetime"

describe("toRegistryDateTimeLocal", () => {
  it("shows a UTC moment in Dhaka time", () => {
    expect(toRegistryDateTimeLocal(new Date("2026-09-30T17:59:00.000Z"))).toBe("2026-09-30T23:59")
    expect(toRegistryDateTimeLocal("2026-09-30T18:30:00.000Z")).toBe("2026-10-01T00:30")
  })
})

describe("registryDateTimeLocalToIso", () => {
  it("reads the value as Dhaka time", () => {
    const iso = registryDateTimeLocalToIso("2026-09-30T23:59")
    expect(iso).toBe("2026-09-30T23:59:00+06:00")
    expect(new Date(iso!).toISOString()).toBe("2026-09-30T17:59:00.000Z")
  })

  it("round-trips", () => {
    const moment = new Date("2026-12-31T20:15:00.000Z")
    expect(new Date(registryDateTimeLocalToIso(toRegistryDateTimeLocal(moment))!).getTime()).toBe(moment.getTime())
  })

  it.each(["", "2026-09-30", "2026-09-30 23:59", "2026-02-30T10:00", "2026-09-30T24:00"])("rejects %j", (value) => {
    expect(registryDateTimeLocalToIso(value)).toBeNull()
  })
})
