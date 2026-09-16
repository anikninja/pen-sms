import { describe, expect, it } from "vitest"

import {
  canReplaceSubmission,
  checkSubmissionFile,
  isSubmissionLate,
  MAX_SUBMISSION_BYTES,
  submissionStatus,
} from "@/lib/domain/submissions"

const deadline = new Date("2026-09-30T17:00:00.000Z")
const before = new Date(deadline.getTime() - 1)
const after = new Date(deadline.getTime() + 1)

describe("isSubmissionLate", () => {
  it("is on time before the deadline", () => expect(isSubmissionLate(before, deadline)).toBe(false))
  it("is on time exactly at the deadline", () => expect(isSubmissionLate(new Date(deadline), deadline)).toBe(false))
  it("is late after the deadline", () => expect(isSubmissionLate(after, deadline)).toBe(true))
})

describe("canReplaceSubmission", () => {
  it("allows before the deadline", () => expect(canReplaceSubmission(before, deadline)).toBe(true))
  it("allows exactly at the deadline", () => expect(canReplaceSubmission(new Date(deadline), deadline)).toBe(true))
  it("rejects after the deadline", () => expect(canReplaceSubmission(after, deadline)).toBe(false))
})

describe("checkSubmissionFile", () => {
  const pdf = { name: "Coursework.PDF", type: "application/pdf", size: 1024 }
  const docx = {
    name: "essay.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 2048,
  }

  it("accepts PDF (extension case-insensitive)", () => {
    expect(checkSubmissionFile(pdf)).toEqual({ ok: true, extension: ".pdf", mimeType: "application/pdf" })
  })

  it("accepts DOCX", () => {
    expect(checkSubmissionFile(docx).ok).toBe(true)
  })

  it.each([
    { name: "notes.txt", type: "text/plain", size: 10 },
    { name: "old.doc", type: "application/msword", size: 10 },
    { name: "fake.pdf", type: "text/plain", size: 10 },
    { name: "fake.docx", type: "application/pdf", size: 10 },
    { name: "noextension", type: "application/pdf", size: 10 },
  ])("rejects $name ($type)", (file) => {
    expect(checkSubmissionFile(file)).toEqual({ ok: false, error: "Only PDF and DOCX files are accepted." })
  })

  it("accepts exactly 5 MB and rejects one byte more", () => {
    expect(checkSubmissionFile({ ...pdf, size: MAX_SUBMISSION_BYTES }).ok).toBe(true)
    expect(checkSubmissionFile({ ...pdf, size: MAX_SUBMISSION_BYTES + 1 })).toEqual({
      ok: false,
      error: "File must be smaller than 5 MB.",
    })
  })

  it("rejects an empty file", () => {
    expect(checkSubmissionFile({ ...pdf, size: 0 }).ok).toBe(false)
  })
})

describe("submissionStatus", () => {
  it("maps each state", () => {
    expect(submissionStatus(null)).toBe("PENDING")
    expect(submissionStatus({ isLate: false })).toBe("SUBMITTED")
    expect(submissionStatus({ isLate: true })).toBe("LATE")
  })
})
