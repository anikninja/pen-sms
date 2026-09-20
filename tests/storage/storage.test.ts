import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { LocalFileStorage, storageKey } from "@/lib/storage"

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b"
let root: string
let storage: LocalFileStorage

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "inx-sms-storage-"))
  storage = new LocalFileStorage(root)
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("LocalFileStorage", () => {
  it("saves, reads and deletes a file", async () => {
    const key = storageKey(ID, ".pdf", new Date(1_700_000_000_000))
    expect(key).toBe(`${ID}-1700000000000.pdf`)

    const saved = await storage.save(new Blob(["%PDF-1.4 test"]), key)
    expect(saved).toEqual({ url: key, size: 13 })
    expect((await storage.read(key)).toString()).toBe("%PDF-1.4 test")

    await storage.delete(key)
    expect(await readdir(root)).toEqual([])
    await expect(storage.delete(key)).resolves.toBeUndefined() // deleting twice is fine
  })

  it("never overwrites an existing key", async () => {
    const key = storageKey(ID, ".docx", new Date(1))
    await storage.save(new Blob(["one"]), key)
    await expect(storage.save(new Blob(["two"]), key)).rejects.toThrow()
    expect((await storage.read(key)).toString()).toBe("one")
  })

  it.each(["../secret.pdf", "..\\secret.pdf", `${ID}.exe`, "/etc/passwd", `${ID}-1.pdf/../../x`, "a.pdf"])(
    "rejects unsafe key %s",
    async (key) => {
      await expect(storage.read(key)).rejects.toThrow("Invalid storage key")
    }
  )
})
