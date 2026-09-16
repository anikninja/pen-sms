export const MAX_SUBMISSION_BYTES = 5 * 1024 * 1024

export const ACCEPTED_FILE_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const

export type AcceptedExtension = keyof typeof ACCEPTED_FILE_TYPES

/** Exactly at the deadline is on time (architecture.md §10). */
export function isSubmissionLate(submittedAt: Date, deadline: Date): boolean {
  return submittedAt.getTime() > deadline.getTime()
}

/** An existing submission can be replaced until, and including, the deadline (§9). */
export function canReplaceSubmission(now: Date, deadline: Date): boolean {
  return now.getTime() <= deadline.getTime()
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase()
}

export type FileCheck =
  | { ok: true; extension: AcceptedExtension; mimeType: string }
  | { ok: false; error: string }

/** Accepts PDF and DOCX only, checked by extension AND MIME type, up to 5 MB (§32). */
export function checkSubmissionFile(file: { name: string; type: string; size: number }): FileCheck {
  const extension = fileExtension(file.name)
  const expectedType = ACCEPTED_FILE_TYPES[extension as AcceptedExtension]
  const mimeType = file.type.split(";")[0].trim().toLowerCase()

  if (!expectedType || mimeType !== expectedType) {
    return { ok: false, error: "Only PDF and DOCX files are accepted." }
  }
  if (file.size === 0) {
    return { ok: false, error: "The file is empty." }
  }
  if (file.size > MAX_SUBMISSION_BYTES) {
    return { ok: false, error: "File must be smaller than 5 MB." }
  }
  return { ok: true, extension: extension as AcceptedExtension, mimeType: expectedType }
}

export type SubmissionStatus = "SUBMITTED" | "LATE" | "PENDING"

export function submissionStatus(submission: { isLate: boolean } | null): SubmissionStatus {
  if (!submission) return "PENDING"
  return submission.isLate ? "LATE" : "SUBMITTED"
}
