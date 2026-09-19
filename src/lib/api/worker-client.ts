/**
 * The Next.js server's client for the Cloudflare Worker API (worker/API.md). Server-only: it reads
 * WORKER_INTERNAL_SECRET, which must never reach the browser (it is not a NEXT_PUBLIC_ variable,
 * and this module refuses to run in a browser).
 *
 * Every request is signed for exactly that request and user (src/lib/internal-auth/token.ts), has
 * a timeout, and its response is validated against the contract (src/lib/data/contract.ts) before
 * anything uses it. Worker errors come back as the same DomainError the service would have thrown.
 */
import type { z } from "zod"

import { DomainError, type ErrorCode, type FieldErrors } from "@/lib/errors"
import { UNSIGNED_REQUEST } from "@/lib/internal-auth/messages"
import { assertSecret, signApiToken } from "@/lib/internal-auth/token"

export const WORKER_TIMEOUT_MS = 15_000
export const SERVICE_UNAVAILABLE = "The service is temporarily unavailable. Please try again."
const GENERIC = "Something went wrong. Please try again."
const ERROR_CODES: ErrorCode[] = ["VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL"]

export type WorkerConfig = { baseUrl: URL; secret: string }

/** WORKER_API_URL and WORKER_INTERNAL_SECRET, checked. Throws (without echoing the secret) when misconfigured. */
export function workerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  if (typeof window !== "undefined") throw new Error("The Worker client is server-only.")
  const raw = env.WORKER_API_URL
  if (!raw) throw new Error("WORKER_API_URL is not set.")
  let baseUrl: URL
  try {
    baseUrl = new URL(raw)
  } catch {
    throw new Error("WORKER_API_URL is not a valid URL.")
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)
  if (baseUrl.protocol !== "https:" && !local) throw new Error("WORKER_API_URL must use https.")
  assertSecret(env.WORKER_INTERNAL_SECRET, "WORKER_INTERNAL_SECRET")
  return { baseUrl, secret: env.WORKER_INTERNAL_SECRET }
}

export type WorkerRequest<S extends z.ZodType> = {
  method: "GET" | "POST" | "PUT" | "PATCH"
  path: string
  /** Query parameters; undefined and empty values are left out. */
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** The signed-in user the request is made for; null only for the login lookup. */
  userId: string | null
  /** The response contract. */
  schema: S
}

function toDomainError(status: number, data: unknown, path: string): DomainError {
  const body = (data ?? {}) as { error?: unknown; code?: unknown; fieldErrors?: unknown }
  if (typeof body.error === "string" && ERROR_CODES.includes(body.code as ErrorCode)) {
    if (status === 401 && body.error === UNSIGNED_REQUEST) {
      // Not the user's fault: the Worker did not accept our signature (secret mismatch, clock skew).
      console.error(JSON.stringify({ event: "worker_rejected_signature", path }))
      return new DomainError("INTERNAL", SERVICE_UNAVAILABLE)
    }
    return new DomainError(body.code as ErrorCode, body.error, body.fieldErrors as FieldErrors | undefined)
  }
  console.error(JSON.stringify({ event: "worker_unexpected_response", path, status }))
  return new DomainError("INTERNAL", GENERIC)
}

export async function callWorker<S extends z.ZodType>(request: WorkerRequest<S>, config: WorkerConfig = workerConfig()): Promise<z.output<S>> {
  const url = new URL(request.path, config.baseUrl)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }
  const body = request.body === undefined ? null : JSON.stringify(request.body)
  const pathAndQuery = url.pathname + url.search
  const token = await signApiToken(config.secret, { userId: request.userId, request: { method: request.method, pathAndQuery, body } })

  let response: Response
  try {
    response = await fetch(url, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== null ? { "Content-Type": "application/json" } : {}) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    })
  } catch (error) {
    console.error(JSON.stringify({ event: "worker_unreachable", path: url.pathname, reason: error instanceof Error ? error.name : "unknown" }))
    throw new DomainError("INTERNAL", SERVICE_UNAVAILABLE)
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw toDomainError(response.status, data, url.pathname)

  const parsed = request.schema.safeParse(data)
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "worker_response_invalid", path: url.pathname, issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join(".")) }))
    throw new DomainError("INTERNAL", GENERIC)
  }
  return parsed.data
}

/** Sends a file to a Worker upload URL (server side, for the multipart API route). */
export async function putToWorker<S extends z.ZodType>(url: string, file: { type: string; bytes: Uint8Array }, schema: S): Promise<z.output<S>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file.bytes as BodyInit,
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS * 2),
    })
  } catch (error) {
    console.error(JSON.stringify({ event: "worker_unreachable", path: "/v1/uploads", reason: error instanceof Error ? error.name : "unknown" }))
    throw new DomainError("INTERNAL", SERVICE_UNAVAILABLE)
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw toDomainError(response.status, data, "/v1/uploads")
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new DomainError("INTERNAL", GENERIC)
  return parsed.data
}
