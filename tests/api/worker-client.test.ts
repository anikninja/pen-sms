import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { callWorker, SERVICE_UNAVAILABLE, workerConfig, type WorkerConfig } from "@/lib/api/worker-client"
import { DomainError } from "@/lib/errors"
import { UNSIGNED_REQUEST } from "@/lib/internal-auth/messages"
import { verifyApiToken } from "@/lib/internal-auth/token"

const SECRET = "client-test-secret-0123456789-abcdefghijklmn"
const config: WorkerConfig = { baseUrl: new URL("https://sms-api.example"), secret: SECRET }
const USER = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b"

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit]
  return { url: new URL(url), init, headers: init.headers as Record<string, string> }
}

describe("workerConfig", () => {
  it("requires an https URL (http only for localhost) and a long secret, never echoing it", () => {
    expect(() => workerConfig({})).toThrow("WORKER_API_URL is not set.")
    expect(() => workerConfig({ WORKER_API_URL: "not a url", WORKER_INTERNAL_SECRET: SECRET })).toThrow("not a valid URL")
    expect(() => workerConfig({ WORKER_API_URL: "http://sms-api.example", WORKER_INTERNAL_SECRET: SECRET })).toThrow("must use https")
    expect(workerConfig({ WORKER_API_URL: "http://127.0.0.1:8787", WORKER_INTERNAL_SECRET: SECRET }).baseUrl.host).toBe("127.0.0.1:8787")
    try {
      workerConfig({ WORKER_API_URL: "https://sms-api.example", WORKER_INTERNAL_SECRET: "tiny-secret" })
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toContain("WORKER_INTERNAL_SECRET")
      expect(String(error)).not.toContain("tiny-secret")
    }
  })
})

describe("callWorker", () => {
  it("signs exactly the request it sends, for the given user", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    await callWorker(
      { method: "POST", path: "/v1/students", query: { dry: "1", skip: undefined, empty: "" }, body: { fullName: "A" }, userId: USER, schema: z.object({ ok: z.boolean() }) },
      config
    )
    const { url, init, headers } = lastRequest()
    expect(url.toString()).toBe("https://sms-api.example/v1/students?dry=1")
    expect(init).toMatchObject({ method: "POST", body: '{"fullName":"A"}', cache: "no-store" })
    expect(headers["Content-Type"]).toBe("application/json")

    const token = headers.Authorization.replace("Bearer ", "")
    const verified = await verifyApiToken([SECRET], token, { method: "POST", pathAndQuery: "/v1/students?dry=1", body: '{"fullName":"A"}' })
    expect(verified).toMatchObject({ ok: true, claims: { sub: USER } })
  })

  it("validates the response and revives dates", async () => {
    fetchMock.mockResolvedValue(reply(200, { at: "2026-09-19T06:00:00.000Z" }))
    const result = await callWorker({ method: "GET", path: "/v1/x", userId: USER, schema: z.object({ at: z.coerce.date() }) }, config)
    expect(result.at).toBeInstanceOf(Date)
    expect(result.at.toISOString()).toBe("2026-09-19T06:00:00.000Z")
  })

  it("rebuilds the Worker's DomainError, field errors included", async () => {
    fetchMock.mockResolvedValue(reply(409, { error: "A student with this email already exists.", code: "CONFLICT", fieldErrors: { email: ["x"] } }))
    const error = await callWorker({ method: "POST", path: "/v1/students", userId: USER, schema: z.unknown() }, config).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: "CONFLICT", message: "A student with this email already exists.", fieldErrors: { email: ["x"] } })
  })

  it("keeps a signed-out user (401 Please sign in.) as UNAUTHORIZED", async () => {
    fetchMock.mockResolvedValue(reply(401, { error: "Please sign in.", code: "UNAUTHORIZED" }))
    await expect(callWorker({ method: "GET", path: "/v1/session", userId: USER, schema: z.unknown() }, config)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("treats a rejected signature as a configuration problem, not as signed out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(reply(401, { error: UNSIGNED_REQUEST, code: "UNAUTHORIZED" }))
    await expect(callWorker({ method: "GET", path: "/v1/session", userId: USER, schema: z.unknown() }, config)).rejects.toMatchObject({
      code: "INTERNAL",
      message: SERVICE_UNAVAILABLE,
    })
    expect(log).toHaveBeenCalled()
  })

  it("maps network failures, timeouts and unexpected bodies to safe INTERNAL errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(callWorker({ method: "GET", path: "/v1/x", userId: USER, schema: z.unknown() }, config)).rejects.toMatchObject({ code: "INTERNAL", message: SERVICE_UNAVAILABLE })

    fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
    await expect(callWorker({ method: "GET", path: "/v1/x", userId: USER, schema: z.unknown() }, config)).rejects.toMatchObject({ code: "INTERNAL" })

    fetchMock.mockResolvedValue(reply(200, { unexpected: true }))
    await expect(callWorker({ method: "GET", path: "/v1/x", userId: USER, schema: z.object({ id: z.string() }) }, config)).rejects.toMatchObject({ code: "INTERNAL" })
    expect(log).toHaveBeenCalledTimes(3)
  })

  it("gives every request a timeout", async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    await callWorker({ method: "GET", path: "/v1/x", userId: USER, schema: z.unknown() }, config)
    expect(lastRequest().init.signal).toBeInstanceOf(AbortSignal)
  })
})
