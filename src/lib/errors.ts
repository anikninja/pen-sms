import { Prisma } from "@prisma/client"
import { z } from "zod"

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL"

export type FieldErrors = Record<string, string[]>

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

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false
  }
  if (!field) return true
  const target = error.meta?.target
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field)
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

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return new DomainError("CONFLICT", "This record already exists.")
    if (error.code === "P2025") return new DomainError("NOT_FOUND", "The record was not found.")
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
