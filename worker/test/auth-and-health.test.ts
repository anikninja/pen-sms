import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { signApiToken } from "@/lib/internal-auth/token"

import { STAFF_EMAIL, startTestWorker, TEST_SECRET, type TestWorker } from "./harness"

let w: TestWorker
let staffId: string
let rahimId: string

beforeAll(async () => {
  w = await startTestWorker({ seed: true })
  staffId = w.users.get(STAFF_EMAIL)!.id
  rahimId = w.users.get("rahim.uddin@student.pensms.test")!.id
})
afterAll(async () => {
  await w?.dispose()
})

describe("GET /health", () => {
  it("reports the Worker, D1 and the migrated schema without any secrets or data", async () => {
    const { status, data, headers } = await w.call("GET", "/health")
    expect(status).toBe(200)
    expect(data).toMatchObject({ status: "ok", d1: "ok", schema: { ok: true, missingTables: [], latestMigration: "0001_baseline.sql" } })
    expect(Object.keys(data).sort()).toEqual(["d1", "schema", "status", "time"])
    expect(JSON.stringify(data)).not.toContain(TEST_SECRET)
    expect(headers.get("cache-control")).toBe("no-store")
  })

  it("needs no token", async () => {
    expect((await w.fetch("/health")).status).toBe(200)
  })
})

describe("HTTPS only", () => {
  it("refuses plain HTTP to a public hostname, before any other check", async () => {
    const token = await signApiToken(TEST_SECRET, {
      userId: staffId,
      request: { method: "GET", pathAndQuery: "/v1/students", body: null },
    })
    const signed = await w.fetch("http://sms-api.test/v1/students", { headers: { Authorization: `Bearer ${token}` } })
    expect(signed.status).toBe(403)
    expect(await signed.json()).toEqual({ error: "HTTPS is required.", code: "FORBIDDEN" })
    expect(signed.headers.get("cache-control")).toBe("no-store")

    for (const [path, method] of [["/health", "GET"], ["/v1/uploads", "OPTIONS"], ["/v1/files/download", "GET"]] as const) {
      expect((await w.fetch(`http://sms-api.test${path}`, { method })).status).toBe(403)
    }
  })

  it("allows plain HTTP on localhost for local development", async () => {
    for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
      expect((await w.fetch(`${origin}/health`)).status).toBe(200)
    }
  })
})

describe("internal token (trust boundary)", () => {
  it("rejects a request without a token", async () => {
    const { status, data } = await w.call("GET", "/v1/students")
    expect(status).toBe(401)
    expect(data).toEqual({ error: "The request is not signed by the application.", code: "UNAUTHORIZED" })
  })

  it("rejects malformed and forged tokens", async () => {
    for (const token of ["garbage", "v1.e30.AAAA", "v2.a.b"]) {
      expect((await w.call("GET", "/v1/students", { token })).status).toBe(401)
    }
    const forged = await signApiToken("another-secret-of-sufficient-length-123456", {
      userId: staffId,
      request: { method: "GET", pathAndQuery: "/v1/students", body: null },
    })
    expect((await w.call("GET", "/v1/students", { token: forged })).status).toBe(401)
  })

  it("rejects an expired token", async () => {
    const token = await signApiToken(TEST_SECRET, {
      userId: staffId,
      request: { method: "GET", pathAndQuery: "/v1/students", body: null },
      now: new Date(Date.now() - 5 * 60 * 1000),
    })
    expect((await w.call("GET", "/v1/students", { token })).status).toBe(401)
  })

  it("rejects a token replayed on another path, method or body", async () => {
    const token = await signApiToken(TEST_SECRET, {
      userId: staffId,
      request: { method: "GET", pathAndQuery: "/v1/students?q=a", body: null },
    })
    expect((await w.call("GET", "/v1/students?q=a", { token })).status).toBe(200)
    expect((await w.call("GET", "/v1/students?q=b", { token })).status).toBe(401)
    expect((await w.call("GET", "/v1/programmes", { token })).status).toBe(401)

    const post = await signApiToken(TEST_SECRET, {
      userId: staffId,
      request: { method: "POST", pathAndQuery: "/v1/students", body: JSON.stringify({ fullName: "A" }) },
    })
    const tampered = await w.call("POST", "/v1/students", { token: post, body: { fullName: "B" } })
    expect(tampered.status).toBe(401)
  })

  it("requires a signed-in user on user routes", async () => {
    const { status, data } = await w.call("GET", "/v1/session", { as: null })
    expect(status).toBe(401)
    expect(data.error).toBe("Please sign in.")
    expect((await w.call("GET", "/v1/session", { as: crypto.randomUUID() })).status).toBe(401) // deleted/unknown account
  })

  it("reads the role from D1, never from the request", async () => {
    const { status, data } = await w.call("GET", "/v1/session", { as: rahimId })
    expect(status).toBe(200)
    expect(data.session).toMatchObject({ userId: rahimId, role: "STUDENT", email: "rahim.uddin@student.pensms.test" })
    expect(data.session.studentId).toEqual(expect.any(String))

    // Headers claiming another identity or role are ignored.
    const spoofed = await w.call("GET", "/v1/students", {
      as: rahimId,
      headers: { "x-user-id": staffId, "x-role": "STAFF", "x-student-id": "" },
    })
    expect(spoofed.status).toBe(403)
  })

  it("applies the same role rules and messages as the Next.js guards", async () => {
    const student = await w.call("GET", "/v1/students", { as: rahimId })
    expect(student).toMatchObject({ status: 403, data: { error: "Only Registry staff can do this.", code: "FORBIDDEN" } })
    const staff = await w.call("GET", "/v1/me/marksheet", { as: staffId })
    expect(staff).toMatchObject({ status: 403, data: { error: "Only students can do this.", code: "FORBIDDEN" } })
    expect((await w.call("GET", "/v1/students", { as: staffId })).status).toBe(200)
    expect((await w.call("GET", "/v1/me/marksheet", { as: rahimId })).status).toBe(200)
  })

  it("rejects a user token on the login lookup's body when signed for a different email", async () => {
    const token = await signApiToken(TEST_SECRET, {
      userId: null,
      request: { method: "POST", pathAndQuery: "/v1/auth/lookup", body: JSON.stringify({ email: "a@x.test" }) },
    })
    expect((await w.call("POST", "/v1/auth/lookup", { token, body: { email: STAFF_EMAIL } })).status).toBe(401)
  })
})

describe("POST /v1/auth/lookup (service)", () => {
  it("returns the account with its password hash for the Next.js server to compare", async () => {
    const { status, data } = await w.call("POST", "/v1/auth/lookup", { as: null, body: { email: " Registry@PENSMS.test " } })
    expect(status).toBe(200)
    expect(data.user).toMatchObject({ id: staffId, email: STAFF_EMAIL, role: "STAFF", studentId: null })
    expect(data.user.passwordHash).toMatch(/^[$]2[aby][$]10[$]/)
  })

  it("returns null for an unknown email and 400 for an invalid one", async () => {
    expect((await w.call("POST", "/v1/auth/lookup", { as: null, body: { email: "nobody@pensms.test" } })).data).toEqual({ user: null })
    const invalid = await w.call("POST", "/v1/auth/lookup", { as: null, body: { email: "nope" } })
    expect(invalid.status).toBe(400)
    expect(invalid.data.fieldErrors.email).toBeDefined()
  })

  it("is unreachable without a valid token", async () => {
    expect((await w.call("POST", "/v1/auth/lookup", { body: { email: STAFF_EMAIL } })).status).toBe(401)
  })
})

describe("request handling", () => {
  it("returns JSON 404 and 405 for unknown routes and methods", async () => {
    expect(await w.call("GET", "/v1/nope", { as: staffId })).toMatchObject({ status: 404, data: { code: "NOT_FOUND" } })
    const wrongMethod = await w.call("DELETE", "/v1/students", { as: staffId })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get("allow")).toBe("GET, POST")
  })

  it("rejects invalid JSON and oversized bodies", async () => {
    expect(await w.call("POST", "/v1/students", { as: staffId, rawBody: "{not json" })).toMatchObject({
      status: 400,
      data: { error: "Request body must be valid JSON.", code: "VALIDATION" },
    })
    const big = await w.call("POST", "/v1/students", { as: staffId, rawBody: JSON.stringify({ fullName: "x".repeat(300 * 1024) }) })
    expect(big.status).toBe(413)
  })
})

describe("misconfiguration and database failures", () => {
  it("refuses every signed route when the secret is missing, without revealing why", async () => {
    const unconfigured = await startTestWorker({ secret: null })
    try {
      const { status, data } = await unconfigured.call("GET", "/v1/students", { as: crypto.randomUUID() })
      expect(status).toBe(500)
      expect(data).toEqual({ error: "The service is not configured.", code: "INTERNAL" })
      expect((await unconfigured.call("GET", "/health")).status).toBe(200) // health still answers
    } finally {
      await unconfigured.dispose()
    }
  })

  it("turns database errors into a generic 500 without SQL or internals", async () => {
    const empty = await startTestWorker({ migrate: false })
    try {
      const health = await empty.call("GET", "/health")
      expect(health.status).toBe(503)
      expect(health.data.status).toBe("degraded")

      // No User table: the session lookup itself fails inside D1.
      const { status, data } = await empty.call("GET", "/v1/students", { as: crypto.randomUUID() })
      expect(status).toBe(500)
      expect(data).toEqual({ error: "Something went wrong. Please try again.", code: "INTERNAL" })
      expect(JSON.stringify(data)).not.toMatch(/SELECT|no such table|sqlite|prisma/i)
    } finally {
      await empty.dispose()
    }
  })
})
