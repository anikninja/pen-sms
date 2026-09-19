/**
 * A small path router: "/v1/students/:id" style patterns, exact segment matches, no wildcards.
 * Every route declares who may call it; see app.ts for how each access level is enforced.
 */
import type { D1Client } from "@/lib/services/d1/client"
import type { Session } from "@/lib/auth/session-types"

import type { Env } from "./env"

export type Access =
  /** Anyone; no token (health check only). */
  | "public"
  /** A valid internal token, with or without a user (the login lookup happens before sign-in). */
  | "service"
  /** A valid internal token for an existing user of any role. */
  | "user"
  | "staff"
  | "student"

export type RouteContext = {
  request: Request
  env: Env
  url: URL
  params: Record<string, string>
  /** Query string as a plain object (last value wins, like the Next.js API routes). */
  query: Record<string, string>
  /** The raw request body (already read to verify the token's body hash). */
  body: Uint8Array
  db: D1Client
  /** The signed-in user, re-read from D1 — set for "user", "staff" and "student" routes, null otherwise. */
  session: Session | null
  now: Date
}

export type Handler = (context: RouteContext) => Promise<Response>

type Route = { method: string; segments: string[]; access: Access; handler: Handler }

export type Match =
  | { kind: "found"; route: Route; params: Record<string, string> }
  | { kind: "method-not-allowed"; allowed: string[] }
  | { kind: "not-found" }

export class Router {
  private readonly routes: Route[] = []

  add(method: string, pattern: string, access: Access, handler: Handler): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), access, handler })
    return this
  }

  get(pattern: string, access: Access, handler: Handler) {
    return this.add("GET", pattern, access, handler)
  }
  post(pattern: string, access: Access, handler: Handler) {
    return this.add("POST", pattern, access, handler)
  }
  put(pattern: string, access: Access, handler: Handler) {
    return this.add("PUT", pattern, access, handler)
  }
  patch(pattern: string, access: Access, handler: Handler) {
    return this.add("PATCH", pattern, access, handler)
  }

  match(method: string, pathname: string): Match {
    const segments = pathname.split("/").filter(Boolean)
    const allowed: string[] = []
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments)
      if (!params) continue
      if (route.method === method) return { kind: "found", route, params }
      allowed.push(route.method)
    }
    return allowed.length > 0 ? { kind: "method-not-allowed", allowed } : { kind: "not-found" }
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(":")) {
      let value: string
      try {
        value = decodeURIComponent(actual[i])
      } catch {
        return null
      }
      params[pattern[i].slice(1)] = value
    } else if (pattern[i] !== actual[i]) {
      return null
    }
  }
  return params
}
