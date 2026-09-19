import { afterEach, describe, expect, it, vi } from "vitest"

import { dataBackend } from "@/lib/data/backend"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("dataBackend (DATA_BACKEND)", () => {
  it("uses the explicitly configured backend", () => {
    vi.stubEnv("DATA_BACKEND", "worker")
    expect(dataBackend()).toBe("worker")
    vi.stubEnv("DATA_BACKEND", "postgres")
    expect(dataBackend()).toBe("postgres")
  })

  it("defaults to PostgreSQL only outside Vercel (local development, CI)", () => {
    vi.stubEnv("DATA_BACKEND", "")
    vi.stubEnv("VERCEL", "")
    expect(dataBackend()).toBe("postgres")
  })

  it("never guesses on Vercel: an unset backend is an error, not a silent PostgreSQL fallback", () => {
    vi.stubEnv("DATA_BACKEND", "")
    vi.stubEnv("VERCEL", "1")
    expect(() => dataBackend()).toThrow("DATA_BACKEND is not set")
  })

  it("rejects unknown values", () => {
    vi.stubEnv("DATA_BACKEND", "d1")
    expect(() => dataBackend()).toThrow('DATA_BACKEND must be "worker" or "postgres"')
  })
})
