/**
 * Submission uploads and downloads on D1, with the files in object storage (the private R2 bucket
 * in the Worker). Same rules, DTOs and messages as the PostgreSQL service
 * (src/lib/services/submissions.ts): PDF/DOCX only, up to 5 MB, lateness from the server clock,
 * replacement allowed until the deadline, and a student only ever reaches their own files.
 *
 * Writing a new version, without transactions:
 * 1. the file is stored under a NEW key first, so the database never points at a missing object;
 * 2. the row is written with one statement that only succeeds if nobody changed it since it was read
 *    (INSERT for a first submission, UPDATE … WHERE fileUrl = <the key we read> for a replacement);
 * 3. if another upload won the race, this upload's object is deleted and the write is retried
 *    against the new state; otherwise the previous version's object is deleted.
 * So concurrent uploads leave exactly one row and one object, never an orphan.
 */
import type { Session } from "@/lib/auth/session-types"
import { canReplaceSubmission, checkSubmissionFile, isSubmissionLate, type AcceptedExtension } from "@/lib/domain/submissions"
import { DomainError, fieldError, isUniqueViolation } from "@/lib/errors"
import { submissionObjectKey, type ObjectStore } from "@/lib/storage/object-store"
import type { D1Client } from "@/lib/services/d1/client"
import { submissionSelect } from "@/lib/services/d1/submissions"
import { ASSESSMENT_NOT_FOUND } from "@/lib/services/shared/assessments"
import { STUDENT_NOT_FOUND } from "@/lib/services/shared/students"
import {
  ASSESSMENT_CLOSED,
  DEADLINE_PASSED,
  FILE_GONE,
  FILE_NOT_FOUND,
  NOT_ENROLLED,
  safeFileName,
  SUBMISSION_IN_PROGRESS,
  type SubmissionDto,
} from "@/lib/services/shared/submissions"

const MAX_WRITE_ATTEMPTS = 3

/** A file as the student declares it when asking for an upload URL. */
export type DeclaredFile = { name: string; type: string; size: number }
/** A received file. */
export type UploadedFile = { name: string; type: string; bytes: Uint8Array }

/** The assessment must exist in the student's programme, be open, and the student must be enrolled. */
async function loadTarget(db: D1Client, studentId: string, assessmentId: string) {
  const [student, assessment] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { programmeId: true, enrolmentStatus: true } }),
    db.assessment.findUnique({ where: { id: assessmentId }, select: { programmeId: true, isOpen: true, submissionDeadline: true } }),
  ])
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  // Another programme's assessment is treated as non-existent for this student.
  if (!assessment || assessment.programmeId !== student.programmeId) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  if (!assessment.isOpen) throw new DomainError("CONFLICT", ASSESSMENT_CLOSED)
  if (student.enrolmentStatus !== "ENROLLED") throw new DomainError("FORBIDDEN", NOT_ENROLLED)
  return assessment
}

function checkFile(file: { name: string; type: string; size: number }): { extension: AcceptedExtension; mimeType: string } {
  const check = checkSubmissionFile(file)
  if (!check.ok) throw fieldError("file", check.error)
  return check
}

/**
 * Everything the upload itself will check, run before an upload URL is issued so the student learns
 * about a closed assessment or a wrong file type before sending the file. The upload re-checks all of it.
 */
export async function checkUploadAllowed(db: D1Client, studentId: string, assessmentId: string, file: DeclaredFile, now = new Date()) {
  const assessment = await loadTarget(db, studentId, assessmentId)
  const check = checkFile(file)
  const existing = await db.submission.findUnique({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    select: { id: true },
  })
  if (existing && !canReplaceSubmission(now, assessment.submissionDeadline)) throw new DomainError("CONFLICT", DEADLINE_PASSED)
  return check
}

/** Creates or replaces the student's submission (architecture.md §9–§10, §32). The student comes from the session. */
export async function submitAssessment(
  db: D1Client,
  store: ObjectStore,
  params: { studentId: string; assessmentId: string; file: UploadedFile },
  now = new Date()
): Promise<SubmissionDto & { replaced: boolean }> {
  const { studentId, assessmentId, file } = params
  const assessment = await loadTarget(db, studentId, assessmentId)
  const check = checkFile({ name: file.name, type: file.type, size: file.bytes.byteLength })

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const existing = await db.submission.findUnique({
      where: { studentId_assessmentId: { studentId, assessmentId } },
      select: { id: true, fileUrl: true },
    })
    // Server clock at write time; the client never decides lateness.
    if (existing && !canReplaceSubmission(now, assessment.submissionDeadline)) throw new DomainError("CONFLICT", DEADLINE_PASSED)

    const id = existing?.id ?? crypto.randomUUID()
    const key = submissionObjectKey(id, check.extension, now)
    await store.put(key, file.bytes, { contentType: check.mimeType })

    const data = {
      fileName: safeFileName(file.name),
      fileUrl: key,
      fileType: check.mimeType,
      fileSize: file.bytes.byteLength,
      submittedAt: now,
      isLate: isSubmissionLate(now, assessment.submissionDeadline),
    }

    let written: boolean
    try {
      if (existing) {
        const { count } = await db.submission.updateMany({ where: { id: existing.id, fileUrl: existing.fileUrl }, data })
        written = count === 1
      } else {
        await db.submission.create({ data: { id, studentId, assessmentId, ...data }, select: { id: true } })
        written = true
      }
    } catch (error) {
      await store.delete(key).catch(() => undefined)
      // A concurrent first upload created the row: retry as a replacement.
      if (isUniqueViolation(error)) continue
      throw error
    }

    if (!written) {
      // Another upload replaced the file in between: drop this version and retry against the new state.
      await store.delete(key).catch(() => undefined)
      continue
    }

    // Only remove the previous version once the new one is recorded.
    if (existing) {
      await store.delete(existing.fileUrl).catch((error: unknown) => console.error("Could not delete the previous submission file", error))
    }
    const row = await db.submission.findUniqueOrThrow({ where: { id }, select: submissionSelect })
    return { ...row, replaced: existing !== null }
  }
  throw new DomainError("CONFLICT", SUBMISSION_IN_PROGRESS)
}

/**
 * Authorises a download. Staff can read any file; a student only their own. Someone else's
 * submission is reported as not found, so its existence is not revealed.
 */
export async function authorizeDownload(db: D1Client, submissionId: string, session: Session) {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, fileUrl: true },
  })
  const allowed =
    submission && (session.role === "STAFF" || (session.role === "STUDENT" && submission.studentId === session.studentId))
  if (!submission || !allowed) throw new DomainError("NOT_FOUND", FILE_NOT_FOUND)
  return { submissionId: submission.id, key: submission.fileUrl }
}

/** Opens the file a download URL was issued for, if the submission still points at it. */
export async function openSubmissionFile(db: D1Client, store: ObjectStore, submissionId: string, key: string) {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { fileUrl: true, fileName: true, fileType: true },
  })
  // Replaced since the URL was issued: that version is gone.
  if (!submission || submission.fileUrl !== key) throw new DomainError("NOT_FOUND", FILE_GONE)
  const object = await store.get(key)
  if (!object) throw new DomainError("NOT_FOUND", FILE_GONE)
  return { ...object, fileName: submission.fileName, fileType: submission.fileType }
}
