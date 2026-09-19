import { randomUUID } from "node:crypto"

import type { Session } from "@/lib/auth/session"
import { canReplaceSubmission, checkSubmissionFile, isSubmissionLate } from "@/lib/domain/submissions"
import { DomainError, fieldError, isUniqueViolation } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
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
  toStudentAssessment,
  type StudentAssessmentDto,
  type SubmissionDto,
} from "@/lib/services/shared/submissions"
import { storage, storageKey } from "@/lib/storage"

export type { StudentAssessmentDto, SubmissionDto } from "@/lib/services/shared/submissions"

const submissionSelect = {
  id: true,
  assessmentId: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  submittedAt: true,
  isLate: true,
} as const

/**
 * Creates or replaces the student's submission (architecture.md §9–§10, §32).
 * The student always comes from the session; the file never overwrites the previous one on disk.
 */
export async function submitAssessment(params: {
  studentId: string
  assessmentId: string
  file: File
}): Promise<SubmissionDto & { replaced: boolean }> {
  const { studentId, assessmentId, file } = params

  const [student, assessment] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { programmeId: true, enrolmentStatus: true } }),
    prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { programmeId: true, isOpen: true, submissionDeadline: true },
    }),
  ])
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  // Another programme's assessment is treated as non-existent for this student.
  if (!assessment || assessment.programmeId !== student.programmeId) {
    throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  }
  if (!assessment.isOpen) throw new DomainError("CONFLICT", ASSESSMENT_CLOSED)
  if (student.enrolmentStatus !== "ENROLLED") {
    throw new DomainError("FORBIDDEN", NOT_ENROLLED)
  }

  const check = checkSubmissionFile(file)
  if (!check.ok) throw fieldError("file", check.error)

  const existing = await prisma.submission.findUnique({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    select: { id: true, fileUrl: true },
  })

  // Server clock at write time; the client never decides lateness.
  const submittedAt = new Date()
  if (existing && !canReplaceSubmission(submittedAt, assessment.submissionDeadline)) {
    throw new DomainError("CONFLICT", DEADLINE_PASSED)
  }

  const id = existing?.id ?? randomUUID()
  const key = storageKey(id, check.extension, submittedAt)
  const saved = await storage.save(file, key)

  const data = {
    fileName: safeFileName(file.name),
    fileUrl: saved.url,
    fileType: check.mimeType,
    fileSize: saved.size,
    submittedAt,
    isLate: isSubmissionLate(submittedAt, assessment.submissionDeadline),
  }

  let row: SubmissionDto
  try {
    row = await prisma.submission.upsert({
      where: { studentId_assessmentId: { studentId, assessmentId } },
      create: { id, studentId, assessmentId, ...data },
      update: data,
      select: submissionSelect,
    })
  } catch (error) {
    await storage.delete(key).catch(() => undefined)
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", SUBMISSION_IN_PROGRESS)
    }
    throw error
  }

  // Only remove the old file once the new one is safely recorded.
  if (existing && existing.fileUrl !== key) {
    await storage.delete(existing.fileUrl).catch((error) => console.error("Could not delete old submission file", error))
  }

  return { ...row, replaced: existing !== null }
}

/** Assessments of the student's own programme, with their submission and upload eligibility (§24). */
export async function getStudentAssessments(studentId: string): Promise<StudentAssessmentDto[]> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { programmeId: true, enrolmentStatus: true },
  })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  const now = new Date()
  const assessments = await prisma.assessment.findMany({
    where: { programmeId: student.programmeId },
    orderBy: [{ submissionDeadline: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      module: true,
      submissionDeadline: true,
      isOpen: true,
      submissions: { where: { studentId }, select: submissionSelect },
    },
  })

  return assessments.map((assessment) => toStudentAssessment(assessment, student.enrolmentStatus, now))
}

/**
 * Loads a submitted file for download. Staff can read any file; a student only their own.
 * Someone else's submission is reported as not found, so its existence is not revealed.
 */
export async function getSubmissionFile(submissionId: string, session: Session) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, fileName: true, fileType: true, fileUrl: true },
  })
  const allowed =
    submission && (session.role === "STAFF" || (session.role === "STUDENT" && submission.studentId === session.studentId))
  if (!submission || !allowed) throw new DomainError("NOT_FOUND", FILE_NOT_FOUND)

  try {
    const content = await storage.read(submission.fileUrl)
    return { content, fileName: submission.fileName, fileType: submission.fileType }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DomainError("NOT_FOUND", FILE_GONE)
    }
    throw error
  }
}
