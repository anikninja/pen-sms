import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addProgramme, addStudent, createTestDb, type TestDb } from "./harness"

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe("D1 test harness", () => {
  it("builds the database from the D1 baseline, CHECK constraints included", async () => {
    const tables = await t.db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    expect(tables.map((row) => row.name)).toEqual([
      "Assessment", "Payment", "Programme", "ProgrammeFee", "Result", "Student", "StudentFee", "Submission", "User",
    ])
    const { programme } = await addProgramme(t.db, "CHK")
    const student = await addStudent(t.db, programme.id, "SMS-2026-0001")
    await expect(
      t.db.$executeRawUnsafe(
        `INSERT INTO "User" (id, email, name, passwordHash, role, studentId, updatedAt) VALUES ('u', 'u@x.test', 'U', 'h', 'STAFF', '${student.id}', 0)`
      )
    ).rejects.toThrow(/User_role_student_link_check/)
  })

  it("enforces foreign keys, as D1 always does", async () => {
    await expect(
      t.db.$executeRawUnsafe(`INSERT INTO "Payment" (id, studentId, amount, paymentDate, referenceNumber, updatedAt) VALUES ('p', 'missing', 1, 0, 'R', 0)`)
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it("resets between tests", async () => {
    await t.reset()
    expect(await t.db.student.count()).toBe(0)
  })
})
