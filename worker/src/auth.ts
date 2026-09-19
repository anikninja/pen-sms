/**
 * The Worker's trust boundary (API.md, "Authentication").
 *
 * 1. Every non-public request must carry an internal token signed by the Next.js server
 *    (`Authorization: Bearer v1.…`), valid for this exact request. Without it: 401.
 * 2. The token names at most a user id. Role and student link are read from D1 here, on every
 *    request, so nothing the caller claims about permissions is trusted.
 * 3. Role checks use the same messages as the Next.js guards (src/lib/auth/guards.ts).
 */
import type { Session } from "@/lib/auth/session-types"
import { DomainError } from "@/lib/errors"
import { verifyApiToken, type ApiTokenClaims } from "@/lib/internal-auth/token"
import type { D1Client } from "@/lib/services/d1/client"

import type { Env } from "./env"
import type { Access } from "./router"

/** The configured secrets (current, then previous during a rotation); none if misconfigured. */
export function internalSecrets(env: Env): string[] {
  return [env.WORKER_INTERNAL_SECRET, env.WORKER_INTERNAL_SECRET_PREVIOUS].filter(
    (secret): secret is string => typeof secret === "string" && secret.length >= 32
  )
}

export class MisconfiguredError extends Error {
  constructor() {
    super("WORKER_INTERNAL_SECRET is not set (or shorter than 32 characters).")
    this.name = "MisconfiguredError"
  }
}

/** Verifies the internal token for this request. Throws UNAUTHORIZED (401) when it is missing or invalid. */
export async function verifyRequest(request: Request, url: URL, body: Uint8Array, env: Env, now: Date): Promise<ApiTokenClaims> {
  const secrets = internalSecrets(env)
  if (secrets.length === 0) throw new MisconfiguredError()

  const header = request.headers.get("Authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null
  const result = await verifyApiToken(secrets, token, { method: request.method, pathAndQuery: url.pathname + url.search, body }, now)
  if (!result.ok) {
    // The reason is logged for operators; the caller only learns that the request was not accepted.
    console.warn(JSON.stringify({ event: "internal_token_rejected", reason: result.reason, method: request.method, path: url.pathname }))
    throw new DomainError("UNAUTHORIZED", "The request is not signed by the application.")
  }
  return result.claims
}

/** Loads the signed-in user from D1 and applies the route's role rule. */
export async function authorize(db: D1Client, claims: ApiTokenClaims, access: Exclude<Access, "public" | "service">): Promise<Session> {
  const user = claims.sub
    ? await db.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, name: true, email: true, role: true, studentId: true },
      })
    : null
  // A deleted account is signed out immediately, whatever the token says.
  if (!user) throw new DomainError("UNAUTHORIZED", "Please sign in.")

  const session: Session = { userId: user.id, name: user.name, email: user.email, role: user.role, studentId: user.studentId }
  if (access === "staff" && session.role !== "STAFF") {
    throw new DomainError("FORBIDDEN", "Only Registry staff can do this.")
  }
  if (access === "student" && (session.role !== "STUDENT" || !session.studentId)) {
    throw new DomainError("FORBIDDEN", "Only students can do this.")
  }
  return session
}
