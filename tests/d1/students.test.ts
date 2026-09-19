import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { PrismaClient } from ".prisma/client-d1"

import { formatStudentId } from "@/lib/domain/student-id"
import { DomainError } from "@/lib/errors"
import { parseMoney } from "@/lib/money"
import type { D1Client } from "@/lib/services/d1/client"
import { createStudent, getStudent, updateStudent, type D1StudentCreateInput } from "@/lib/services/d1/students"
import { DUPLICATE_EMAIL, DUPLICATE_LOGIN } from "@/lib/services/shared/students"

import { addProgramme, addStudent, asD1, createTestDb, race, YEAR, type TestDb } from "./harness"

let t: TestDb
let db: D1Client
let programmeId: string

beforeAll(async () => {
  t = await createTestDb()
  db = asD1(t.db)
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
  const { programme } = await addProgramme(t.db, "BSC-CS", {
    tariff: { amount: parseMoney("150000.00"), dueDate: new Date("2026-10-31T00:00:00.000Z") },
  })
  programmeId = programme.id
})

// Any bcrypt hash: the Next.js server hashes passwords, the D1 service only stores the hash.
const PASSWORD_HASH = "$2b$10$zYlrVsFIjKv7dBLuk0.UOeA4XY3dMrgh89IHKJrfNgGGzguGS7xPC"

const input = (overrides: Partial<D1StudentCreateInput> = {}): D1StudentCreateInput => ({
  fullName: "New Student",
  email: `new-${Math.random().toString(36).slice(2)}@x.test`,
  dateOfBirth: "2004-05-01",
  programmeId,
  academicYear: YEAR,
  enrolmentStatus: "ENROLLED",
  ...overrides,
})

const expectDomainError = async (promise: Promise<unknown>, code: string, message?: string) => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(DomainError)
  expect((error as DomainError).code).toBe(code)
  if (message) expect((error as DomainError).message).toBe(message)
  return error as DomainError
}

describe("Student ID generation (D1)", () => {
  it("gives the first student of a year 0001", async () => {
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0001`)
  })

  it("continues from the highest existing sequence", async () => {
    await createStudent(db, input())
    await createStudent(db, input())
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0003`)
  })

  it("does not reuse gaps: MAX + 1", async () => {
    for (const sequence of [1, 2, 5]) await addStudent(t.db, programmeId, formatStudentId(YEAR, sequence))
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0006`)
  })

  it("counts short sequences that are all digits, as PostgreSQL's ^SMS-<year>-[0-9]+$ does", async () => {
    await addStudent(t.db, programmeId, `SMS-${YEAR}-12`)
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0013`)
  })

  it("ignores malformed IDs and other years", async () => {
    for (const id of [
      `SMS-${YEAR}-9999X`,
      `SMS-${YEAR}-12A4`,
      `sms-${YEAR}-9000`, // wrong case
      `SMS-${YEAR}-`,
      `SMS-${YEAR}--500`,
      `XSMS-${YEAR}-8000`,
      `SMS-${YEAR}-00 7`,
      `SMS-${YEAR - 1}-0777`,
    ]) {
      await addStudent(t.db, programmeId, id, { email: `${Math.random()}@x.test` })
    }
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0001`)
  })

  it("numbers each year independently", async () => {
    await addStudent(t.db, programmeId, `SMS-${YEAR - 1}-0041`)
    expect((await createStudent(db, input({ academicYear: YEAR - 1 }))).studentId).toBe(`SMS-${YEAR - 1}-0042`)
    expect((await createStudent(db, input())).studentId).toBe(`SMS-${YEAR}-0001`)
  })

  it("formats exactly like formatStudentId across the padding boundaries", async () => {
    for (const [existing, next] of [
      [8, 9],
      [9, 10],
      [99, 100],
      [999, 1000],
      [9998, 9999],
      [9999, 10000],
      [123455, 123456],
    ]) {
      await t.reset()
      const { programme } = await addProgramme(t.db, `P${existing}`)
      await addStudent(t.db, programme.id, formatStudentId(YEAR, existing))
      const created = await createStudent(db, input({ programmeId: programme.id }))
      expect(created.studentId).toBe(formatStudentId(YEAR, next))
    }
  })

  it("gives 20 concurrent enrolments distinct, consecutive IDs", async () => {
    await addStudent(t.db, programmeId, formatStudentId(YEAR, 7))
    const { fulfilled, rejected } = await race(20, (n) => createStudent(db, input({ email: `race${n}@x.test` })))
    expect(rejected).toEqual([])
    const ids = fulfilled.map((student) => student.studentId).sort()
    expect(ids).toEqual(Array.from({ length: 20 }, (_, n) => formatStudentId(YEAR, n + 8)))
    expect(await t.db.student.count()).toBe(21)
    expect(await t.db.studentFee.count()).toBe(20)
  })

  it("negative control: reading MAX first and inserting afterwards collides under the same harness", async () => {
    // Proves the concurrency test above can fail: this is the PostgreSQL logic without its lock.
    const naiveCreate = async (n: number) => {
      const rows = await t.db.student.findMany({ where: { studentId: { startsWith: `SMS-${YEAR}-` } }, select: { studentId: true } })
      const max = Math.max(0, ...rows.map((row) => Number(row.studentId.slice(9))))
      await addStudent(t.db, programmeId, formatStudentId(YEAR, max + 1), { email: `naive${n}@x.test` })
    }
    const { rejected } = await race(10, naiveCreate)
    expect(rejected.length).toBeGreaterThan(0) // unique-index violations: several requests picked the same ID
  })

  it("keeps concurrent enrolments for different years apart", async () => {
    const { fulfilled } = await race(10, (n) => createStudent(db, input({ academicYear: n % 2 ? YEAR : YEAR - 1, email: `y${n}@x.test` })))
    const byYear = (year: number) => fulfilled.filter((s) => s.academicYear === year).map((s) => s.studentId).sort()
    expect(byYear(YEAR)).toEqual([1, 2, 3, 4, 5].map((n) => formatStudentId(YEAR, n)))
    expect(byYear(YEAR - 1)).toEqual([1, 2, 3, 4, 5].map((n) => formatStudentId(YEAR - 1, n)))
  })
})

describe("createStudent (D1)", () => {
  it("copies the tariff into the student's fee, as a snapshot", async () => {
    const student = await createStudent(db, input())
    const fee = await t.db.studentFee.findUnique({ where: { studentId: student.id } })
    const tariff = await t.db.programmeFee.findFirst({ where: { programmeId } })
    expect(fee).toMatchObject({ amount: 15000000n, currency: "BDT", programmeFeeId: tariff!.id })
    expect(fee!.dueDate.toISOString()).toBe("2026-10-31T00:00:00.000Z")
    expect(student).toMatchObject({ fullName: "New Student", dateOfBirth: "2004-05-01", hasLogin: false, programme: { code: "BSC-CS" } })
  })

  it("creates no fee when the programme has no tariff for the year", async () => {
    const student = await createStudent(db, input({ academicYear: YEAR - 1 }))
    expect(await t.db.studentFee.count({ where: { studentId: student.id } })).toBe(0)
  })

  it("creates a STUDENT login with the given password hash", async () => {
    const student = await createStudent(db, input({ email: "login@x.test", passwordHash: PASSWORD_HASH }))
    expect(student.hasLogin).toBe(true)
    const user = await t.db.user.findUnique({ where: { email: "login@x.test" } })
    expect(user).toMatchObject({ role: "STUDENT", studentId: student.id, name: "New Student" })
    expect(user!.passwordHash).toBe(PASSWORD_HASH)
  })

  it("rejects a duplicate student email and leaves nothing behind", async () => {
    await createStudent(db, input({ email: "dup@x.test" }))
    await expectDomainError(createStudent(db, input({ email: "dup@x.test" })), "CONFLICT", DUPLICATE_EMAIL)
    expect(await t.db.student.count()).toBe(1)
  })

  it("rejects an email that already has a login before writing anything", async () => {
    await t.db.user.create({ data: { email: "staff@x.test", name: "Staff", passwordHash: "x", role: "STAFF" } })
    await expectDomainError(createStudent(db, input({ email: "staff@x.test", passwordHash: PASSWORD_HASH })), "CONFLICT", DUPLICATE_LOGIN)
    expect(await t.db.student.count()).toBe(0)
  })

  it("rolls the student back when the login insert fails after the student exists (compensation)", async () => {
    // Another request creates a login with the same email between the pre-check and the insert.
    const sabotaged = withLoginRace(t.db)
    await expectDomainError(createStudent(sabotaged, input({ email: "late@x.test", passwordHash: PASSWORD_HASH })), "CONFLICT", DUPLICATE_EMAIL)
    expect(await t.db.student.count()).toBe(0)
    expect(await t.db.studentFee.count()).toBe(0)
    expect(await t.db.user.count({ where: { email: "late@x.test", role: "STAFF" } })).toBe(1) // the other request's login stays
  })

  it("rejects unknown and inactive programmes", async () => {
    await expectDomainError(createStudent(db, input({ programmeId: crypto.randomUUID() })), "VALIDATION", "Choose a valid programme.")
    const { programme } = await addProgramme(t.db, "OLD", { active: false })
    await expectDomainError(createStudent(db, input({ programmeId: programme.id })), "VALIDATION", "This programme is not active.")
  })
})

describe("updateStudent (D1)", () => {
  it("updates the student and keeps the login's email and name in step", async () => {
    const student = await createStudent(db, input({ email: "a@x.test", passwordHash: PASSWORD_HASH }))
    const updated = await updateStudent(db, student.id, { fullName: "Renamed", email: "renamed@x.test" })
    expect(updated).toMatchObject({ fullName: "Renamed", email: "renamed@x.test", studentId: student.studentId })
    expect(await t.db.user.findFirst({ where: { studentId: student.id } })).toMatchObject({ email: "renamed@x.test", name: "Renamed" })
  })

  it("restores the login when the student update fails (compensation)", async () => {
    const a = await createStudent(db, input({ email: "a@x.test", fullName: "A", passwordHash: PASSWORD_HASH }))
    await createStudent(db, input({ email: "b@x.test" })) // B has no login, so only Student.email clashes
    await expectDomainError(updateStudent(db, a.id, { email: "b@x.test", fullName: "A2" }), "CONFLICT", DUPLICATE_EMAIL)
    expect(await getStudent(db, a.id)).toMatchObject({ email: "a@x.test", fullName: "A" })
    expect(await t.db.user.findFirst({ where: { studentId: a.id } })).toMatchObject({ email: "a@x.test", name: "A" })
  })

  it("changes nothing when the login email clashes with another login", async () => {
    await t.db.user.create({ data: { email: "staff@x.test", name: "Staff", passwordHash: "x", role: "STAFF" } })
    const a = await createStudent(db, input({ email: "a@x.test", passwordHash: PASSWORD_HASH }))
    await expectDomainError(updateStudent(db, a.id, { email: "staff@x.test" }), "CONFLICT", DUPLICATE_EMAIL)
    expect(await getStudent(db, a.id)).toMatchObject({ email: "a@x.test" })
  })

  it("never changes the Student ID or the assigned fee", async () => {
    const student = await createStudent(db, input())
    const { programme } = await addProgramme(t.db, "MBA")
    const updated = await updateStudent(db, student.id, { programmeId: programme.id })
    expect(updated.studentId).toBe(student.studentId)
    expect((await t.db.studentFee.findUnique({ where: { studentId: student.id } }))?.amount).toBe(15000000n)
  })

  it("reports unknown students", async () => {
    await expectDomainError(updateStudent(db, crypto.randomUUID(), { fullName: "X" }), "NOT_FOUND", "Student not found.")
  })
})

/** The client, except that right before creating a login another request creates one with the same email. */
function withLoginRace(client: PrismaClient): D1Client {
  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop, target)
    return typeof value === "function" ? value.bind(target) : value
  }
  const user = new Proxy(client.user, {
    get(target, prop) {
      if (prop !== "create") return bind(target, prop)
      return async (args: { data: { email: string } }) => {
        await client.user.create({ data: { email: args.data.email, name: "Other request", passwordHash: "x", role: "STAFF" } })
        return target.create(args as Parameters<typeof target.create>[0])
      }
    },
  })
  return new Proxy(client, { get: (target, prop) => (prop === "user" ? user : bind(target, prop)) })
}
