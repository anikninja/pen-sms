import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { formatStudentId } from "@/lib/domain/student-id"
import { DomainError } from "@/lib/errors"
import { formatMoney, parseMoney } from "@/lib/money"
import type { D1Client } from "@/lib/services/d1/client"
import { assignStudentFee, createPayment, getOverdueStudents, getStudentFeeSummary, totalPaid } from "@/lib/services/d1/fees"
import { createStudent } from "@/lib/services/d1/students"
import { DUPLICATE_PAYMENT_REFERENCE, NO_TARIFF } from "@/lib/services/shared/fees"
import type { PaymentCreateInput } from "@/lib/validations/fees"

import { addPayment, addProgramme, addStudent, asD1, createTestDb, race, YEAR, type TestDb } from "./harness"

let t: TestDb
let db: D1Client
let programmeId: string
let tariffId: string
/** Rahim: fee 150,000.00 BDT, paid 90,000.00 → 60,000.00 outstanding (the seed's situation). */
let rahim: string

const PAST_DUE = new Date("2026-08-01T00:00:00.000Z")
const NOW = new Date("2026-09-19T06:00:00.000Z")
const m = parseMoney

beforeAll(async () => {
  t = await createTestDb()
  db = asD1(t.db)
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
  const { programme, tariff } = await addProgramme(t.db, "BSC-CS", { tariff: { amount: m("150000.00"), dueDate: PAST_DUE } })
  programmeId = programme.id
  tariffId = tariff!.id
  rahim = (await addStudent(t.db, programmeId, formatStudentId(YEAR, 1), { fee: { amount: m("150000.00"), dueDate: PAST_DUE } })).id
  await t.db.studentFee.update({ where: { studentId: rahim }, data: { programmeFeeId: tariffId } })
  await addPayment(t.db, rahim, m("50000.00"), "PAY-1")
  await addPayment(t.db, rahim, m("40000.00"), "PAY-2")
})

let refSeq = 0
const payment = (amount: string, referenceNumber = `REF-${++refSeq}`): PaymentCreateInput => ({
  amount,
  paymentDate: "2026-09-18",
  referenceNumber,
})

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(DomainError)
  return error as DomainError
}

describe("createPayment (D1)", () => {
  it("records a normal payment in minor units and returns the usual DTO", async () => {
    const dto = await createPayment(db, rahim, payment("10000.50", "E2E-0001"), NOW)
    expect(dto).toMatchObject({ amount: "10000.50", paymentDate: "2026-09-18", referenceNumber: "E2E-0001", studentId: rahim })
    expect((await t.db.payment.findUnique({ where: { id: dto.id } }))?.amount).toBe(1000050n)
    const summary = await getStudentFeeSummary(db, rahim, NOW)
    expect(summary).toMatchObject({ totalPaid: "100000.50", outstanding: "49999.50", status: "OVERDUE" })
  })

  it("accepts a partial payment", async () => {
    await createPayment(db, rahim, payment("0.01"), NOW)
    expect((await getStudentFeeSummary(db, rahim, NOW)).outstanding).toBe("59999.99")
  })

  it("accepts exactly the outstanding balance, after which the fee is PAID", async () => {
    await createPayment(db, rahim, payment("60000.00"), NOW)
    expect(await getStudentFeeSummary(db, rahim, NOW)).toMatchObject({ outstanding: "0.00", status: "PAID", isOverdue: false })
  })

  it("rejects an overpayment with the PostgreSQL message, and writes nothing", async () => {
    const error = await rejection(createPayment(db, rahim, payment("60000.01"), NOW))
    expect(error.code).toBe("VALIDATION")
    expect(error.message).toBe("Payment exceeds the outstanding balance of 60,000.00 BDT.")
    expect(error.fieldErrors).toEqual({ amount: ["Payment exceeds the outstanding balance of 60,000.00 BDT."] })
    expect(await totalPaid(db, rahim)).toBe(m("90000.00"))
  })

  it("rejects any payment once paid in full", async () => {
    await createPayment(db, rahim, payment("60000"), NOW)
    const error = await rejection(createPayment(db, rahim, payment("1"), NOW))
    expect([error.code, error.message]).toEqual(["CONFLICT", "This student has already paid in full."])
  })

  it("rejects a payment when no fee is assigned", async () => {
    const noFee = await addStudent(t.db, programmeId, formatStudentId(YEAR, 2))
    const error = await rejection(createPayment(db, noFee.id, payment("100"), NOW))
    expect([error.code, error.message]).toEqual(["CONFLICT", "No fee has been assigned to this student."])
  })

  it("reports unknown students", async () => {
    expect((await rejection(createPayment(db, crypto.randomUUID(), payment("1"), NOW))).code).toBe("NOT_FOUND")
  })

  it("rejects a reused reference number (the existing duplicate-request protection)", async () => {
    const error = await rejection(createPayment(db, rahim, payment("10", "PAY-1"), NOW))
    expect([error.code, error.message, error.fieldErrors]).toEqual(["CONFLICT", DUPLICATE_PAYMENT_REFERENCE, { referenceNumber: [DUPLICATE_PAYMENT_REFERENCE] }])
  })

  it("never lets concurrent payments exceed the fee: 5 × 40,000 against 150,000 → exactly 3 succeed", async () => {
    const abir = (await addStudent(t.db, programmeId, formatStudentId(YEAR, 3), { fee: { amount: m("150000"), dueDate: PAST_DUE } })).id
    const { fulfilled, rejected } = await race(5, (n) => createPayment(db, abir, payment("40000", `E2E-RACE-${n}`), NOW))
    expect(fulfilled).toHaveLength(3)
    expect(rejected).toHaveLength(2)
    for (const error of rejected) expect((error as DomainError).message).toBe("Payment exceeds the outstanding balance of 30,000.00 BDT.")
    expect(await getStudentFeeSummary(db, abir, NOW)).toMatchObject({ totalPaid: "120000.00", outstanding: "30000.00" })
  })

  it("lets exactly one of 10 concurrent 'pay the full balance' requests through", async () => {
    const { fulfilled } = await race(10, () => createPayment(db, rahim, payment("60000.00"), NOW))
    expect(fulfilled).toHaveLength(1)
    expect(await totalPaid(db, rahim)).toBe(m("150000.00"))
  })

  it("accepts the same reference number only once under concurrency", async () => {
    const { fulfilled, rejected } = await race(8, () => createPayment(db, rahim, payment("100", "SAME-REF"), NOW))
    expect(fulfilled).toHaveLength(1)
    expect(rejected.map((error) => (error as DomainError).message)).toEqual(Array(7).fill(DUPLICATE_PAYMENT_REFERENCE))
  })

  it("negative control: a read-then-insert version overpays under the same harness", async () => {
    // Proves the concurrency tests can fail: this is what sequential awaits without a lock would do.
    const naivePay = async (studentId: string, amount: bigint, ref: string) => {
      const fee = await t.db.studentFee.findUniqueOrThrow({ where: { studentId } })
      const paid = await totalPaid(db, studentId)
      if (amount > fee.amount - paid) throw new Error("over")
      await addPayment(t.db, studentId, amount, ref)
    }
    await race(5, (n) => naivePay(rahim, m("40000"), `NAIVE-${n}`))
    expect(await totalPaid(db, rahim)).toBeGreaterThan(m("150000"))
  })
})

describe("assignStudentFee (D1)", () => {
  const manual = (amount: string, currency = "BDT") => ({ source: "MANUAL" as const, amount, currency, dueDate: "2027-01-31" })

  it("assigns a manual fee (scholarship) and reports it as MANUAL", async () => {
    const summary = await assignStudentFee(db, rahim, manual("120000"), NOW)
    expect(summary).toMatchObject({ totalFee: "120000.00", source: "MANUAL", matchesTariff: false, status: "OUTSTANDING", outstanding: "30000.00" })
  })

  it("reassigns from the tariff as a snapshot", async () => {
    await assignStudentFee(db, rahim, manual("120000"), NOW)
    const summary = await assignStudentFee(db, rahim, { source: "TARIFF" }, NOW)
    expect(summary).toMatchObject({ totalFee: "150000.00", source: "TARIFF", matchesTariff: true })
    expect((await t.db.studentFee.findUnique({ where: { studentId: rahim } }))?.programmeFeeId).toBe(tariffId)
  })

  it("updates the one fee row instead of adding another (duplicate assignment)", async () => {
    const before = await t.db.studentFee.findUniqueOrThrow({ where: { studentId: rahim } })
    await assignStudentFee(db, rahim, manual("130000"), NOW)
    await assignStudentFee(db, rahim, manual("140000"), NOW)
    const after = await t.db.studentFee.findMany({ where: { studentId: rahim } })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, amount: m("140000") })
    expect(after[0].createdAt.getTime()).toBe(before.createdAt.getTime())
  })

  it("creates the fee for a student who has none", async () => {
    const student = await addStudent(t.db, programmeId, formatStudentId(YEAR, 2))
    expect(await assignStudentFee(db, student.id, { source: "TARIFF" }, NOW)).toMatchObject({ hasFeeAssigned: true, totalFee: "150000.00" })
  })

  it("rejects a manual fee below what was paid, as a field error", async () => {
    await createPayment(db, rahim, payment("10000.50"), NOW)
    const error = await rejection(assignStudentFee(db, rahim, manual("50000"), NOW))
    expect([error.code, error.message]).toEqual(["VALIDATION", "Fee cannot be less than the amount already paid (100,000.50 BDT)."])
    expect(error.fieldErrors).toHaveProperty("amount")
    expect((await t.db.studentFee.findUnique({ where: { studentId: rahim } }))?.amount).toBe(m("150000"))
  })

  it("rejects a tariff below what was paid, as a conflict", async () => {
    await t.db.programmeFee.update({ where: { id: tariffId }, data: { amount: m("80000") } })
    const error = await rejection(assignStudentFee(db, rahim, { source: "TARIFF" }, NOW))
    expect([error.code, error.message]).toEqual(["CONFLICT", "Fee cannot be less than the amount already paid (90,000.00 BDT)."])
  })

  it("keeps the currency once payments exist, but allows a change before any", async () => {
    const error = await rejection(assignStudentFee(db, rahim, manual("150000", "USD"), NOW))
    expect([error.code, error.message]).toEqual(["CONFLICT", "The currency cannot change after payments have been recorded."])
    const unpaid = await addStudent(t.db, programmeId, formatStudentId(YEAR, 2), { fee: { amount: m("1000"), dueDate: PAST_DUE } })
    expect((await assignStudentFee(db, unpaid.id, manual("1000", "USD"), NOW)).currency).toBe("USD")
  })

  it("reports a missing tariff and unknown students", async () => {
    const student = await createStudent(db, {
      fullName: "No Tariff",
      email: "nt@x.test",
      dateOfBirth: "2004-01-01",
      programmeId,
      academicYear: YEAR - 1,
      enrolmentStatus: "ENROLLED",
    })
    const error = await rejection(assignStudentFee(db, student.id, { source: "TARIFF" }, NOW))
    expect([error.code, error.message]).toEqual(["CONFLICT", NO_TARIFF])
    expect((await rejection(assignStudentFee(db, crypto.randomUUID(), manual("1"), NOW))).code).toBe("NOT_FOUND")
  })

  it("leaves exactly one fee after 10 concurrent assignments", async () => {
    const amounts = Array.from({ length: 10 }, (_, n) => `${100000 + n * 1000}`)
    const { rejected } = await race(10, (n) => assignStudentFee(db, rahim, manual(amounts[n]), NOW))
    expect(rejected).toEqual([])
    const fees = await t.db.studentFee.findMany({ where: { studentId: rahim } })
    expect(fees).toHaveLength(1)
    expect(amounts.map(m)).toContain(fees[0].amount)
  })

  it("never lets a concurrent fee cut and payment both succeed: paid never exceeds the fee", async () => {
    for (let round = 0; round < 15; round++) {
      const student = await addStudent(t.db, programmeId, formatStudentId(YEAR, 100 + round), {
        fee: { amount: m("100000"), dueDate: PAST_DUE },
      })
      const { fulfilled } = await race<unknown>(2, (n) =>
        n === 0 ? assignStudentFee(db, student.id, manual("50000"), NOW) : createPayment(db, student.id, payment("80000"), NOW)
      )
      expect(fulfilled).toHaveLength(1)
      const fee = await t.db.studentFee.findUniqueOrThrow({ where: { studentId: student.id } })
      expect(await totalPaid(db, student.id)).toBeLessThanOrEqual(fee.amount)
    }
  })
})

describe("getOverdueStudents (D1)", () => {
  it("handles more students than D1's bound-parameter limit (98) with the same results", async () => {
    await t.reset()
    const { programme } = await addProgramme(t.db, "BIG")
    const future = new Date("2027-06-30T00:00:00.000Z")
    const expected: { studentId: string; outstanding: string }[] = []
    for (let n = 1; n <= 130; n++) {
      const kind = n % 5 // 0: paid in full, 1: not yet due, 2-4: overdue with part payments
      const student = await addStudent(t.db, programme.id, formatStudentId(YEAR, n), {
        fee: { amount: m("1000.00"), dueDate: kind === 1 ? future : new Date(PAST_DUE.getTime() - n * 86_400_000) },
      })
      const paid = kind === 0 ? m("1000.00") : BigInt(n) * 100n + 1n // n.01 paid
      await addPayment(t.db, student.id, paid, `BIG-${n}`)
      if (kind >= 2) expected.push({ studentId: student.studentId, outstanding: formatMoney(m("1000.00") - paid) })
    }
    // The PostgreSQL query would bind one parameter per past-due fee: more than D1 allows.
    expect(await t.db.studentFee.count({ where: { dueDate: { lt: NOW } } })).toBe(104)

    const overdue = await getOverdueStudents(db, NOW)
    expect(overdue.map((row) => ({ studentId: row.studentId, outstanding: row.outstanding })).sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual(expected)
    // Most overdue first.
    for (let i = 1; i < overdue.length; i++) expect(overdue[i - 1].daysOverdue).toBeGreaterThanOrEqual(overdue[i].daysOverdue)
  }, 60_000)

  it("matches the fee overview for a single student", async () => {
    const [row] = await getOverdueStudents(db, NOW)
    expect(row).toMatchObject({ studentId: formatStudentId(YEAR, 1), outstanding: "60000.00", currency: "BDT", programme: { code: "BSC-CS" } })
  })
})
