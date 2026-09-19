/**
 * Assessment DTOs, builders and messages shared by the PostgreSQL services
 * (src/lib/services/assessments.ts) and the D1 services (src/lib/services/d1/assessments.ts).
 */
import type { EnrolmentStatus } from "@/lib/domain/enums"
import { calculateClassification, type Classification } from "@/lib/domain/results"
import { submissionStatus, type SubmissionStatus } from "@/lib/domain/submissions"

export const ASSESSMENT_NOT_FOUND = "Assessment not found."
export const PROGRAMME_LOCKED = "The programme cannot change after submissions or results exist."
export const PAST_DEADLINE_WARNING = "The deadline is already in the past, so every submission will be marked late."

export type AssessmentDto = {
  id: string
  title: string
  module: string
  submissionDeadline: Date
  isOpen: boolean
  isPastDeadline: boolean
  programme: { id: string; code: string; name: string }
  submissionCount: number
  gradedCount: number
  createdAt: Date
  updatedAt: Date
}

export type AssessmentSubmissionRow = {
  student: { id: string; studentId: string; fullName: string; enrolmentStatus: EnrolmentStatus }
  status: SubmissionStatus
  submission: {
    id: string
    fileName: string
    fileType: string
    fileSize: number
    submittedAt: Date
    isLate: boolean
  } | null
  result: { grade: number; classification: Classification; published: boolean } | null
}

/** An assessment row as both databases return it with `_count` of submissions and results. */
export type AssessmentRow = Omit<AssessmentDto, "isPastDeadline" | "submissionCount" | "gradedCount"> & {
  _count: { submissions: number; results: number }
}

export function toAssessmentDto({ _count, ...row }: AssessmentRow, now: Date): AssessmentDto {
  return {
    ...row,
    isPastDeadline: now.getTime() > row.submissionDeadline.getTime(),
    submissionCount: _count.submissions,
    gradedCount: _count.results,
  }
}

export function deadlineWarnings(submissionDeadline: Date, now: Date): string[] {
  return submissionDeadline.getTime() < now.getTime() ? [PAST_DEADLINE_WARNING] : []
}

type StudentWithWork = AssessmentSubmissionRow["student"] & {
  submissions: NonNullable<AssessmentSubmissionRow["submission"]>[]
  results: { grade: number; published: boolean }[]
}

export function toAssessmentSubmissionRows(students: StudentWithWork[]): AssessmentSubmissionRow[] {
  return students.map(({ submissions, results, ...student }) => {
    const submission = submissions[0] ?? null
    const result = results[0] ?? null
    return {
      student,
      status: submissionStatus(submission),
      submission,
      result: result ? { ...result, classification: calculateClassification(result.grade) } : null,
    }
  })
}
