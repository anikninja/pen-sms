import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { parseInput, DomainError } from "@/lib/errors"
import { feeAssignSchema, paymentCreateSchema } from "@/lib/validations/fees"
import { gradeSchema } from "@/lib/validations/results"
import { assessmentCreateSchema } from "@/lib/validations/assessments"
import { studentCreateSchema, studentSearchSchema } from "@/lib/validations/students"
import { loginSchema } from "@/lib/validations/auth"

// 12:00 in Dhaka on 16 Sep 2026.
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-16T06:00:00.000Z"))
})
afterAll(() => {
  vi.useRealTimers()
})

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? []

describe("grade", () => {
  it.each([0, 40, 60, 70, 100, "85"])("accepts %s", (grade) => {
    expect(gradeSchema.safeParse(grade).success).toBe(true)
  })

  it.each([-1, 101])("rejects %s with the range message", (grade) => {
    expect(messages(gradeSchema.safeParse(grade))).toEqual(["Grade must be between 0 and 100."])
  })

  it("rejects 70.5 as not a whole number", () => {
    expect(messages(gradeSchema.safeParse(70.5))).toEqual(["Grade must be a whole number."])
  })

  it("rejects empty and non-numeric input", () => {
    expect(gradeSchema.safeParse("").success).toBe(false)
    expect(gradeSchema.safeParse("abc").success).toBe(false)
  })
})

describe("payment", () => {
  const valid = { amount: "5000", paymentDate: "2026-09-16", referenceNumber: " pay-2026-0100 " }

  it("accepts a valid payment and normalises it", () => {
    expect(paymentCreateSchema.parse(valid)).toEqual({
      amount: "5000.00",
      paymentDate: "2026-09-16",
      referenceNumber: "PAY-2026-0100",
    })
  })

  it.each(["0", 0, "-100", -100])("rejects amount %s", (amount) => {
    expect(messages(paymentCreateSchema.safeParse({ ...valid, amount }))).toEqual([
      "Payment amount must be greater than zero.",
    ])
  })

  it("rejects more than 2 decimal places and non-numbers", () => {
    expect(messages(paymentCreateSchema.safeParse({ ...valid, amount: "10.555" }))).toEqual([
      "Amount can have at most 2 decimal places.",
    ])
    expect(messages(paymentCreateSchema.safeParse({ ...valid, amount: "ten" }))).toEqual(["Enter a valid amount."])
  })

  it("rejects a future payment date (Dhaka calendar)", () => {
    expect(messages(paymentCreateSchema.safeParse({ ...valid, paymentDate: "2026-09-17" }))).toEqual([
      "Payment date cannot be in the future.",
    ])
  })

  it("rejects invalid reference numbers", () => {
    expect(paymentCreateSchema.safeParse({ ...valid, referenceNumber: "" }).success).toBe(false)
    expect(paymentCreateSchema.safeParse({ ...valid, referenceNumber: "PAY 01" }).success).toBe(false)
  })
})

describe("fee assignment", () => {
  it("accepts a tariff assignment", () => {
    expect(feeAssignSchema.parse({ source: "TARIFF" })).toEqual({ source: "TARIFF" })
  })

  it("accepts a manual fee and defaults currency", () => {
    expect(feeAssignSchema.parse({ source: "MANUAL", amount: 120000, dueDate: "2026-12-31" })).toEqual({
      source: "MANUAL",
      amount: "120000.00",
      dueDate: "2026-12-31",
      currency: "BDT",
    })
  })

  it("rejects a zero manual fee", () => {
    expect(messages(feeAssignSchema.safeParse({ source: "MANUAL", amount: "0", dueDate: "2026-12-31" }))).toContain(
      "Fee must be greater than zero."
    )
  })
})

describe("student", () => {
  const valid = {
    fullName: "Test Student",
    email: "  Test.Student@Example.COM ",
    dateOfBirth: "2004-01-15",
    programmeId: "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b",
    academicYear: "2026",
  }

  it("accepts a valid student, normalising email and year", () => {
    const parsed = studentCreateSchema.parse(valid)
    expect(parsed.email).toBe("test.student@example.com")
    expect(parsed.academicYear).toBe(2026)
    expect(parsed.enrolmentStatus).toBe("ENROLLED")
    expect(parsed.password).toBeUndefined()
  })

  it("rejects an invalid email", () => {
    expect(messages(studentCreateSchema.safeParse({ ...valid, email: "not-an-email" }))).toEqual([
      "Enter a valid email address.",
    ])
  })

  it("rejects a future date of birth", () => {
    expect(messages(studentCreateSchema.safeParse({ ...valid, dateOfBirth: "2027-01-01" }))).toEqual([
      "Date of birth must be in the past.",
    ])
  })

  it("rejects a student under 15, accepts exactly 15", () => {
    expect(messages(studentCreateSchema.safeParse({ ...valid, dateOfBirth: "2011-09-17" }))).toEqual([
      "Student must be at least 15 years old.",
    ])
    expect(studentCreateSchema.safeParse({ ...valid, dateOfBirth: "2011-09-16" }).success).toBe(true)
  })

  it("rejects academic years outside 2000 … next year", () => {
    expect(studentCreateSchema.safeParse({ ...valid, academicYear: 1999 }).success).toBe(false)
    expect(studentCreateSchema.safeParse({ ...valid, academicYear: 2027 }).success).toBe(true)
    expect(messages(studentCreateSchema.safeParse({ ...valid, academicYear: 2028 }))).toEqual([
      "Academic year must be between 2000 and 2027.",
    ])
  })

  it("rejects a short password but ignores an empty one", () => {
    expect(studentCreateSchema.safeParse({ ...valid, password: "short" }).success).toBe(false)
    expect(studentCreateSchema.parse({ ...valid, password: "" }).password).toBeUndefined()
  })

  it("treats empty search params as absent", () => {
    expect(studentSearchSchema.parse({ q: "  ", programme: "", status: "" })).toEqual({})
  })
})

describe("assessment", () => {
  const valid = {
    programmeId: "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b",
    title: "Coursework",
    module: "Databases",
    submissionDeadline: "2026-09-30T23:59:00+06:00",
  }

  it("parses the deadline with its time zone and defaults to open", () => {
    const parsed = assessmentCreateSchema.parse(valid)
    expect(parsed.submissionDeadline.toISOString()).toBe("2026-09-30T17:59:00.000Z")
    expect(parsed.isOpen).toBe(true)
  })

  it("rejects a deadline without a time zone and missing fields", () => {
    expect(assessmentCreateSchema.safeParse({ ...valid, submissionDeadline: "2026-09-30T23:59" }).success).toBe(false)
    expect(assessmentCreateSchema.safeParse({ ...valid, title: "  " }).success).toBe(false)
  })
})

describe("login and parseInput", () => {
  it("normalises the email before validating it", () => {
    expect(loginSchema.parse({ email: " REGISTRY@pensms.test ", password: "x" }).email).toBe("registry@pensms.test")
  })

  it("throws a VALIDATION DomainError with field errors", () => {
    try {
      parseInput(gradeSchema.transform((grade) => ({ grade })), 101)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect((error as DomainError).code).toBe("VALIDATION")
      expect((error as DomainError).message).toBe("Grade must be between 0 and 100.")
    }
  })
})
