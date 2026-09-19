import { describe, expect, it } from "vitest"

import { assertObjectKey, isObjectKey, submissionObjectKey } from "@/lib/storage/object-store"

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b"

describe("R2 object keys", () => {
  it("are built from ids and time, never from the file name", () => {
    expect(submissionObjectKey(ID, ".pdf", new Date(1_700_000_000_000), "abc123")).toBe(`submissions/${ID}/1700000000000-abc123.pdf`)
    expect(submissionObjectKey(ID, ".docx", new Date(0), "seed")).toBe(`submissions/${ID}/0-seed.docx`)
  })

  it("get a random nonce, so two uploads in the same millisecond never collide", () => {
    const at = new Date(1)
    const keys = new Set(Array.from({ length: 100 }, () => submissionObjectKey(ID, ".pdf", at)))
    expect(keys.size).toBe(100)
  })

  it("accept the local-disk storage's keys, for copied files", () => {
    expect(isObjectKey(`${ID}-1789660671192.pdf`)).toBe(true)
  })

  it.each([
    "../secret.pdf",
    `submissions/${ID}/../../x.pdf`,
    `submissions/${ID}/1-abc.exe`,
    `submissions/not-an-id/1-abc.pdf`,
    `submissions/${ID}/1-ABC.pdf`,
    `/${ID}-1.pdf`,
    "",
  ])("reject %s", (key) => {
    expect(isObjectKey(key)).toBe(false)
    expect(() => assertObjectKey(key)).toThrow("Invalid storage key.")
  })
})
