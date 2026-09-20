/**
 * The Next.js side of the boundary against the real Worker: src/lib/data/worker.ts (what pages,
 * Server Actions and API routes use with DATA_BACKEND=worker) calling a running Worker over HTTP.
 * Every DataApi method is exercised, so the response contract (src/lib/data/contract.ts) is checked
 * against what the Worker really returns — including dates coming back as Date objects.
 */
import bcrypt from "bcryptjs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { DomainError } from "@/lib/errors"

import { ASSESSMENT, sid, STAFF_EMAIL, startTestWorker, TEST_SECRET, today, YEAR, type TestWorker } from "./harness"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
const { auth } = await import("@/auth")
const { workerData: data } = await import("@/lib/data/worker")

let w: TestWorker
const idOf = (email: string) => w.users.get(email)!.id
/** Makes the next data-layer calls run as this signed-in user (the Auth.js session cookie). */
const signIn = (email: string | null) =>
  vi.mocked(auth).mockResolvedValue((email ? { user: { id: idOf(email) } } : null) as never)

beforeAll(async () => {
  w = await startTestWorker({ seed: true })
  vi.stubEnv("WORKER_API_URL", w.url.origin)
  vi.stubEnv("WORKER_INTERNAL_SECRET", TEST_SECRET)
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await w?.dispose()
})

describe("authentication", () => {
  it("looks up an account for sign-in without a session, and bcrypt verifies in Next.js", async () => {
    const account = await data.findLoginAccount(STAFF_EMAIL)
    expect(account).toMatchObject({ email: STAFF_EMAIL, role: "STAFF", studentId: null })
    expect(await bcrypt.compare("Password123!", account!.passwordHash)).toBe(true)
    expect(await data.findLoginAccount("nobody@sms.inxapp.net")).toBeNull()
  })

  it("loads the session from D1 and signs out deleted accounts", async () => {
    expect(await data.loadSession(idOf("rahim.uddin@sms.inxapp.net"))).toMatchObject({ role: "STUDENT", name: "Rahim Uddin" })
    expect(await data.loadSession(crypto.randomUUID())).toBeNull()
  })

  it("refuses to call the Worker without a signed-in user", async () => {
    signIn(null)
    await expect(data.getStaffDashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })
})

describe("staff pages (one Worker request each)", () => {
  beforeAll(() => signIn(STAFF_EMAIL))

  it("dashboard, students, student, edit", async () => {
    signIn(STAFF_EMAIL)
    const dashboard = await data.getStaffDashboard()
    expect(dashboard).toMatchObject({ totalStudents: 6, enrolledStudents: 4, overdueStudents: 3 })
    expect(dashboard.overdue[0].dueDate).toBeInstanceOf(Date)

    const { students, programmes } = await data.getStudentsPage({ programme: "mba" })
    expect(students.map((s) => s.studentId)).toEqual([sid(5), sid(6)])
    expect(programmes).toHaveLength(2)

    const rahim = (await data.listStudents({ q: "rahim" }))[0]
    const page = await data.getStudentPage(rahim.id)
    expect(page.student.createdAt).toBeInstanceOf(Date)
    expect(page.fees.summary).toMatchObject({ outstanding: "60000.00", status: "OVERDUE" })
    expect(page.fees.summary.dueDate).toBeInstanceOf(Date)
    expect(page.fees.payments).toHaveLength(2)
    expect(page.assessments[0].submissionDeadline).toBeInstanceOf(Date)
    expect(page.results[0].updatedAt).toBeInstanceOf(Date)

    const edit = await data.getStudentEditPage(rahim.id)
    expect(edit.student.id).toBe(rahim.id)
    await expect(data.getStudentPage(crypto.randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND", message: "Student not found." })
  })

  it("programmes, fees, assessments and results pages", async () => {
    signIn(STAFF_EMAIL)
    expect((await data.listProgrammes({ activeOnly: true })).every((p) => p.active)).toBe(true)
    expect((await data.listFeeOverview({ status: "OVERDUE" })).map((row) => row.status)).toEqual(["OVERDUE", "OVERDUE", "OVERDUE"])

    const assessments = await data.getAssessmentsPage("MBA")
    expect(assessments.assessments.every((a) => a.programme.code === "MBA")).toBe(true)

    const assessment = await data.getAssessmentPage(ASSESSMENT.DB)
    expect(assessment.grading.counts).toMatchObject({ students: 4, submitted: 3, late: 1 })
    expect(assessment.grading.rows.find((row) => row.submission)?.submission?.submittedAt).toBeInstanceOf(Date)

    const results = await data.getResultsPage(undefined)
    expect(results.selectedId).toEqual(expect.any(String))
    expect(Object.values(results.withheld).every((count) => count > 0)).toBe(true)
    expect(await data.getResultsPage(crypto.randomUUID())).toMatchObject({ selectedId: null, grading: null })
  })
})

describe("staff operations", () => {
  it("creates a student with a login: the password is hashed in Next.js, never sent", async () => {
    signIn(STAFF_EMAIL)
    const programmes = await data.listProgrammes()
    const student = await data.createStudent({
      fullName: "Data Layer",
      email: "data.layer@sms.inxapp.net",
      dateOfBirth: "2005-01-01",
      programmeId: programmes.find((p) => p.code === "BSC-CS")!.id,
      academicYear: YEAR,
      enrolmentStatus: "ENROLLED",
      password: "Correct-Horse-9",
    })
    expect(student).toMatchObject({ studentId: sid(7), hasLogin: true })
    const account = await data.findLoginAccount("data.layer@sms.inxapp.net")
    expect(await bcrypt.compare("Correct-Horse-9", account!.passwordHash)).toBe(true)

    const updated = await data.updateStudent(student.id, { fullName: "Data Layer 2" })
    expect(updated.fullName).toBe("Data Layer 2")
    const dup = await data.createStudent({ ...student, email: "data.layer@sms.inxapp.net", dateOfBirth: "2005-01-01", programmeId: student.programme.id, password: undefined }).catch((e: unknown) => e)
    expect(dup).toBeInstanceOf(DomainError)
    expect(dup).toMatchObject({ code: "CONFLICT", fieldErrors: { email: ["A student with this email already exists."] } })
  })

  it("fees, payments, grades and publishing", async () => {
    signIn(STAFF_EMAIL)
    const abir = (await data.listStudents({ q: "abir" }))[0]
    const payment = await data.createPayment(abir.id, { amount: "1000.50", paymentDate: today(), referenceNumber: "DL-1" })
    expect(payment).toMatchObject({ amount: "1000.50", referenceNumber: "DL-1", studentId: abir.id })
    expect(payment.updatedAt).toBeInstanceOf(Date)
    expect((await data.getStudentFees(abir.id)).summary.totalPaid).toBe("1000.50")
    expect(await data.assignStudentFee(abir.id, { source: "TARIFF" })).toMatchObject({ totalFee: "150000.00" })

    const over = await data.createPayment(abir.id, { amount: "999999", paymentDate: today(), referenceNumber: "DL-2" }).catch((e: unknown) => e)
    expect(over).toMatchObject({ code: "VALIDATION", fieldErrors: { amount: expect.any(Array) } })

    expect(await data.upsertResult(abir.id, ASSESSMENT.ALGO, 55)).toMatchObject({ grade: 55, classification: "Pass", published: false })
    expect(await data.setResultPublished(abir.id, ASSESSMENT.ALGO, true)).toMatchObject({ published: true })
    expect(await data.setStudentResultsPublished(abir.id, false)).toEqual({ updated: 2 })
    expect((await data.setAssessmentResultsPublished(ASSESSMENT.ALGO, true)).updated).toBeGreaterThanOrEqual(2)
  })

  it("assessments", async () => {
    signIn(STAFF_EMAIL)
    const mba = (await data.listProgrammes()).find((programme) => programme.code === "MBA")!
    const created = await data.createAssessment({
      programmeId: mba.id,
      title: "Data Layer",
      module: "Contracts",
      submissionDeadline: new Date(Date.now() + 86_400_000),
      isOpen: true,
    })
    expect(created.warnings).toEqual([])
    expect(created.assessment.submissionDeadline).toBeInstanceOf(Date)
    expect(await data.updateAssessment(created.assessment.id, { isOpen: false })).toMatchObject({ isOpen: false })
    expect((await data.listAssessments({ programmeId: mba.id })).some((a) => a.id === created.assessment.id)).toBe(true)
  })

  it("keeps the Worker's role rules: a student cannot use staff operations", async () => {
    signIn("rahim.uddin@sms.inxapp.net")
    await expect(data.listStudents({})).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only Registry staff can do this." })
  })
})

describe("the signed-in student's pages", () => {
  it("dashboard, fees, assessments, marksheet", async () => {
    signIn("rahim.uddin@sms.inxapp.net")
    const studentId = w.users.get("rahim.uddin@sms.inxapp.net")!.studentId!
    const overview = await data.getMyOverview(studentId)
    expect(overview.student.fullName).toBe("Rahim Uddin")
    expect(overview.nextDeadline?.submissionDeadline).toBeInstanceOf(Date)
    expect((await data.getMyFees(studentId)).summary.totalPaid).toBe("90000.00")
    expect((await data.getMyAssessments(studentId)).map((a) => a.id).sort()).toEqual([ASSESSMENT.DB, ASSESSMENT.ALGO].sort())
    expect((await data.getMyMarksheet(studentId)).map((r) => r.grade)).toEqual([70])
  })
})

describe("files", () => {
  it("uploads through a Worker URL (server side) and downloads through a redirect", async () => {
    signIn("nusrat.jahan@sms.inxapp.net")
    const studentId = w.users.get("nusrat.jahan@sms.inxapp.net")!.studentId!
    const grant = await data.requestSubmissionUpload(ASSESSMENT.ALGO, { name: "a.pdf", type: "application/pdf", size: 5 })
    expect(grant).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" } })
    expect(grant!.expiresAt).toBeInstanceOf(Date)

    const file = new File(["%PDF-1.4 data layer"], "Data Layer.pdf", { type: "application/pdf" })
    const submission = await data.submitAssessment({ studentId, assessmentId: ASSESSMENT.ALGO, file })
    expect(submission).toMatchObject({ fileName: "Data Layer.pdf", replaced: true })
    expect(submission.submittedAt).toBeInstanceOf(Date)

    const session = (await data.loadSession(idOf("nusrat.jahan@sms.inxapp.net")))!
    const download = await data.getSubmissionDownload(submission.id, session)
    expect(download.kind).toBe("redirect")
    const response = await fetch((download as { url: string }).url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("%PDF-1.4 data layer")

    signIn("rahim.uddin@sms.inxapp.net")
    const rahim = (await data.loadSession(idOf("rahim.uddin@sms.inxapp.net")))!
    await expect(data.getSubmissionDownload(submission.id, rahim)).rejects.toMatchObject({ code: "NOT_FOUND", message: "File not found." })
  })

  it("rejects an invalid file before any upload", async () => {
    signIn("nusrat.jahan@sms.inxapp.net")
    await expect(data.requestSubmissionUpload(ASSESSMENT.ALGO, { name: "a.txt", type: "text/plain", size: 5 })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { file: ["Only PDF and DOCX files are accepted."] },
    })
  })
})

describe("misconfiguration", () => {
  it("turns a secret mismatch into a service error, not a sign-out", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubEnv("WORKER_INTERNAL_SECRET", "a-different-secret-that-is-long-enough-000000")
    signIn(STAFF_EMAIL)
    await expect(data.getStaffDashboard()).rejects.toMatchObject({ code: "INTERNAL" })
    vi.stubEnv("WORKER_INTERNAL_SECRET", TEST_SECRET)
    log.mockRestore()
  })
})
