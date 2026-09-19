import { describe, expect, it } from "vitest"

import {
  API_TOKEN_TTL_SECONDS,
  assertSecret,
  base64UrlDecode,
  base64UrlEncode,
  signApiToken,
  signFileToken,
  verifyApiToken,
  verifyFileToken,
  type BoundRequest,
} from "@/lib/internal-auth/token"

const SECRET = "unit-test-secret-0123456789-abcdefghijklmnopqrstuv"
const OLD_SECRET = "previous-secret-0123456789-abcdefghijklmnopqrstu"
const USER = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b"
const NOW = new Date("2026-09-19T10:00:00.000Z")
const request: BoundRequest = { method: "POST", pathAndQuery: "/v1/students/x/payments?dry=1", body: '{"amount":"100.00"}' }

const sign = (overrides: Partial<Parameters<typeof signApiToken>[1]> = {}, secret = SECRET) =>
  signApiToken(secret, { userId: USER, request, now: NOW, ...overrides })

describe("API tokens (Next.js server → Worker)", () => {
  it("verifies a token for exactly the request it was signed for", async () => {
    const result = await verifyApiToken([SECRET], await sign(), request, NOW)
    expect(result).toMatchObject({ ok: true, claims: { sub: USER, typ: "api", htm: "POST", htu: request.pathAndQuery } })
  })

  it("carries no role, student id or other permissions", async () => {
    const result = await verifyApiToken([SECRET], await sign(), request, NOW)
    expect(result.ok && Object.keys(result.claims).sort()).toEqual(["aud", "bh", "exp", "htm", "htu", "iat", "iss", "jti", "sub", "typ"])
  })

  it("supports service calls without a user", async () => {
    const result = await verifyApiToken([SECRET], await sign({ userId: null }), request, NOW)
    expect(result).toMatchObject({ ok: true, claims: { sub: null } })
  })

  it("rejects the token for any other method, path, query or body", async () => {
    const token = await sign()
    for (const other of [
      { ...request, method: "PUT" },
      { ...request, pathAndQuery: "/v1/students/y/payments?dry=1" },
      { ...request, pathAndQuery: "/v1/students/x/payments" },
      { ...request, body: '{"amount":"100000.00"}' },
      { ...request, body: null },
    ]) {
      expect(await verifyApiToken([SECRET], token, other, NOW)).toEqual({ ok: false, reason: "REQUEST_MISMATCH" })
    }
  })

  it("expires after 60 seconds (plus 30 seconds of clock skew)", async () => {
    const token = await sign()
    const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)
    expect((await verifyApiToken([SECRET], token, request, at(API_TOKEN_TTL_SECONDS + 30))).ok).toBe(true)
    expect(await verifyApiToken([SECRET], token, request, at(API_TOKEN_TTL_SECONDS + 31))).toEqual({ ok: false, reason: "EXPIRED" })
    expect(await verifyApiToken([SECRET], token, request, at(-31))).toEqual({ ok: false, reason: "NOT_YET_VALID" })
  })

  it("refuses tokens that claim a longer lifetime, even when correctly signed", async () => {
    const token = await sign({ ttlSeconds: 3600 })
    expect(await verifyApiToken([SECRET], token, request, NOW)).toEqual({ ok: false, reason: "LIFETIME_TOO_LONG" })
  })

  it("rejects other secrets, tampering and garbage", async () => {
    expect(await verifyApiToken([SECRET], await sign({}, OLD_SECRET), request, NOW)).toEqual({ ok: false, reason: "BAD_SIGNATURE" })

    const [version, payload, signature] = (await sign()).split(".")
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)!))
    const elevated = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...claims, sub: "someone-else" })))
    expect(await verifyApiToken([SECRET], `${version}.${elevated}.${signature}`, request, NOW)).toEqual({ ok: false, reason: "BAD_SIGNATURE" })

    for (const token of ["", "a.b", "v2.a.b", "v1.!!!.???", "v1.e30", "x".repeat(5000)]) {
      const result = await verifyApiToken([SECRET], token, request, NOW)
      expect(result.ok).toBe(false)
    }
    expect(await verifyApiToken([SECRET], null, request, NOW)).toEqual({ ok: false, reason: "MISSING" })
  })

  it("accepts the previous secret while the secret is rotated", async () => {
    const result = await verifyApiToken([SECRET, OLD_SECRET], await sign({}, OLD_SECRET), request, NOW)
    expect(result.ok).toBe(true)
  })
})

describe("file tokens (Worker → browser)", () => {
  const upload = { typ: "upload" as const, sub: USER, sid: "s1", aid: "a1", name: "Essay.pdf", type: "application/pdf", size: 1024 }

  it("round-trips upload and download claims with their own lifetimes", async () => {
    const { token, expiresAt } = await signFileToken(SECRET, upload, NOW)
    expect(expiresAt.toISOString()).toBe("2026-09-19T10:05:00.000Z")
    expect(await verifyFileToken([SECRET], token, "upload", NOW)).toMatchObject({ ok: true, claims: upload })

    const download = await signFileToken(SECRET, { typ: "download", sub: USER, fid: "f1", key: "k" }, NOW)
    expect(download.expiresAt.toISOString()).toBe("2026-09-19T10:01:00.000Z")
    expect(await verifyFileToken([SECRET], download.token, "download", new Date(NOW.getTime() + 91_000))).toEqual({ ok: false, reason: "EXPIRED" })
  })

  it("never accepts one token kind as another", async () => {
    const { token } = await signFileToken(SECRET, upload, NOW)
    expect(await verifyFileToken([SECRET], token, "download", NOW)).toEqual({ ok: false, reason: "WRONG_AUDIENCE" })
    // Different derived keys: a file token is not even a validly signed API token, and vice versa.
    expect(await verifyApiToken([SECRET], token, request, NOW)).toEqual({ ok: false, reason: "BAD_SIGNATURE" })
    expect(await verifyFileToken([SECRET], await sign(), "upload", NOW)).toEqual({ ok: false, reason: "BAD_SIGNATURE" })
  })
})

describe("assertSecret", () => {
  it("requires at least 32 characters and never echoes the value", () => {
    expect(() => assertSecret(undefined, "WORKER_INTERNAL_SECRET")).toThrow("WORKER_INTERNAL_SECRET must be set")
    try {
      assertSecret("short-secret", "WORKER_INTERNAL_SECRET")
    } catch (error) {
      expect(String(error)).not.toContain("short-secret")
    }
    expect(() => assertSecret(SECRET, "X")).not.toThrow()
  })
})
