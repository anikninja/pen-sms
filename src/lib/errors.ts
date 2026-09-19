import { z } from "zod"

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL"

export type FieldErrors = Record<string, string[]>

/** HTTP status for each error code, used by the Next.js API routes and by the Worker. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
}

/** Returned by every Server Action (architecture.md §31). Never throws to the client. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ErrorCode; fieldErrors?: FieldErrors }

/** A failure with a message that is safe to show to the user. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: FieldErrors
  ) {
    super(message)
    this.name = "DomainError"
  }
}

export const fieldError = (field: string, message: string) =>
  new DomainError("VALIDATION", message, { [field]: [message] })

/** A clash with existing data (duplicate email, reference number) tied to one field — HTTP 409. */
export const fieldConflict = (field: string, message: string) =>
  new DomainError("CONFLICT", message, { [field]: [message] })

/**
 * A Prisma known request error, recognised by shape rather than `instanceof`: the class is a
 * different object in each generated client and in the Node and Workers (wasm) runtimes.
 */
export type PrismaKnownError = Error & { code: string; meta?: Record<string, unknown> }

export function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    typeof (error as { code?: unknown }).code === "string"
  )
}

export type UniqueViolation = {
  /** Column names, e.g. ["email"] or ["studentId", "assessmentId"]. Empty when not reported. */
  fields: string[]
  /** Constraint or index name when that is all the database reported, e.g. "Student_email_key". */
  constraint: string | null
}

// SQLite / D1: "UNIQUE constraint failed: Payment.referenceNumber" (also inside P2010 raw-query errors).
const SQLITE_UNIQUE = /(?:UNIQUE|PRIMARY KEY) constraint failed: ([^`\n]+)/
// Prisma's rendering of a driver-adapter violation: "Unique constraint failed on the fields: (`email`)".
const PRISMA_UNIQUE_FIELDS = /Unique constraint failed on the fields: \(([^)]*)\)/
// Raw SQL through @prisma/adapter-d1 (P2010, meta.message): "Unique constraint failed: (email)" or,
// when D1 names only the index, "Unique constraint failed: Student_email_key". Verified against local D1.
const ADAPTER_UNIQUE = /Unique constraint failed: (?:\(([^)]*)\)|`?([A-Za-z0-9_]+)`?)/

// "Payment.referenceNumber" or "Submission.studentId, Submission.assessmentId: SQLITE_CONSTRAINT" (D1 suffix).
const columnsFromSqlite = (list: string) =>
  list
    .split(": ")[0]
    .split(",")
    .map((part) => part.trim().split(".").pop() ?? "")
    .filter(Boolean)

/**
 * Describes a unique-constraint violation, or returns null for any other error. Handles every shape:
 * - PostgreSQL and Prisma's native SQLite engine: P2002 with `meta.target` (field list or constraint name)
 * - driver adapters such as @prisma/adapter-d1: P2002 with `meta.driverAdapterError.cause.constraint`
 * - raw SQL through Prisma (P2010) or D1 itself: only the message names the columns, in SQLite's
 *   wording ("UNIQUE constraint failed: Payment.referenceNumber") or @prisma/adapter-d1's
 *   ("Unique constraint failed: (referenceNumber)")
 */
export function uniqueViolation(error: unknown): UniqueViolation | null {
  if (isPrismaKnownError(error) && error.code === "P2002") {
    const target = error.meta?.target
    if (Array.isArray(target)) return { fields: target.map(String), constraint: null }
    if (typeof target === "string") return { fields: [], constraint: target }

    const constraint = (error.meta?.driverAdapterError as { cause?: { constraint?: unknown } } | undefined)?.cause?.constraint as
      | { fields?: unknown; index?: unknown }
      | undefined
    if (Array.isArray(constraint?.fields)) return { fields: constraint.fields.map(String), constraint: null }
    if (typeof constraint?.index === "string") return { fields: [], constraint: constraint.index }

    const listed = PRISMA_UNIQUE_FIELDS.exec(error.message)
    if (listed) return { fields: listed[1].split(",").map((field) => field.trim().replace(/`/g, "")), constraint: null }
    const sqlite = SQLITE_UNIQUE.exec(error.message)
    return { fields: sqlite ? columnsFromSqlite(sqlite[1]) : [], constraint: null }
  }

  if (error instanceof Error) {
    const rawMessage = isPrismaKnownError(error) ? String(error.meta?.message ?? error.message) : error.message
    const sqlite = SQLITE_UNIQUE.exec(rawMessage) ?? SQLITE_UNIQUE.exec(error.message)
    if (sqlite) return { fields: columnsFromSqlite(sqlite[1]), constraint: null }
    const adapter = ADAPTER_UNIQUE.exec(rawMessage) ?? ADAPTER_UNIQUE.exec(error.message)
    if (adapter) {
      return adapter[1] !== undefined
        ? { fields: adapter[1].split(",").map((field) => field.trim().replace(/`/g, "")).filter(Boolean), constraint: null }
        : { fields: [], constraint: adapter[2] }
    }
  }
  return null
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  const violation = uniqueViolation(error)
  if (!violation) return false
  if (!field) return true
  return violation.fields.includes(field) || (violation.constraint?.includes(field) ?? false)
}

/** Parses untrusted input or throws a VALIDATION error with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const flattened = z.flattenError(result.error)
  const fieldErrors: FieldErrors = {}
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(messages) && messages.length > 0) fieldErrors[field] = messages as string[]
  }
  const first = Object.values(fieldErrors)[0]?.[0] ?? flattened.formErrors[0]
  return failValidation(first ?? "Some fields are invalid.", fieldErrors)
}

function failValidation(message: string, fieldErrors: FieldErrors): never {
  throw new DomainError("VALIDATION", message, fieldErrors)
}

/** Maps any thrown value to a user-safe DomainError. Unknown errors are logged, never shown. */
export function toDomainError(error: unknown): DomainError {
  if (error instanceof DomainError) return error

  if (uniqueViolation(error)) return new DomainError("CONFLICT", "This record already exists.")
  if (isPrismaKnownError(error) && error.code === "P2025") {
    return new DomainError("NOT_FOUND", "The record was not found.")
  }

  console.error(error)
  return new DomainError("INTERNAL", "Something went wrong. Please try again.")
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    // Let Next.js handle redirect() / notFound() thrown inside actions.
    if (isNextControlFlow(error)) throw error
    const domainError = toDomainError(error)
    return {
      ok: false,
      error: domainError.message,
      code: domainError.code,
      ...(domainError.fieldErrors ? { fieldErrors: domainError.fieldErrors } : {}),
    }
  }
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
}
