/** Assessments, results, the student's own data and the page views, through the real Worker. */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ASSESSMENT, sid, STAFF_EMAIL, startTestWorker, type TestWorker } from "./harness"

let w: TestWorker
let staff: string
let nusrat: string
let rahim: string
let farhana: string
let idOf: (seq: number) => string
let programmeIdOf: (seq: number) => string

beforeAll(async () => {
  w = await startTestWorker({ seed: true })
  staff = w.users.get(STAFF_EMAIL)!.id
  nusrat = w.users.get("nusrat.jahan@sms.inxapp.net")!.id
  rahim = w.users.get("rahim.uddin@sms.inxapp.net")!.id
  farhana = w.users.get("farhana.akter@sms.inxapp.net")!.id
  const { data } = await w.call("GET", "/v1/students", { as: staff })
  const bySid = Object.fromEntries(data.students.map((s: { studentId: string }) => [s.studentId, s]))
  idOf = (seq) => bySid[sid(seq)].id
  programmeIdOf = (seq) => bySid[sid(seq)].programme.id
})
afterAll(async () => {
  await w?.dispose()
})

describe("assessments", () => {
  it("lists all assessments for staff with submission and grade counts", async () => {
    const { data } = await w.call("GET", "/v1/assessments", { as: staff })
    expect(data.assessments).toHaveLength(4)
    const db = data.assessments.find((a: { id: string }) => a.id === ASSESSMENT.DB)
    expect(db).toMatchObject({ submissionCount: 3, gradedCount: 4, isPastDeadline: true, programme: { code: "BSC-CS" } })
    const mba = await w.call("GET", `/v1/assessments?programmeId=${programmeIdOf(5)}`, { as: staff })
    expect(mba.data.assessments).toHaveLength(2)
  })

  it("shows a student only their programme's assessments with their own submission", async () => {
    const { data } = await w.call("GET", "/v1/assessments", { as: rahim })
    expect(data.assessments.map((a: { id: string }) => a.id).sort()).toEqual([ASSESSMENT.DB, ASSESSMENT.ALGO].sort())
    const db = data.assessments.find((a: { id: string }) => a.id === ASSESSMENT.DB)
    expect(db).toMatchObject({ status: "LATE", canUpload: false })
    expect(db.uploadBlockedReason).toMatch(/^The deadline has passed/)
    expect(JSON.stringify(data)).not.toContain("Nusrat")
  })

  it("creates, validates, closes and protects assessments", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const created = await w.call("POST", "/v1/assessments", {
      as: staff,
      body: { programmeId: programmeIdOf(1), title: "Worker Past", module: "Testing", submissionDeadline: past },
    })
    expect(created.status).toBe(201)
    expect(created.data.warnings).toEqual(["The deadline is already in the past, so every submission will be marked late."])

    const missing = await w.call("POST", "/v1/assessments", { as: staff, body: { programmeId: programmeIdOf(1), title: " ", module: "", submissionDeadline: past } })
    expect(Object.keys(missing.data.fieldErrors).sort()).toEqual(["module", "title"])
    const noTz = await w.call("POST", "/v1/assessments", { as: staff, body: { programmeId: programmeIdOf(1), title: "X", module: "Y", submissionDeadline: "2026-12-01T10:00" } })
    expect(noTz.status).toBe(400)

    const move = await w.call("PATCH", `/v1/assessments/${ASSESSMENT.DB}`, { as: staff, body: { programmeId: programmeIdOf(5) } })
    expect(move).toMatchObject({ status: 409, data: { error: "The programme cannot change after submissions or results exist." } })

    const id = created.data.assessment.id
    const moveEmpty = await w.call("PATCH", `/v1/assessments/${id}`, { as: staff, body: { programmeId: programmeIdOf(5), title: "Moved" } })
    expect(moveEmpty.data.assessment).toMatchObject({ title: "Moved", programme: { code: "MBA" } })
    const close = await w.call("PATCH", `/v1/assessments/${id}`, { as: staff, body: { isOpen: false } })
    expect(close.data.assessment.isOpen).toBe(false)
    expect((await w.call("GET", `/v1/assessments/${crypto.randomUUID()}`, { as: staff })).status).toBe(404)
  })

  it("refuses assessment writes from students", async () => {
    const r = await w.call("PATCH", `/v1/assessments/${ASSESSMENT.ALGO}`, { as: rahim, body: { isOpen: false } })
    expect(r.status).toBe(403)
  })
})

describe("results", () => {
  const grade = (seq: number, assessmentId: string, body: object, as = staff) =>
    w.call("PUT", `/v1/students/${idOf(seq)}/results/${assessmentId}`, { as, body })

  it("validates grades and the programme rule", async () => {
    expect((await grade(3, ASSESSMENT.DB, { grade: 101 })).data.error).toBe("Grade must be between 0 and 100.")
    expect((await grade(3, ASSESSMENT.DB, { grade: 70.5 })).data.error).toBe("Grade must be a whole number.")
    const wrong = await grade(5, ASSESSMENT.DB, { grade: 50 })
    expect(wrong).toMatchObject({ status: 409, data: { error: "This student is not in the assessment's programme." } })
    expect((await w.call("PUT", `/v1/students/${crypto.randomUUID()}/results/${ASSESSMENT.DB}`, { as: staff, body: { grade: 1 } })).status).toBe(404)
    expect((await grade(2, ASSESSMENT.ALGO, { grade: 100 }, rahim)).status).toBe(403)
  })

  it("re-grades in place, keeping the publish state; a new grade starts withheld", async () => {
    const regrade = await grade(1, ASSESSMENT.DB, { grade: 79 }) // published before
    expect(regrade.data.result).toMatchObject({ grade: 79, classification: "Distinction", published: true })
    const fresh = await grade(2, ASSESSMENT.ALGO, { grade: "69" })
    expect(fresh.data.result).toMatchObject({ grade: 69, classification: "Merit", published: false })
  })

  it("keeps one result per student and assessment under concurrent grading", async () => {
    const results = await Promise.all([41, 42, 43, 44, 45].map((g) => grade(3, ASSESSMENT.ALGO, { grade: g })))
    expect(results.every((r) => r.status === 200)).toBe(true)
    const { data } = await w.call("GET", `/v1/views/students/${idOf(3)}`, { as: staff })
    expect(data.results.filter((r: { assessmentId: string }) => r.assessmentId === ASSESSMENT.ALGO)).toHaveLength(1)
  })

  it("shows students their published results only", async () => {
    const before = await w.call("GET", "/v1/me/marksheet", { as: nusrat })
    expect(before.data.results.map((r: { grade: number }) => r.grade)).toEqual([79])
    expect(JSON.stringify(before.data)).not.toMatch(/82|published/)

    const pub = await w.call("PATCH", `/v1/students/${idOf(1)}/results/${ASSESSMENT.ALGO}`, { as: staff, body: { published: true } })
    expect(pub.data.result.published).toBe(true)
    expect((await w.call("GET", "/v1/me/marksheet", { as: nusrat })).data.results).toHaveLength(2)

    const withhold = await w.call("POST", `/v1/students/${idOf(1)}/results/publish`, { as: staff, body: { published: false } })
    expect(withhold.data).toEqual({ updated: 2 })
    expect((await w.call("GET", "/v1/me/marksheet", { as: nusrat })).data.results).toHaveLength(0)

    const byAssessment = await w.call("POST", `/v1/assessments/${ASSESSMENT.DB}/results/publish`, { as: staff, body: { published: true } })
    expect(byAssessment.data.updated).toBeGreaterThanOrEqual(4)

    const missing = await w.call("PATCH", `/v1/students/${idOf(5)}/results/${ASSESSMENT.ALGO}`, { as: staff, body: { published: true } })
    expect(missing).toMatchObject({ status: 404, data: { error: "No grade has been entered for this student and assessment yet." } })
    expect((await w.call("PATCH", `/v1/students/${idOf(1)}/results/${ASSESSMENT.ALGO}`, { as: staff, body: { published: "yes" } })).status).toBe(400)
  })
})

describe("the signed-in student's own data", () => {
  it("returns the student dashboard and fees for the session's student only", async () => {
    const overview = await w.call("GET", "/v1/me/overview", { as: rahim })
    expect(overview.data.student).toMatchObject({ studentId: sid(2), fullName: "Rahim Uddin" })
    expect(overview.data.fee).toMatchObject({ outstanding: "60000.00", status: "OVERDUE" })
    expect(overview.data.nextDeadline?.id).toBe(ASSESSMENT.ALGO)

    const fees = await w.call("GET", "/v1/me/fees", { as: farhana })
    expect(fees.data.summary).toMatchObject({ outstanding: "150000.00", status: "OUTSTANDING" })
    expect(fees.data.payments).toHaveLength(1)
  })

  it("ignores any student id in the request", async () => {
    const r = await w.call("GET", `/v1/me/fees?studentId=${idOf(1)}`, { as: rahim })
    expect(r.data.summary.totalPaid).toBe("90000.00") // Rahim's, not Nusrat's
  })
})

describe("page views (one request per page)", () => {
  it("builds the staff dashboard", async () => {
    const { data } = await w.call("GET", "/v1/views/dashboard", { as: staff })
    expect(data).toMatchObject({ totalStudents: 6, enrolledStudents: 4, overdueStudents: 3 })
    expect(data.totalOutstanding).toEqual([{ currency: "BDT", amount: expect.any(String) }])
    expect(data.overdue.map((row: { student: { studentId: string } }) => row.student.studentId).sort()).toEqual([sid(2), sid(3), sid(4)])
  })

  it("builds the student, assessment and results pages", async () => {
    const student = await w.call("GET", `/v1/views/students/${idOf(2)}`, { as: staff })
    expect(Object.keys(student.data).sort()).toEqual(["assessments", "fees", "results", "student"])
    expect(student.data.fees.summary.totalFee).toBe("150000.00")
    expect((await w.call("GET", `/v1/views/students/${crypto.randomUUID()}`, { as: staff })).status).toBe(404)

    const assessment = await w.call("GET", `/v1/views/assessments/${ASSESSMENT.DB}`, { as: staff })
    expect(assessment.data.grading.counts).toMatchObject({ students: 4, submitted: 3, late: 1 })
    expect(assessment.data.programmes.length).toBe(2)

    const results = await w.call("GET", "/v1/views/results", { as: staff })
    expect(results.data.selectedId).toEqual(expect.any(String))
    expect(results.data.grading.rows.length).toBeGreaterThan(0)
    const unknown = await w.call("GET", `/v1/views/results?assessment=${crypto.randomUUID()}`, { as: staff })
    expect(unknown.data).toMatchObject({ selectedId: null, grading: null })

    const byCode = await w.call("GET", "/v1/views/assessments?programme=MBA", { as: staff })
    expect(byCode.data.assessments.every((a: { programme: { code: string } }) => a.programme.code === "MBA")).toBe(true)

    const list = await w.call("GET", "/v1/views/students?programme=mba", { as: staff })
    expect(list.data.students).toHaveLength(2)
    expect(list.data.programmes).toHaveLength(2)
  })

  it("is staff-only", async () => {
    expect((await w.call("GET", "/v1/views/dashboard", { as: rahim })).status).toBe(403)
  })
})
