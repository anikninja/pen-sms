/**
 * Submissions on Cloudflare D1 — the read side. Same rules, DTOs and messages as the PostgreSQL
 * service (src/lib/services/submissions.ts). Uploads and downloads (R2) are in
 * src/lib/services/d1/submission-files.ts.
 */
import { DomainError } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
import { STUDENT_NOT_FOUND } from "@/lib/services/shared/students"
import { toStudentAssessment, type StudentAssessmentDto } from "@/lib/services/shared/submissions"

export const submissionSelect = {
  id: true,
  assessmentId: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  submittedAt: true,
  isLate: true,
} as const

/**
 * Assessments of the student's own programme, with their submission and upload eligibility (§24).
 * Two flat queries joined here rather than a nested, filtered `submissions` selection, which D1
 * cannot run for more than ~98 assessments (see getAssessmentSubmissions).
 */
export async function getStudentAssessments(db: D1Client, studentId: string, now = new Date()): Promise<StudentAssessmentDto[]> {
  const student = await db.student.findUnique({ where: { id: studentId }, select: { programmeId: true, enrolmentStatus: true } })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  const [assessments, submissions] = await Promise.all([
    db.assessment.findMany({
      where: { programmeId: student.programmeId },
      orderBy: [{ submissionDeadline: "asc" }, { title: "asc" }],
      select: { id: true, title: true, module: true, submissionDeadline: true, isOpen: true },
    }),
    db.submission.findMany({ where: { studentId }, select: submissionSelect }),
  ])

  const submissionOf = new Map(submissions.map((submission) => [submission.assessmentId, submission]))
  return assessments.map((assessment) => {
    const submission = submissionOf.get(assessment.id)
    return toStudentAssessment({ ...assessment, submissions: submission ? [submission] : [] }, student.enrolmentStatus, now)
  })
}
