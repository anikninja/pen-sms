/**
 * D1 submission uploads with an in-memory object store: the write order and the compare-and-swap
 * that keep the database and the bucket consistent without transactions. The same code runs in the
 * Worker against R2 (worker/test/files.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { DomainError } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
import { submitAssessment } from "@/lib/services/d1/submission-files"
import type { ObjectStore } from "@/lib/storage/object-store"

import { addProgramme, addStudent, asD1, createTestDb, type TestDb } from "./harness"

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>()
  /** Runs once, right after the next put (simulates another request at that moment). */
  afterNextPut: (() => Promise<void>) | null = null

  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes)
    const hook = this.afterNextPut
    this.afterNextPut = null
    if (hook) await hook()
  }
  async get(key: string) {
    const bytes = this.objects.get(key)
    return bytes ? { body: new Blob([bytes as BlobPart]).stream(), size: bytes.byteLength } : null
  }
  async exists(key: string) {
    return this.objects.has(key)
  }
  async delete(key: string) {
    this.objects.delete(key)
  }
}

let t: TestDb
let db: D1Client
let store: MemoryStore
let studentId: string
let assessmentId: string
const NOW = new Date("2026-09-19T06:00:00.000Z")
const pdf = (text: string) => ({ name: `${text}.pdf`, type: "application/pdf", bytes: new TextEncoder().encode(`%PDF ${text}`) })

beforeAll(async () => {
  t = await createTestDb()
  db = asD1(t.db)
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
  store = new MemoryStore()
  const { programme } = await addProgramme(t.db, "BSC-CS")
  studentId = (await addStudent(t.db, programme.id, "SMS-2026-0001")).id
  assessmentId = (
    await t.db.assessment.create({
      data: { programmeId: programme.id, title: "Essay", module: "Writing", submissionDeadline: new Date("2026-10-01T00:00:00.000Z") },
    })
  ).id
})

const submit = (file = pdf("v1"), now = NOW) => submitAssessment(db, store, { studentId, assessmentId, file }, now)
const rowKey = async () => (await t.db.submission.findFirstOrThrow({ select: { fileUrl: true } })).fileUrl

describe("submitAssessment on D1", () => {
  it("stores the object, then the row that points at it", async () => {
    const result = await submit()
    expect(result).toMatchObject({ fileName: "v1.pdf", fileSize: 7, isLate: false, replaced: false })
    expect([...store.objects.keys()]).toEqual([await rowKey()])
  })

  it("replaces the file and deletes the previous object only after the row points at the new one", async () => {
    const first = await submit(pdf("v1"))
    const second = await submit(pdf("v2"), new Date(NOW.getTime() + 1000))
    expect(second).toMatchObject({ id: first.id, fileName: "v2.pdf", replaced: true })
    expect([...store.objects.keys()]).toEqual([await rowKey()])
  })

  it("refuses a replacement after the deadline and leaves no object behind", async () => {
    await submit()
    const late = new Date("2026-10-02T00:00:00.000Z")
    await expect(submit(pdf("late"), late)).rejects.toMatchObject({ code: "CONFLICT" })
    expect(store.objects.size).toBe(1)
  })

  it("loses a replacement race cleanly: drops its own object and retries against the new state", async () => {
    await submit(pdf("v1"))
    // Right after this upload stores its object, another upload replaces the file.
    store.afterNextPut = async () => {
      await submit(pdf("other"), new Date(NOW.getTime() + 500))
    }
    const result = await submit(pdf("mine"), new Date(NOW.getTime() + 1000))
    expect(result.fileName).toBe("mine.pdf")
    expect(await t.db.submission.count()).toBe(1)
    expect([...store.objects.keys()]).toEqual([await rowKey()]) // v1, "other" and the lost attempt are all gone
  })

  it("loses a first-upload race cleanly: becomes a replacement of the winner", async () => {
    store.afterNextPut = async () => {
      await submit(pdf("winner"), new Date(NOW.getTime() + 500))
    }
    const result = await submit(pdf("mine"), new Date(NOW.getTime() + 1000))
    expect(result).toMatchObject({ fileName: "mine.pdf", replaced: true })
    expect(await t.db.submission.count()).toBe(1)
    expect([...store.objects.keys()]).toEqual([await rowKey()])
  })

  it("deletes its object when the database write fails", async () => {
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop !== "submission") return Reflect.get(target, prop)
        return new Proxy(target.submission, {
          get(inner, name) {
            if (name === "create") return async () => Promise.reject(new Error("D1 unavailable"))
            const value = Reflect.get(inner, name)
            return typeof value === "function" ? value.bind(inner) : value
          },
        })
      },
    }) as D1Client
    await expect(submitAssessment(failing, store, { studentId, assessmentId, file: pdf("x") }, NOW)).rejects.toThrow("D1 unavailable")
    expect(store.objects.size).toBe(0)
  })

  it("validates the file with the Next.js messages", async () => {
    const txt = { name: "notes.txt", type: "text/plain", bytes: new Uint8Array(3) }
    const error = await submit(txt).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(DomainError)
    expect((error as DomainError).fieldErrors).toEqual({ file: ["Only PDF and DOCX files are accepted."] })
    expect(store.objects.size).toBe(0)
  })
})
