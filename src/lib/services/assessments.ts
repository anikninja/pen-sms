import { Prisma, type EnrolmentStatus } from "@prisma/client"

import { calculateClassification, type Classification } from "@/lib/domain/results"
import { submissionStatus, type SubmissionStatus } from "@/lib/domain/submissions"
import { DomainError } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { requireActiveProgramme } from "@/lib/services/programmes"
import type { AssessmentCreateInput, AssessmentUpdateInput } from "@/lib/validations/assessments"

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

type AssessmentRow = Prisma.AssessmentGetPayload<{ select: typeof assessmentSelect }>

function toDto({ _count, ...row }: AssessmentRow, now: Date): AssessmentDto {
  return {
    ...row,
    isPastDeadline: now.getTime() > row.submissionDeadline.getTime(),
    submissionCount: _count.submissions,
    gradedCount: _count.results,
  }
}

export async function listAssessments(filter: { programmeId?: string } = {}): Promise<AssessmentDto[]> {
  const now = new Date()
  const rows = await prisma.assessment.findMany({
    where: filter.programmeId ? { programmeId: filter.programmeId } : undefined,
    orderBy: [{ submissionDeadline: "asc" }, { title: "asc" }],
    select: assessmentSelect,
  })
  return rows.map((row) => toDto(row, now))
}

export async function getAssessment(id: string): Promise<AssessmentDto> {
  const row = await prisma.assessment.findUnique({ where: { id }, select: assessmentSelect })
  if (!row) throw new DomainError("NOT_FOUND", "Assessment not found.")
  return toDto(row, new Date())
}

export async function createAssessment(
  input: AssessmentCreateInput
): Promise<{ assessment: AssessmentDto; warnings: string[] }> {
  await requireActiveProgramme(input.programmeId)
  const now = new Date()

  const row = await prisma.assessment.create({ data: input, select: assessmentSelect })
  const warnings =
    input.submissionDeadline.getTime() < now.getTime()
      ? ["The deadline is already in the past, so every submission will be marked late."]
      : []
  return { assessment: toDto(row, now), warnings }
}

/** Edits an assessment or opens/closes it. Its programme is fixed once work has been submitted or graded. */
export async function updateAssessment(id: string, input: AssessmentUpdateInput): Promise<AssessmentDto> {
  const current = await prisma.assessment.findUnique({
    where: { id },
    select: { programmeId: true, _count: { select: { submissions: true, results: true } } },
  })
  if (!current) throw new DomainError("NOT_FOUND", "Assessment not found.")

  if (input.programmeId && input.programmeId !== current.programmeId) {
    if (current._count.submissions > 0 || current._count.results > 0) {
      throw new DomainError("CONFLICT", "The programme cannot change after submissions or results exist.")
    }
    await requireActiveProgramme(input.programmeId)
  }

  const row = await prisma.assessment.update({ where: { id }, data: input, select: assessmentSelect })
  return toDto(row, new Date())
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
  if (!assessment) throw new DomainError("NOT_FOUND", "Assessment not found.")

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
