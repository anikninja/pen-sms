import { DomainError, ERROR_STATUS, toDomainError } from "@/lib/errors"

/** JSON request bodies larger than this are refused before parsing (file uploads have their own limit). */
export const MAX_JSON_BODY_BYTES = 256 * 1024

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  // A bigint in a response is a bug (money leaves as decimal strings); JSON.stringify throws on it,
  // which ends up as a 500 through errorResponse().
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...headers },
  })
}

/**
 * The error shape of every endpoint: { error, code, fieldErrors? } — the same `error`/`fieldErrors`
 * as the Next.js JSON API, plus the code so the Next.js client can rebuild the DomainError.
 * Unknown errors are logged and become a generic 500: no SQL, stack traces or internals leave.
 */
export function errorResponse(error: unknown, headers: HeadersInit = {}): Response {
  const domainError = toDomainError(error)
  return json(
    {
      error: domainError.message,
      code: domainError.code,
      ...(domainError.fieldErrors ? { fieldErrors: domainError.fieldErrors } : {}),
    },
    ERROR_STATUS[domainError.code],
    headers
  )
}

export function payloadTooLarge(): Response {
  return json({ error: "Request body is too large.", code: "VALIDATION" }, 413)
}

export function parseJsonBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new DomainError("VALIDATION", "Request body must be valid JSON.")
  }
}
