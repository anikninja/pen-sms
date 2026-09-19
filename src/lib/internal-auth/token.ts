/**
 * Signed tokens between the Next.js server and the Cloudflare Worker (worker/API.md, "Authentication").
 *
 * API tokens: the Next.js server signs every request it sends to the Worker. A token
 * - is valid for at most 60 seconds;
 * - is bound to that one request: HTTP method, path + query, and the SHA-256 of the body, so a
 *   captured token cannot be replayed against another endpoint or with another body;
 * - carries only the user id (or none, for the login lookup). The Worker reads the user's role and
 *   student link from D1 itself, exactly like getSession() re-reads them on every request.
 *
 * File tokens (see signFileToken): the Worker signs short-lived upload/download URLs that the
 * browser uses directly, so files never pass through Vercel.
 *
 * HMAC-SHA-256 with Web Crypto, available in Node.js 22 and in Workers. Each token kind uses its own
 * key, derived from the shared secret with HKDF, so one kind can never be accepted as the other.
 * The format is `v1.<base64url JSON claims>.<base64url signature>`; there is no algorithm field
 * to negotiate.
 */

export const MIN_SECRET_LENGTH = 32
export const API_TOKEN_TTL_SECONDS = 60
/** Accepted difference between the Vercel and Cloudflare clocks. */
export const MAX_CLOCK_SKEW_SECONDS = 30
const MAX_TOKEN_LENGTH = 4096
const VERSION = "v1"
const ISSUER = "pen-sms-web"
const AUDIENCE = "pen-sms-worker"

type KeyPurpose = "api" | "file"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Throws unless the secret is long enough to be a real random secret. Never includes the value. */
export function assertSecret(secret: string | undefined, name: string): asserts secret is string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be set to a random string of at least ${MIN_SECRET_LENGTH} characters.`)
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

const keys = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string, purpose: KeyPurpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}:${secret}`
  let key = keys.get(cacheKey)
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: encoder.encode("pen-sms"), info: encoder.encode(`pen-sms/${purpose}-token/v1`) },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"]
        )
      )
    keys.set(cacheKey, key)
  }
  return key
}

async function signPayload(secret: string, purpose: KeyPurpose, claims: object): Promise<string> {
  const signingInput = `${VERSION}.${base64UrlEncode(encoder.encode(JSON.stringify(claims)))}`
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, purpose), encoder.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

/** The claims of a token signed with one of the secrets (current first, then the previous one while rotating). */
async function openPayload(
  secrets: readonly string[],
  purpose: KeyPurpose,
  token: string
): Promise<Record<string, unknown> | "MALFORMED" | "BAD_SIGNATURE"> {
  if (token.length > MAX_TOKEN_LENGTH) return "MALFORMED"
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== VERSION) return "MALFORMED"
  const signature = base64UrlDecode(parts[2])
  const payload = base64UrlDecode(parts[1])
  if (!signature || !payload) return "MALFORMED"

  const signed = encoder.encode(`${parts[0]}.${parts[1]}`)
  for (const secret of secrets) {
    // crypto.subtle.verify compares in constant time.
    if (await crypto.subtle.verify("HMAC", await hmacKey(secret, purpose), signature, signed)) {
      try {
        const claims: unknown = JSON.parse(decoder.decode(payload))
        return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : "MALFORMED"
      } catch {
        return "MALFORMED"
      }
    }
  }
  return "BAD_SIGNATURE"
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

type TimeCheck = "EXPIRED" | "NOT_YET_VALID" | "LIFETIME_TOO_LONG" | "MALFORMED" | null

function checkTimes(claims: Record<string, unknown>, now: Date, maxLifetime: number): TimeCheck {
  const { iat, exp } = claims
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return "MALFORMED"
  const nowSeconds = seconds(now)
  if ((exp as number) - (iat as number) > maxLifetime) return "LIFETIME_TOO_LONG"
  if ((iat as number) > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return "NOT_YET_VALID"
  if (nowSeconds > (exp as number) + MAX_CLOCK_SKEW_SECONDS) return "EXPIRED"
  return null
}

// ─── API tokens (Next.js server → Worker) ────────────────────────────────────

/** The request a token is bound to. `pathAndQuery` is the URL's pathname + search, e.g. "/v1/students?q=ra". */
export type BoundRequest = { method: string; pathAndQuery: string; body: Uint8Array | string | null }

export type ApiTokenClaims = {
  iss: typeof ISSUER
  aud: typeof AUDIENCE
  typ: "api"
  /** The signed-in user's id, or null for the login lookup (before anyone is signed in). */
  sub: string | null
  iat: number
  exp: number
  jti: string
  htm: string
  htu: string
  /** base64url SHA-256 of the request body (of zero bytes when there is none). */
  bh: string
}

export type ApiTokenError =
  | "MISSING"
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "WRONG_AUDIENCE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "LIFETIME_TOO_LONG"
  | "REQUEST_MISMATCH"

export async function bodyHash(body: Uint8Array | string | null): Promise<string> {
  // A copy, so the digest always gets a plain ArrayBuffer-backed view.
  const bytes = typeof body === "string" ? encoder.encode(body) : new Uint8Array(body ?? [])
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
}

export async function signApiToken(
  secret: string,
  params: { userId: string | null; request: BoundRequest; now?: Date; ttlSeconds?: number }
): Promise<string> {
  const iat = seconds(params.now ?? new Date())
  const claims: ApiTokenClaims = {
    iss: ISSUER,
    aud: AUDIENCE,
    typ: "api",
    sub: params.userId,
    iat,
    exp: iat + (params.ttlSeconds ?? API_TOKEN_TTL_SECONDS),
    jti: crypto.randomUUID(),
    htm: params.request.method.toUpperCase(),
    htu: params.request.pathAndQuery,
    bh: await bodyHash(params.request.body),
  }
  return signPayload(secret, "api", claims)
}

export async function verifyApiToken(
  secrets: readonly string[],
  token: string | null,
  request: BoundRequest,
  now = new Date()
): Promise<{ ok: true; claims: ApiTokenClaims } | { ok: false; reason: ApiTokenError }> {
  if (!token) return { ok: false, reason: "MISSING" }
  const claims = await openPayload(secrets, "api", token)
  if (typeof claims === "string") return { ok: false, reason: claims }

  if (claims.typ !== "api" || claims.iss !== ISSUER || claims.aud !== AUDIENCE) return { ok: false, reason: "WRONG_AUDIENCE" }
  if (claims.sub !== null && typeof claims.sub !== "string") return { ok: false, reason: "MALFORMED" }
  const timeError = checkTimes(claims, now, API_TOKEN_TTL_SECONDS)
  if (timeError) return { ok: false, reason: timeError }

  if (
    claims.htm !== request.method.toUpperCase() ||
    claims.htu !== request.pathAndQuery ||
    claims.bh !== (await bodyHash(request.body))
  ) {
    return { ok: false, reason: "REQUEST_MISMATCH" }
  }
  return { ok: true, claims: claims as ApiTokenClaims }
}

// ─── File tokens (Worker → browser, for direct upload/download URLs) ─────────

export const UPLOAD_TOKEN_TTL_SECONDS = 5 * 60
export const DOWNLOAD_TOKEN_TTL_SECONDS = 60

export type UploadTokenClaims = {
  typ: "upload"
  /** User who asked for the URL, and the student and assessment the upload is for. */
  sub: string
  sid: string
  aid: string
  iat: number
  exp: number
  jti: string
}

export type DownloadTokenClaims = {
  typ: "download"
  sub: string
  /** Submission id and the exact object key it pointed to when the URL was issued. */
  fid: string
  key: string
  iat: number
  exp: number
  jti: string
}

export type FileTokenClaims = UploadTokenClaims | DownloadTokenClaims

type FileTokenInput =
  | Omit<UploadTokenClaims, "iat" | "exp" | "jti">
  | Omit<DownloadTokenClaims, "iat" | "exp" | "jti">

export async function signFileToken(secret: string, claims: FileTokenInput, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const iat = seconds(now)
  const exp = iat + (claims.typ === "upload" ? UPLOAD_TOKEN_TTL_SECONDS : DOWNLOAD_TOKEN_TTL_SECONDS)
  const token = await signPayload(secret, "file", { ...claims, iat, exp, jti: crypto.randomUUID() })
  return { token, expiresAt: new Date(exp * 1000) }
}

export async function verifyFileToken<T extends FileTokenClaims["typ"]>(
  secrets: readonly string[],
  token: string | null,
  typ: T,
  now = new Date()
): Promise<{ ok: true; claims: Extract<FileTokenClaims, { typ: T }> } | { ok: false; reason: ApiTokenError }> {
  if (!token) return { ok: false, reason: "MISSING" }
  const claims = await openPayload(secrets, "file", token)
  if (typeof claims === "string") return { ok: false, reason: claims }
  if (claims.typ !== typ) return { ok: false, reason: "WRONG_AUDIENCE" }
  const maxLifetime = typ === "upload" ? UPLOAD_TOKEN_TTL_SECONDS : DOWNLOAD_TOKEN_TTL_SECONDS
  const timeError = checkTimes(claims, now, maxLifetime)
  if (timeError) return { ok: false, reason: timeError }
  const fields = typ === "upload" ? ["sub", "sid", "aid"] : ["sub", "fid", "key"]
  if (!fields.every((field) => typeof claims[field] === "string")) return { ok: false, reason: "MALFORMED" }
  return { ok: true, claims: claims as Extract<FileTokenClaims, { typ: T }> }
}
