import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { formatStudentId } from "@/lib/domain/student-id"
import { isUniqueViolation, toDomainError, uniqueViolation } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
import { listStudents } from "@/lib/services/d1/students"

import { addPayment, addProgramme, addStudent, asD1, createTestDb, YEAR, type TestDb } from "./harness"

let t: TestDb
let db: D1Client

beforeAll(async () => {
  t = await createTestDb()
  db = asD1(t.db)
  const cs = (await addProgramme(t.db, "BSC-CS")).programme
  const mba = (await addProgramme(t.db, "MBA")).programme
  const rahim = await addStudent(t.db, cs.id, formatStudentId(YEAR, 1), { fullName: "Rahim Uddin", email: "rahim@x.test" })
  await addStudent(t.db, cs.id, formatStudentId(YEAR, 2), { fullName: "Nusrat Jahan", email: "nusrat@x.test" })
  const farhana = await addStudent(t.db, mba.id, formatStudentId(YEAR, 3), { fullName: "Farhana Akter", email: "farhana@x.test" })
  await t.db.student.update({ where: { id: farhana.id }, data: { enrolmentStatus: "DEFERRED" } })
  await addPayment(t.db, rahim.id, 100n, "UNIQUE-REF")
})
afterAll(async () => {
  await t.close()
})

const names = async (search: Parameters<typeof listStudents>[1]) => (await listStudents(db, search)).map((student) => student.fullName)

describe("listStudents search (D1) — case-insensitive like PostgreSQL's mode: insensitive", () => {
  it("matches names in any case", async () => {
    expect(await names({ q: "rahim" })).toEqual(["Rahim Uddin"])
    expect(await names({ q: "RAHIM" })).toEqual(["Rahim Uddin"])
    expect(await names({ q: "rAhIm uDdIn" })).toEqual(["Rahim Uddin"])
  })

  it("matches exact names and partial names", async () => {
    expect(await names({ q: "Nusrat Jahan" })).toEqual(["Nusrat Jahan"])
    expect(await names({ q: "akt" })).toEqual(["Farhana Akter"])
    expect(await names({ q: "an" })).toEqual(["Nusrat Jahan", "Farhana Akter"]) // ordered by Student ID
  })

  it("matches Student IDs in any case and in part", async () => {
    expect(await names({ q: `sms-${YEAR}-0002` })).toEqual(["Nusrat Jahan"])
    expect(await names({ q: `SMS-${YEAR}-000` })).toHaveLength(3)
    expect(await names({ q: "-0003" })).toEqual(["Farhana Akter"])
  })

  it("filters by programme code in any case, exactly", async () => {
    expect(await names({ programme: "bsc-cs" })).toEqual(["Rahim Uddin", "Nusrat Jahan"])
    expect(await names({ programme: "BSC-CS" })).toEqual(["Rahim Uddin", "Nusrat Jahan"])
    expect(await names({ programme: "Mba" })).toEqual(["Farhana Akter"])
    expect(await names({ programme: "BSC" })).toEqual([]) // equality, not a partial match
    expect(await names({ programme: "LAW" })).toEqual([])
  })

  it("combines search, programme and status", async () => {
    expect(await names({ q: "a", programme: "mba", status: "DEFERRED" })).toEqual(["Farhana Akter"])
    expect(await names({ q: "a", programme: "mba", status: "ENROLLED" })).toEqual([])
    expect(await names({ q: "zzz" })).toEqual([])
    expect(await names({})).toHaveLength(3)
  })
})

describe("Prisma errors from SQLite (the shapes D1 code will see)", () => {
  it("model unique violation: P2002 with the field list", async () => {
    const error = await t.db.student
      .create({ data: { studentId: "X-1", fullName: "X", email: "rahim@x.test", dateOfBirth: new Date(0), programmeId: "nope", academicYear: YEAR } })
      .catch((reason: unknown) => reason)
    expect(uniqueViolation(error)).toEqual({ fields: ["email"], constraint: null })
    expect(isUniqueViolation(error, "email")).toBe(true)
  })

  it("raw-SQL unique violation: P2010, recognised from the SQLite message", async () => {
    const error = await t.db
      .$executeRawUnsafe(`INSERT INTO "Payment" (id, studentId, amount, paymentDate, referenceNumber, updatedAt) SELECT 'p2', studentId, 1, 0, 'UNIQUE-REF', 0 FROM "Payment" LIMIT 1`)
      .catch((reason: unknown) => reason)
    expect((error as { code?: string }).code).toBe("P2010")
    expect(isUniqueViolation(error, "referenceNumber")).toBe(true)
    expect(toDomainError(error)).toMatchObject({ code: "CONFLICT" })
  })

  it("CHECK violations are not mistaken for unique violations", async () => {
    const error = await t.db
      .$executeRawUnsafe(`INSERT INTO "Payment" (id, studentId, amount, paymentDate, referenceNumber, updatedAt) SELECT 'p3', studentId, 1.5, 0, 'R-CHECK', 0 FROM "Payment" LIMIT 1`)
      .catch((reason: unknown) => reason)
    expect(String((error as Error).message)).toMatch(/CHECK constraint failed: Payment_amount_check/)
    expect(uniqueViolation(error)).toBeNull()
  })
})

describe("D1 code never relies on Prisma transactions", () => {
  // On D1, Prisma's interactive AND batch transactions run as individual queries (adapter-d1 6.12).
  const d1Sources = [
    ...readdirSync(path.join(process.cwd(), "src/lib/services/d1")).map((file) => path.join("src/lib/services/d1", file)),
    "prisma/d1/seed.ts",
  ]

  it.each(d1Sources)("%s does not call $transaction", (file) => {
    const code = readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    expect(code).not.toMatch(/\$transaction\s*\(/)
  })
})
