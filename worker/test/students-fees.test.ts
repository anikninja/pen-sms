/**
 * Students, fees and payments through the real Worker (workerd + local D1 + @prisma/adapter-d1),
 * mirroring the PostgreSQL API checks in scripts/e2e-api.mjs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sid, STAFF_EMAIL, startTestWorker, today, YEAR, type TestWorker } from "./harness"

// Any bcrypt hash: the Next.js server hashes passwords; the Worker only stores the hash.
const PASSWORD_HASH = "$2b$10$zYlrVsFIjKv7dBLuk0.UOeA4XY3dMrgh89IHKJrfNgGGzguGS7xPC"

let w: TestWorker
let staff: string
let byStudentId: Record<string, { id: string; programme: { id: string; code: string } }>
const idOf = (seq: number) => byStudentId[sid(seq)].id

beforeAll(async () => {
  w = await startTestWorker({ seed: true })
  staff = w.users.get(STAFF_EMAIL)!.id
  const { data } = await w.call("GET", "/v1/students", { as: staff })
  byStudentId = Object.fromEntries(data.students.map((s: { studentId: string }) => [s.studentId, s]))
})
afterAll(async () => {
  await w?.dispose()
})

const count = async (query: string) => (await w.call("GET", `/v1/students?${query}`, { as: staff })).data.students?.length

describe("students", () => {
  it("lists the six seeded students in Student ID order", async () => {
    const { status, data } = await w.call("GET", "/v1/students", { as: staff })
    expect(status).toBe(200)
    expect(data.students.map((s: { studentId: string }) => s.studentId)).toEqual([1, 2, 3, 4, 5, 6].map(sid))
    expect(data.students[0]).toMatchObject({ fullName: "Nusrat Jahan", dateOfBirth: "2004-03-14", hasLogin: true })
    expect(data.students[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/) // dates travel as ISO strings
  })

  it("searches and filters case-insensitively, in the query", async () => {
    expect(await count("q=RAHIM")).toBe(1)
    expect(await count(`q=sms-${YEAR}-0003`)).toBe(1)
    expect(await count("programme=mba")).toBe(2)
    expect(await count("status=DEFERRED")).toBe(1)
    expect(await count("programme=BSC-CS&status=ENROLLED")).toBe(3)
    expect(await count("q=zzzz")).toBe(0)
    expect((await w.call("GET", "/v1/students?status=BOGUS", { as: staff })).status).toBe(400)
  })

  it("reports malformed and unknown ids as not found", async () => {
    expect((await w.call("GET", "/v1/students/not-a-uuid", { as: staff })).status).toBe(404)
    const unknown = await w.call("GET", `/v1/students/${crypto.randomUUID()}`, { as: staff })
    expect(unknown).toMatchObject({ status: 404, data: { error: "Student not found.", code: "NOT_FOUND" } })
  })

  const newStudent = () => ({
    fullName: "Worker Created",
    email: "worker.created@student.pensms.test",
    dateOfBirth: "2005-02-10",
    programmeId: byStudentId[sid(1)].programme.id,
    academicYear: YEAR,
    passwordHash: PASSWORD_HASH,
  })

  it("creates a student with the next Student ID, the tariff fee and a login", async () => {
    const created = await w.call("POST", "/v1/students", { as: staff, body: newStudent() })
    expect(created.status).toBe(201)
    expect(created.data.student).toMatchObject({ studentId: sid(7), hasLogin: true, enrolmentStatus: "ENROLLED" })

    const fees = await w.call("GET", `/v1/students/${created.data.student.id}/fees`, { as: staff })
    expect(fees.data.summary).toMatchObject({ hasFeeAssigned: true, totalFee: "150000.00", matchesTariff: true, source: "TARIFF", status: "OVERDUE" })
    expect(fees.data.tariff).toMatchObject({ amount: "150000.00", currency: "BDT" })
  })

  it("rejects duplicates and invalid input with field errors", async () => {
    const dup = await w.call("POST", "/v1/students", { as: staff, body: { ...newStudent(), email: "Worker.Created@student.pensms.test", passwordHash: undefined } })
    expect(dup).toMatchObject({ status: 409, data: { error: "A student with this email already exists.", code: "CONFLICT" } })
    expect(dup.data.fieldErrors.email).toBeDefined()

    const invalid = await w.call("POST", "/v1/students", { as: staff, body: { ...newStudent(), email: "bad-email", fullName: "" } })
    expect(invalid.status).toBe(400)
    expect(Object.keys(invalid.data.fieldErrors).sort()).toEqual(["email", "fullName"])

    const future = await w.call("POST", "/v1/students", { as: staff, body: { ...newStudent(), email: "x1@w.test", dateOfBirth: `${YEAR + 1}-01-01` } })
    expect(future.data.fieldErrors?.dateOfBirth?.[0]).toBe("Date of birth must be in the past.")

    // The Worker takes a bcrypt hash, never a plain password.
    const plain = await w.call("POST", "/v1/students", { as: staff, body: { ...newStudent(), email: "x2@w.test", passwordHash: "Password123!" } })
    expect(plain.status).toBe(400)
    expect(plain.data.fieldErrors.passwordHash).toEqual(["Invalid password hash."])
  })

  it("gives 10 concurrent enrolments distinct, consecutive Student IDs", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        w.call("POST", "/v1/students", { as: staff, body: { ...newStudent(), email: `race${n}@w.test`, passwordHash: undefined } })
      )
    )
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201))
    const ids = results.map((r) => r.data.student.studentId).sort()
    expect(ids).toEqual(Array.from({ length: 10 }, (_, n) => sid(n + 8)))
  })

  it("updates a student without changing the Student ID or fee, and rejects clashes", async () => {
    const id = idOf(3)
    const mba = byStudentId[sid(5)].programme.id
    const updated = await w.call("PATCH", `/v1/students/${id}`, { as: staff, body: { fullName: "Abir H.", programmeId: mba } })
    expect(updated.data.student).toMatchObject({ studentId: sid(3), fullName: "Abir H.", programme: { code: "MBA" } })
    const fees = await w.call("GET", `/v1/students/${id}/fees`, { as: staff })
    expect(fees.data.summary).toMatchObject({ totalFee: "150000.00", matchesTariff: false })

    expect((await w.call("PATCH", `/v1/students/${id}`, { as: staff, body: { email: "rahim.uddin@student.pensms.test" } })).status).toBe(409)
    expect((await w.call("PATCH", `/v1/students/${id}`, { as: staff, body: {} })).status).toBe(400)
  })
})

describe("fees and payments", () => {
  const pay = (seq: number, body: object) => w.call("POST", `/v1/students/${idOf(seq)}/payments`, { as: staff, body })

  it("summarises Rahim's overdue balance exactly", async () => {
    const { data } = await w.call("GET", `/v1/students/${idOf(2)}/fees`, { as: staff })
    expect(data.summary).toMatchObject({ totalFee: "150000.00", totalPaid: "90000.00", outstanding: "60000.00", status: "OVERDUE" })
    expect(data.summary.daysOverdue).toBeGreaterThanOrEqual(29)
    expect(data.payments).toHaveLength(2)
  })

  it("validates payments with the same messages as the Next.js API", async () => {
    expect((await pay(2, { amount: "0", paymentDate: today(), referenceNumber: "W-0" })).data.error).toBe("Payment amount must be greater than zero.")
    expect((await pay(2, { amount: "1.005", paymentDate: today(), referenceNumber: "W-DP" })).data.error).toBe("Amount can have at most 2 decimal places.")
    const over = await pay(2, { amount: "60000.01", paymentDate: today(), referenceNumber: "W-OVER" })
    expect(over).toMatchObject({ status: 400, data: { error: "Payment exceeds the outstanding balance of 60,000.00 BDT." } })
    const dupRef = await pay(2, { amount: "10", paymentDate: today(), referenceNumber: `pay-${YEAR}-0001` })
    expect(dupRef).toMatchObject({ status: 409, data: { error: "This payment reference already exists." } })
    const paidUp = await pay(1, { amount: "1", paymentDate: today(), referenceNumber: "W-FULL" })
    expect(paidUp).toMatchObject({ status: 409, data: { error: "This student has already paid in full." } })
  })

  it("records a payment and recalculates the balance exactly", async () => {
    const ok = await pay(2, { amount: "10000.50", paymentDate: today(), referenceNumber: "w-0001" })
    expect(ok.status).toBe(201)
    expect(ok.data.payment).toMatchObject({ amount: "10000.50", referenceNumber: "W-0001", paymentDate: today() })
    const { data } = await w.call("GET", `/v1/students/${idOf(2)}/fees`, { as: staff })
    expect(data.summary).toMatchObject({ outstanding: "49999.50", totalPaid: "100000.50" })
  })

  it("accepts only the payment that fits when 5 concurrent 40,000 payments meet 75,000 outstanding", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => pay(4, { amount: "40000", paymentDate: today(), referenceNumber: `W-RACE-${n}` })))
    // Tanvir: 150,000 fee, 75,000 paid → 75,000 outstanding → one 40,000 fits.
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400, 400, 400])
    const { data } = await w.call("GET", `/v1/students/${idOf(4)}/fees`, { as: staff })
    expect(data.summary).toMatchObject({ totalPaid: "115000.00", outstanding: "35000.00" })
  })

  it("accepts exactly 3 of 5 concurrent 40,000 payments against a 150,000 fee", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => pay(3, { amount: "40000", paymentDate: today(), referenceNumber: `W-ABIR-${n}` })))
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 400, 400])
    const { data } = await w.call("GET", `/v1/students/${idOf(3)}/fees`, { as: staff })
    expect(data.summary).toMatchObject({ totalPaid: "120000.00", outstanding: "30000.00" })
  })

  it("accepts a duplicate reference only once under concurrency", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => pay(5, { amount: "100", paymentDate: today(), referenceNumber: "W-SAME" })))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
  })

  it("assigns fees manually and from the tariff, never below what was paid", async () => {
    const assign = (body: object) => w.call("PUT", `/v1/students/${idOf(2)}/fee`, { as: staff, body })
    const below = await assign({ source: "MANUAL", amount: "50000", dueDate: "2026-12-31" })
    expect(below).toMatchObject({ status: 400, data: { error: "Fee cannot be less than the amount already paid (100,000.50 BDT)." } })
    const manual = await assign({ source: "MANUAL", amount: "120000", dueDate: `${YEAR + 1}-01-31` })
    expect(manual.data.summary).toMatchObject({ source: "MANUAL", matchesTariff: false, status: "OUTSTANDING", totalFee: "120000.00" })
    const back = await assign({ source: "TARIFF" })
    expect(back.data.summary).toMatchObject({ totalFee: "150000.00", matchesTariff: true })
    expect((await assign({ source: "NOPE" })).status).toBe(400)
  })

  it("lists every student's fee position", async () => {
    const { status, data } = await w.call("GET", "/v1/fees", { as: staff })
    expect(status).toBe(200)
    expect(data.rows.length).toBeGreaterThanOrEqual(6)
    const overdue = await w.call("GET", "/v1/fees?status=OVERDUE", { as: staff })
    expect(overdue.data.rows.every((row: { status: string }) => row.status === "OVERDUE")).toBe(true)
    expect((await w.call("GET", "/v1/fees?status=LATE", { as: staff })).status).toBe(400)
  })
})
