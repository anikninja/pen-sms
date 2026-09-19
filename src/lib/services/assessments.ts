import { Prisma } from "@prisma/client"

import { DomainError } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { requireActiveProgramme } from "@/lib/services/programmes"
import {
  ASSESSMENT_NOT_FOUND,
  deadlineWarnings,
  PROGRAMME_LOCKED,
  toAssessmentDto,
  toAssessmentSubmissionRows,
  type AssessmentDto,
  type AssessmentSubmissionRow,
} from "@/lib/services/shared/assessments"
import type { AssessmentCreateInput, AssessmentUpdateInput } from "@/lib/validations/assessments"

export type { AssessmentDto, AssessmentSubmissionRow } from "@/lib/services/shared/assessments"

const assessmentSelect = {
  id: true,
  title: true,
  module: true,
  submissionDeadline: true,
  isOpen: true,
  createdAt: true,
  updatedAt: true,
  programme: { select: { id: true, code: true, name: true } },
  _count: { select: { submissions: true, results: true } },
} satisfies Prisma.AssessmentSelect

export async function listAssessments(filter: { programmeId?: string } = {}): Promise<AssessmentDto[]> {
  const now = new Date()
  const rows = await prisma.assessment.findMany({
    where: filter.programmeId ? { programmeId: filter.programmeId } : undefined,
    orderBy: [{ submissionDeadline: "asc" }, { title: "asc" }],
    select: assessmentSelect,
  })
  return rows.map((row) => toAssessmentDto(row, now))
}

export async function getAssessment(id: string): Promise<AssessmentDto> {
  const row = await prisma.assessment.findUnique({ where: { id }, select: assessmentSelect })
  if (!row) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  return toAssessmentDto(row, new Date())
}

export async function createAssessment(
  input: AssessmentCreateInput
): Promise<{ assessment: AssessmentDto; warnings: string[] }> {
  await requireActiveProgramme(input.programmeId)
  const now = new Date()

  const row = await prisma.assessment.create({ data: input, select: assessmentSelect })
  return { assessment: toAssessmentDto(row, now), warnings: deadlineWarnings(input.submissionDeadline, now) }
}

/** Edits an assessment or opens/closes it. Its programme is fixed once work has been submitted or graded. */
export async function updateAssessment(id: string, input: AssessmentUpdateInput): Promise<AssessmentDto> {
  const current = await prisma.assessment.findUnique({
    where: { id },
    select: { programmeId: true, _count: { select: { submissions: true, results: true } } },
  })
  if (!current) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)

  if (input.programmeId && input.programmeId !== current.programmeId) {
    if (current._count.submissions > 0 || current._count.results > 0) {
      throw new DomainError("CONFLICT", PROGRAMME_LOCKED)
    }
    await requireActiveProgramme(input.programmeId)
  }

  const row = await prisma.assessment.update({ where: { id }, data: input, select: assessmentSelect })
  return toAssessmentDto(row, new Date())
}

/**
 * Pending submissions (§19): ENROLLED students of each open assessment's programme who have not
 * submitted. Deferred, withdrawn and completed students are not counted.
 */
export async function countPendingSubmissions(): Promise<number> {
  const open = await prisma.assessment.findMany({ where: { isOpen: true }, select: { id: true, programmeId: true } })
  const counts = await Promise.all(
    open.map((assessment) =>
      prisma.student.count({
        where: {
          programmeId: assessment.programmeId,
          enrolmentStatus: "ENROLLED",
          submissions: { none: { assessmentId: assessment.id } },
        },
      })
    )
  )
  return counts.reduce((total, count) => total + count, 0)
}

/**
 * Staff submission list (§22): every ENROLLED student of the assessment's programme, plus any other
 * student who already submitted or was graded (e.g. deferred after submitting).
 */
export async function getAssessmentSubmissions(assessmentId: string): Promise<AssessmentSubmissionRow[]> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { programmeId: true },
  })
  if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)

  const students = await prisma.student.findMany({
    where: {
      programmeId: assessment.programmeId,
      OR: [
        { enrolmentStatus: "ENROLLED" },
        { submissions: { some: { assessmentId } } },
        { results: { some: { assessmentId } } },
      ],
    },
    orderBy: { studentId: "asc" },
    select: {
      id: true,
      studentId: true,
      fullName: true,
      enrolmentStatus: true,
      submissions: {
        where: { assessmentId },
        select: { id: true, fileName: true, fileType: true, fileSize: true, submittedAt: true, isLate: true },
      },
      results: { where: { assessmentId }, select: { grade: true, published: true } },
    },
  })

  return toAssessmentSubmissionRows(students)
}
