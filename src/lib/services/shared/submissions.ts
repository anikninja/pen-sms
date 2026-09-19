/**
 * Submission DTOs, rules and messages shared by the PostgreSQL services
 * (src/lib/services/submissions.ts) and the D1 services (src/lib/services/d1/submissions.ts).
 */
import type { EnrolmentStatus } from "@/lib/domain/enums"
import { canReplaceSubmission, submissionStatus, type SubmissionStatus } from "@/lib/domain/submissions"

export const DEADLINE_PASSED = "The deadline has passed. Your existing submission can no longer be replaced."
export const ASSESSMENT_CLOSED = "This assessment is closed for submissions."
export const NOT_ENROLLED = "Only enrolled students can submit."
export const FILE_NOT_FOUND = "File not found."
export const FILE_GONE = "The file is no longer available."
export const SUBMISSION_IN_PROGRESS = "Your submission is already being saved. Refresh and try again."

export type SubmissionDto = {
  id: string
  assessmentId: string
  fileName: string
  fileType: string
  fileSize: number
  submittedAt: Date
  isLate: boolean
}

export type StudentAssessmentDto = {
  id: string
  title: string
  module: string
  submissionDeadline: Date
  isOpen: boolean
  isPastDeadline: boolean
  status: SubmissionStatus
  submission: SubmissionDto | null
  /** Whether the upload control should be offered, and why not when it isn't. */
  canUpload: boolean
  uploadBlockedReason: string | null
}

/** Strips any path and control characters from a client-supplied file name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim()
  return (cleaned || "submission").slice(0, 200)
}

type AssessmentWithSubmission = {
  id: string
  title: string
  module: string
  submissionDeadline: Date
  isOpen: boolean
  submissions: SubmissionDto[]
}

/** One assessment of the student's own programme, with their submission and upload eligibility (§24). */
export function toStudentAssessment(
  { submissions, ...assessment }: AssessmentWithSubmission,
  enrolmentStatus: EnrolmentStatus,
  now: Date
): StudentAssessmentDto {
  const submission = submissions[0] ?? null
  let uploadBlockedReason: string | null = null
  if (!assessment.isOpen) uploadBlockedReason = ASSESSMENT_CLOSED
  else if (enrolmentStatus !== "ENROLLED") uploadBlockedReason = NOT_ENROLLED
  else if (submission && !canReplaceSubmission(now, assessment.submissionDeadline)) uploadBlockedReason = DEADLINE_PASSED

  return {
    ...assessment,
    isPastDeadline: now.getTime() > assessment.submissionDeadline.getTime(),
    status: submissionStatus(submission),
    submission,
    canUpload: uploadBlockedReason === null,
    uploadBlockedReason,
  }
}
