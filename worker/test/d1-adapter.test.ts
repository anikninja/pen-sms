/**
 * Behaviour that only the real D1 + @prisma/adapter-d1 stack shows (Phase 3 could not test it with
 * the native SQLite engine): bound-parameter limits with many rows, DateTime encoding, money
 * round trips at the limits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { parseMoney } from "@/lib/money"

import { STAFF_EMAIL, startTestWorker, today, withAdapterDb, YEAR, type TestWorker } from "./harness"

const STUDENTS = 130 // more than the adapter's 98 bound values per statement
const ASSESSMENTS = 110
let w: TestWorker
let staff: string

beforeAll(async () => {
  w = await startTestWorker({
    seed: true,
    prepare: async (db) => {
      const programme = await db.programme.findUniqueOrThrow({ where: { code: "BSC-CS" } })
      for (let n = 0; n < STUDENTS; n++) {
        const student = await db.student.create({
          data: {
            studentId: `SMS-${YEAR - 1}-${String(n + 1).padStart(4, "0")}`,
            fullName: `Bulk Student ${n}`,
            email: `bulk${n}@bulk.test`,
            dateOfBirth: new Date("2004-01-01T00:00:00.000Z"),
            programmeId: programme.id,
            academicYear: YEAR - 1,
          },
        })
        await db.studentFee.create({
          data: { studentId: student.id, amount: parseMoney("1000.00"), currency: "BDT", dueDate: new Date("2020-01-31T00:00:00.000Z") },
        })
        if (n % 2 === 0) {
          await db.payment.create({
            data: { studentId: student.id, amount: parseMoney("250.25"), paymentDate: new Date("2020-01-15T00:00:00.000Z"), referenceNumber: `BULK-${n}` },
          })
        }
      }
      const mba = await db.programme.findUniqueOrThrow({ where: { code: "MBA" } })
      for (let n = 0; n < ASSESSMENTS; n++) {
        await db.assessment.create({
          data: { programmeId: mba.id, title: `Bulk Assessment ${n}`, module: "Bulk", submissionDeadline: new Date(Date.now() + (n + 1) * 86_400_000) },
        })
      }
    },
  })
  staff = w.users.get(STAFF_EMAIL)!.id
}, 600_000)
afterAll(async () => {
  await w?.dispose()
})

describe("many rows through the adapter (bound-parameter limit)", () => {
  it("loads relations and aggregates for 136 students", async () => {
    const { status, data } = await w.call("GET", "/v1/views/dashboard", { as: staff })
    expect(status).toBe(200)
    expect(data.totalStudents).toBe(STUDENTS + 6)
    expect(data.overdueStudents).toBe(STUDENTS + 3)
    // Bulk: 65 × 749.75 + 65 × 1,000 = 113,733.75. Seeded: 60,000 + 150,000 + 75,000 overdue
    // + 150,000 not yet due = 435,000. All BDT, summed exactly.
    expect(data.totalOutstanding).toEqual([{ currency: "BDT", amount: "548733.75" }])
  })

  it("lists every student with a submission/grade row per assessment", async () => {
    const grading = await w.call("GET", "/v1/views/assessments/5e3d0a1c-0000-4000-8000-000000000101", { as: staff })
    expect(grading.status).toBe(200)
    // All ENROLLED BSC-CS students, including the 130 bulk ones.
    expect(grading.data.grading.counts.students).toBe(STUDENTS + 4)
  })

  it("counts submissions and results for 114 assessments", async () => {
    const { status, data } = await w.call("GET", "/v1/assessments", { as: staff })
    expect(status).toBe(200)
    expect(data.assessments).toHaveLength(ASSESSMENTS + 4)
    expect(data.assessments.find((a: { id: string }) => a.id === "5e3d0a1c-0000-4000-8000-000000000101")).toMatchObject({ submissionCount: 3, gradedCount: 4 })
  })

  it("lists a student's 112 programme assessments with their own submissions", async () => {
    const farhana = w.users.get("farhana.akter@sms.inxapp.net")!.id
    const { status, data } = await w.call("GET", "/v1/me/assessments", { as: farhana })
    expect(status).toBe(200)
    expect(data.assessments).toHaveLength(ASSESSMENTS + 2)
    expect(data.assessments.filter((a: { submission: unknown }) => a.submission)).toHaveLength(1) // Business Strategy Report
  })

  it("searches across all of them", async () => {
    const { data } = await w.call("GET", "/v1/students?q=bulk%20student", { as: staff })
    expect(data.students).toHaveLength(STUDENTS)
  })
})

describe("storage encoding", () => {
  it("stores DateTime as ISO-8601 text and money as exact integers of minor units", async () => {
    const pay = await w.call("POST", `/v1/students/${(await w.call("GET", "/v1/students?q=Farhana", { as: staff })).data.students[0].id}/payments`, {
      as: staff,
      body: { amount: "0.01", paymentDate: today(), referenceNumber: "ENC-1" },
    })
    expect(pay.status).toBe(201)
    await w.stop() // release the database before reading it directly

    const rows = await withAdapterDb(w.dir, (db) =>
      db.$queryRaw<{ t: string; v: string; at: string; a: number }[]>`
        SELECT typeof("paymentDate") AS t, "paymentDate" AS v, typeof("amount") AS at, "amount" AS a
        FROM "Payment" WHERE "referenceNumber" = 'ENC-1'`
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].t).toBe("text") // stored as ISO-8601 text…
    expect(new Date(rows[0].v).toISOString()).toBe(`${today()}T00:00:00.000Z`) // …which Prisma reads back as a Date
    expect(rows[0].at).toBe("integer")
    expect(Number(rows[0].a)).toBe(1)
  })
})
