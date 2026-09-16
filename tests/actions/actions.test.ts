import { beforeEach, describe, expect, it, vi } from "vitest"

import { DomainError } from "@/lib/errors"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }))
vi.mock("@/lib/services/fees", () => ({ createPayment: vi.fn(), assignStudentFee: vi.fn() }))
vi.mock("@/lib/services/submissions", () => ({ submitAssessment: vi.fn() }))
vi.mock("@/lib/services/results", () => ({
  upsertResult: vi.fn(),
  setResultPublished: vi.fn(),
  setStudentResultsPublished: vi.fn(),
  setAssessmentResultsPublished: vi.fn(),
}))

const { revalidatePath } = await import("next/cache")
const { getSession } = await import("@/lib/auth/session")
const fees = await import("@/lib/services/fees")
const submissions = await import("@/lib/services/submissions")
const results = await import("@/lib/services/results")
const { createPaymentAction } = await import("@/actions/payments")
const { submitAssessmentAction } = await import("@/actions/submissions")
const { saveGradeAction } = await import("@/actions/results")

const STUDENT_ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b"
const ASSESSMENT_ID = "5e3d0a1c-0000-4000-8000-000000000102"
const staffSession = { userId: "u1", name: "Staff", email: "s@x.test", role: "STAFF", studentId: null }
const studentSession = { userId: "u2", name: "Student", email: "st@x.test", role: "STUDENT", studentId: STUDENT_ID }
const validPayment = { amount: "1000", paymentDate: "2020-01-01", referenceNumber: "ref-1" }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createPaymentAction", () => {
  it("returns UNAUTHORIZED when signed out", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await createPaymentAction(STUDENT_ID, validPayment)).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      error: "Please sign in.",
    })
    expect(fees.createPayment).not.toHaveBeenCalled()
  })

  it("returns FORBIDDEN for a student and never reaches the service", async () => {
    vi.mocked(getSession).mockResolvedValue(studentSession as never)
    const result = await createPaymentAction(STUDENT_ID, validPayment)
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(fees.createPayment).not.toHaveBeenCalled()
  })

  it("returns VALIDATION with field errors for bad input", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    const result = await createPaymentAction(STUDENT_ID, { ...validPayment, amount: "0" })
    expect(result).toEqual({
      ok: false,
      code: "VALIDATION",
      error: "Payment amount must be greater than zero.",
      fieldErrors: { amount: ["Payment amount must be greater than zero."] },
    })
    expect(fees.createPayment).not.toHaveBeenCalled()
  })

  it("treats a malformed student id as NOT_FOUND", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    expect(await createPaymentAction("../etc", validPayment)).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })

  it("calls the service with normalised input and revalidates", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    vi.mocked(fees.createPayment).mockResolvedValue({ id: "p1" } as never)

    expect(await createPaymentAction(STUDENT_ID, validPayment)).toEqual({ ok: true, data: { id: "p1" } })
    expect(fees.createPayment).toHaveBeenCalledWith(STUDENT_ID, {
      amount: "1000.00",
      paymentDate: "2020-01-01",
      referenceNumber: "REF-1",
    })
    expect(revalidatePath).toHaveBeenCalled()
  })

  it("passes domain errors through with their code", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    vi.mocked(fees.createPayment).mockRejectedValue(new DomainError("CONFLICT", "No fee has been assigned to this student."))
    expect(await createPaymentAction(STUDENT_ID, validPayment)).toEqual({
      ok: false,
      code: "CONFLICT",
      error: "No fee has been assigned to this student.",
    })
  })

  it("hides unexpected errors behind a generic message", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    vi.mocked(fees.createPayment).mockRejectedValue(new Error('relation "Payment" does not exist'))
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await createPaymentAction(STUDENT_ID, validPayment)
    expect(result).toEqual({ ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." })
    expect(JSON.stringify(result)).not.toContain("relation")
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe("submitAssessmentAction", () => {
  it("always uses the student from the session, ignoring any studentId in the form", async () => {
    vi.mocked(getSession).mockResolvedValue(studentSession as never)
    vi.mocked(submissions.submitAssessment).mockResolvedValue({ id: "s1", replaced: false } as never)

    const form = new FormData()
    form.append("assessmentId", ASSESSMENT_ID)
    form.append("studentId", "11111111-1111-4111-8111-111111111111")
    form.append("file", new File(["%PDF"], "a.pdf", { type: "application/pdf" }))

    expect(await submitAssessmentAction(form)).toMatchObject({ ok: true })
    expect(submissions.submitAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: STUDENT_ID, assessmentId: ASSESSMENT_ID })
    )
  })

  it("rejects staff and a missing file", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    expect(await submitAssessmentAction(new FormData())).toMatchObject({ ok: false, code: "FORBIDDEN" })

    vi.mocked(getSession).mockResolvedValue(studentSession as never)
    const form = new FormData()
    form.append("assessmentId", ASSESSMENT_ID)
    expect(await submitAssessmentAction(form)).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { file: ["Choose a PDF or DOCX file to upload."] },
    })
    expect(submissions.submitAssessment).not.toHaveBeenCalled()
  })
})

describe("saveGradeAction", () => {
  it("validates the grade before calling the service", async () => {
    vi.mocked(getSession).mockResolvedValue(staffSession as never)
    expect(await saveGradeAction(STUDENT_ID, ASSESSMENT_ID, { grade: "70.5" })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      error: "Grade must be a whole number.",
    })
    expect(results.upsertResult).not.toHaveBeenCalled()

    vi.mocked(results.upsertResult).mockResolvedValue({ grade: 70 } as never)
    expect(await saveGradeAction(STUDENT_ID, ASSESSMENT_ID, { grade: "70" })).toEqual({ ok: true, data: { grade: 70 } })
    expect(results.upsertResult).toHaveBeenCalledWith(STUDENT_ID, ASSESSMENT_ID, 70)
  })
})
