import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"

import { DomainError, isPrismaKnownError, isUniqueViolation, toDomainError, uniqueViolation } from "@/lib/errors"

const known = (code: string, meta?: Record<string, unknown>, message = "Request failed") =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "6.12.0", meta })

/** The same error from another runtime (e.g. the Workers wasm client): same name and shape, different class. */
class OtherRuntimeKnownError extends Error {
  name = "PrismaClientKnownRequestError"
  constructor(
    readonly code: string,
    readonly meta: Record<string, unknown>,
    message = "Request failed"
  ) {
    super(message)
  }
}

describe("uniqueViolation — every shape a unique violation arrives in", () => {
  it("PostgreSQL / native SQLite: P2002 with a field list", () => {
    expect(uniqueViolation(known("P2002", { modelName: "Student", target: ["email"] }))).toEqual({ fields: ["email"], constraint: null })
  })

  it("PostgreSQL: P2002 with a constraint name", () => {
    expect(uniqueViolation(known("P2002", { target: "Student_email_key" }))).toEqual({ fields: [], constraint: "Student_email_key" })
  })

  it("driver adapter (D1): P2002 carrying the adapter error", () => {
    const error = known("P2002", {
      modelName: "Payment",
      driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["referenceNumber"] } } },
    })
    expect(uniqueViolation(error)).toEqual({ fields: ["referenceNumber"], constraint: null })
  })

  it("driver adapter: fields only in Prisma's message", () => {
    const error = known("P2002", {}, "Unique constraint failed on the fields: (`studentId`,`assessmentId`)")
    expect(uniqueViolation(error)?.fields).toEqual(["studentId", "assessmentId"])
  })

  it("raw SQL through Prisma: P2010 with the SQLite message (verified against the native engine)", () => {
    const error = known(
      "P2010",
      { code: "2067", message: "UNIQUE constraint failed: Payment.referenceNumber" },
      "Raw query failed. Code: `2067`. Message: `UNIQUE constraint failed: Payment.referenceNumber`"
    )
    expect(uniqueViolation(error)).toEqual({ fields: ["referenceNumber"], constraint: null })
  })

  it("D1 directly: D1_ERROR message, composite key", () => {
    const error = new Error("D1_ERROR: UNIQUE constraint failed: Submission.studentId, Submission.assessmentId: SQLITE_CONSTRAINT")
    expect(uniqueViolation(error)?.fields).toEqual(["studentId", "assessmentId"])
  })

  it("the same error class from another runtime", () => {
    expect(uniqueViolation(new OtherRuntimeKnownError("P2002", { target: ["email"] }))?.fields).toEqual(["email"])
    expect(isPrismaKnownError(new OtherRuntimeKnownError("P2025", {}))).toBe(true)
  })

  it("is null for everything else", () => {
    expect(uniqueViolation(known("P2025"))).toBeNull()
    expect(uniqueViolation(known("P2003", { field_name: "studentId" }))).toBeNull()
    expect(
      uniqueViolation(known("P2010", { message: "CHECK constraint failed: Payment_amount_check" }, "Raw query failed. Message: `CHECK constraint failed: Payment_amount_check`"))
    ).toBeNull()
    expect(uniqueViolation(new Error("boom"))).toBeNull()
    expect(uniqueViolation("UNIQUE constraint failed: x.y")).toBeNull()
    expect(uniqueViolation(null)).toBeNull()
  })
})

describe("isUniqueViolation(error, field) — unchanged behaviour for existing callers", () => {
  it("matches the field in a field list exactly", () => {
    const error = known("P2002", { target: ["email"] })
    expect(isUniqueViolation(error)).toBe(true)
    expect(isUniqueViolation(error, "email")).toBe(true)
    expect(isUniqueViolation(error, "studentId")).toBe(false)
  })

  it("matches the field inside a constraint name", () => {
    expect(isUniqueViolation(known("P2002", { target: "Student_studentId_key" }), "studentId")).toBe(true)
  })

  it("recognises raw-SQL violations by column", () => {
    const error = known("P2010", { message: "UNIQUE constraint failed: Student.email" }, "Raw query failed.")
    expect(isUniqueViolation(error, "email")).toBe(true)
    expect(isUniqueViolation(error, "studentId")).toBe(false)
  })
})

describe("toDomainError", () => {
  it("maps unique violations to CONFLICT from any source", () => {
    expect(toDomainError(known("P2002", { target: ["email"] }))).toMatchObject({ code: "CONFLICT", message: "This record already exists." })
    expect(toDomainError(new Error("D1_ERROR: UNIQUE constraint failed: User.email"))).toMatchObject({ code: "CONFLICT" })
  })

  it("maps P2025 to NOT_FOUND, also from another runtime", () => {
    expect(toDomainError(known("P2025"))).toMatchObject({ code: "NOT_FOUND" })
    expect(toDomainError(new OtherRuntimeKnownError("P2025", {}))).toMatchObject({ code: "NOT_FOUND" })
  })

  it("passes DomainErrors through and hides anything else", () => {
    const domain = new DomainError("FORBIDDEN", "No.")
    expect(toDomainError(domain)).toBe(domain)
    const original = console.error
    console.error = () => undefined
    try {
      expect(toDomainError(new Error("secret detail"))).toMatchObject({ code: "INTERNAL", message: "Something went wrong. Please try again." })
    } finally {
      console.error = original
    }
  })
})
