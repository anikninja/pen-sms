import bcrypt from "bcryptjs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { seedD1 } from "../../prisma/d1/seed"

import { getStudentFeeSummary } from "@/lib/services/d1/fees"
import { listStudents } from "@/lib/services/d1/students"

import { asD1, createTestDb, type TestDb } from "./harness"

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

// The same data as the PostgreSQL seed (prisma/seed.ts): 7 users, 6 students, 2 programmes, 6 fees,
// 6 payments, 4 assessments, 6 submissions, 7 results.
const EXPECTED = { programmes: 2, tariffs: 2, students: 6, fees: 6, payments: 6, users: 7, assessments: 4, submissions: 6, results: 7 }

describe("D1 seed", () => {
  const now = new Date("2026-09-19T06:00:00.000Z")

  it("loads the demo data with money in minor units", async () => {
    const { counts, files } = await seedD1(asD1(t.db), now)
    expect(counts).toEqual(EXPECTED)
    expect(files).toHaveLength(6)
    expect(new TextDecoder().decode(files[0].bytes)).toMatch(/^%PDF-1\.4[\s\S]*%%EOF\n$/)

    const tariff = await t.db.programmeFee.findFirst({ where: { programme: { code: "MBA" } } })
    expect(tariff?.amount).toBe(25000000n)
    expect(await t.db.submission.count({ where: { isLate: true } })).toBe(1)
    expect(await t.db.result.count({ where: { published: true } })).toBe(4)
  })

  it("is idempotent", async () => {
    const { counts } = await seedD1(asD1(t.db), now)
    expect(counts).toEqual(EXPECTED)
  })

  it("produces the documented fee scenarios", async () => {
    const [rahim] = await listStudents(asD1(t.db), { q: "Rahim" })
    expect(await getStudentFeeSummary(asD1(t.db), rahim.id, now)).toMatchObject({
      totalFee: "150000.00",
      totalPaid: "90000.00",
      outstanding: "60000.00",
      status: "OVERDUE",
      matchesTariff: true,
    })
    const [abir] = await listStudents(asD1(t.db), { q: "abir" })
    expect((await getStudentFeeSummary(asD1(t.db), abir.id, now)).outstanding).toBe("150000.00")
  })

  it("uses the public demo password by default, and a given password instead of it", async () => {
    // Every demo account gets the same hash, so one comparison covers all of them.
    const distinctHashes = async () => [...new Set((await t.db.user.findMany({ select: { passwordHash: true } })).map((user) => user.passwordHash))]

    const [publicHash, ...otherPublic] = await distinctHashes()
    expect(otherPublic).toEqual([])
    expect(await bcrypt.compare("Password123!", publicHash)).toBe(true)

    await seedD1(asD1(t.db), now, { password: "a-private-demo-password" })
    const [privateHash, ...otherPrivate] = await distinctHashes()
    expect(otherPrivate).toEqual([])
    expect(await t.db.user.count()).toBe(EXPECTED.users)
    expect(await bcrypt.compare("a-private-demo-password", privateHash)).toBe(true)
    expect(await bcrypt.compare("Password123!", privateHash)).toBe(false)
  }, 30_000)
})
