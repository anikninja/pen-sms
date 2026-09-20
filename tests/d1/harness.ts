import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { PrismaClient } from ".prisma/client-d1"

import type { D1Client } from "@/lib/services/d1/client"

const BASELINE = path.join(process.cwd(), "prisma", "d1", "migrations", "0001_baseline.sql")
// Children before parents, so plain DELETEs never trip a foreign key.
const TABLES = ["Result", "Submission", "Payment", "StudentFee", "User", "Assessment", "Student", "ProgrammeFee", "Programme"]

export type TestDb = {
  db: PrismaClient
  reset(): Promise<void>
  close(): Promise<void>
}

/**
 * A throwaway SQLite database built from prisma/d1/migrations/0001_baseline.sql, reached through the
 * D1 Prisma client (native SQLite engine) over ONE connection. Statements therefore run strictly one
 * at a time, as they do on D1, while concurrent requests still interleave between statements.
 *
 * What it does not reproduce: @prisma/adapter-d1 itself (DateTime is stored as ISO text there, as
 * integer milliseconds here) and D1's 98 bound-parameter limit (SQLite allows far more).
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "inx-sms-d1-"))
  const file = path.join(dir, "test.sqlite")
  const raw = new DatabaseSync(file)
  raw.exec(readFileSync(BASELINE, "utf8"))
  raw.close()

  const db = new PrismaClient({ datasourceUrl: `file:${file.split(path.sep).join("/")}?connection_limit=1` })
  await db.$connect()
  return {
    db,
    async reset() {
      for (const table of TABLES) await db.$executeRawUnsafe(`DELETE FROM "${table}"`)
    },
    async close() {
      await db.$disconnect()
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    },
  }
}

/** The client as the D1 services see it: no $transaction (see src/lib/services/d1/client.ts). */
export const asD1 = (db: PrismaClient): D1Client => db

export const YEAR = 2026
const NOW = new Date("2026-09-19T06:00:00.000Z")

export async function addProgramme(
  db: PrismaClient,
  code: string,
  options: { active?: boolean; tariff?: { amount: bigint; dueDate: Date; currency?: string; academicYear?: number } } = {}
) {
  const programme = await db.programme.create({
    data: { code, name: `${code} programme`, active: options.active ?? true, updatedAt: NOW },
  })
  const tariff = options.tariff
    ? await db.programmeFee.create({
        data: {
          programmeId: programme.id,
          academicYear: options.tariff.academicYear ?? YEAR,
          amount: options.tariff.amount,
          currency: options.tariff.currency ?? "BDT",
          dueDate: options.tariff.dueDate,
          updatedAt: NOW,
        },
      })
    : null
  return { programme, tariff }
}

/** Inserts a student directly (bypassing the service) — for fixtures such as gaps and malformed IDs. */
export async function addStudent(
  db: PrismaClient,
  programmeId: string,
  studentId: string,
  extra: { fullName?: string; email?: string; fee?: { amount: bigint; dueDate: Date; currency?: string } } = {}
) {
  const student = await db.student.create({
    data: {
      studentId,
      fullName: extra.fullName ?? `Student ${studentId}`,
      email: extra.email ?? `${studentId.toLowerCase()}@x.test`,
      dateOfBirth: new Date("2004-01-01T00:00:00.000Z"),
      programmeId,
      academicYear: YEAR,
      updatedAt: NOW,
    },
  })
  if (extra.fee) {
    await db.studentFee.create({
      data: {
        studentId: student.id,
        amount: extra.fee.amount,
        currency: extra.fee.currency ?? "BDT",
        dueDate: extra.fee.dueDate,
        updatedAt: NOW,
      },
    })
  }
  return student
}

export async function addPayment(db: PrismaClient, studentId: string, amount: bigint, referenceNumber: string) {
  return db.payment.create({
    data: { studentId, amount, paymentDate: new Date("2026-09-01T00:00:00.000Z"), referenceNumber, updatedAt: NOW },
  })
}

/** Runs `count` copies of `task` at once and splits the outcomes. */
export async function race<T>(count: number, task: (index: number) => Promise<T>) {
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => task(index)))
  return {
    fulfilled: settled.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === "fulfilled").map((r) => r.value),
    rejected: settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown),
  }
}
