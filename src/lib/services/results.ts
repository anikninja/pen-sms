import { calculateClassification, type Classification } from "@/lib/domain/results"
import { DomainError } from "@/lib/errors"
import { prisma } from "@/lib/prisma"

export type ResultDto = {
  studentId: string
  assessmentId: string
  grade: number
  classification: Classification
  published: boolean
  updatedAt: Date
}

/** What a student may see: published results only, without the publish flag (§13, §24). */
export type MarksheetEntry = {
  assessmentId: string
  title: string
  module: string
  grade: number
  classification: Classification
}

const resultSelect = { studentId: true, assessmentId: true, grade: true, published: true, updatedAt: true } as const

const toDto = (row: Omit<ResultDto, "classification">): ResultDto => ({
  ...row,
  classification: calculateClassification(row.grade),
})

/**
 * Enters or re-grades a result. A new result starts unpublished; re-grading keeps the current
 * publish state (see architecture.md §13).
 */
export async function upsertResult(studentId: string, assessmentId: string, grade: number): Promise<ResultDto> {
  const [student, assessment] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { programmeId: true } }),
    prisma.assessment.findUnique({ where: { id: assessmentId }, select: { programmeId: true } }),
  ])
  if (!student) throw new DomainError("NOT_FOUND", "Student not found.")
  if (!assessment) throw new DomainError("NOT_FOUND", "Assessment not found.")
  if (student.programmeId !== assessment.programmeId) {
    throw new DomainError("CONFLICT", "This student is not in the assessment's programme.")
  }

  const row = await prisma.result.upsert({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    create: { studentId, assessmentId, grade, published: false },
    update: { grade },
    select: resultSelect,
  })
  return toDto(row)
}

export async function setResultPublished(
  studentId: string,
  assessmentId: string,
  published: boolean
): Promise<ResultDto> {
  const existing = await prisma.result.findUnique({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    select: { id: true },
  })
  if (!existing) {
    throw new DomainError("NOT_FOUND", "No grade has been entered for this student and assessment yet.")
  }
  const row = await prisma.result.update({ where: { id: existing.id }, data: { published }, select: resultSelect })
  return toDto(row)
}

/** Publishes or withholds a student's whole marksheet — the brief's "per student" (§13). */
export async function setStudentResultsPublished(studentId: string, published: boolean) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } })
  if (!student) throw new DomainError("NOT_FOUND", "Student not found.")
  const { count } = await prisma.result.updateMany({ where: { studentId }, data: { published } })
  return { updated: count }
}

export async function setAssessmentResultsPublished(assessmentId: string, published: boolean) {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { id: true } })
  if (!assessment) throw new DomainError("NOT_FOUND", "Assessment not found.")
  const { count } = await prisma.result.updateMany({ where: { assessmentId }, data: { published } })
  return { updated: count }
}

/** Staff view of one student's results, published or not. */
export async function getStudentResults(studentId: string) {
  const rows = await prisma.result.findMany({
    where: { studentId },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { ...resultSelect, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(({ assessment, ...row }) => ({ ...toDto(row), title: assessment.title, module: assessment.module }))
}

/** Student marksheet. The published filter is in the query, so withheld results never leave the database. */
export async function getStudentPublishedResults(studentId: string): Promise<MarksheetEntry[]> {
  const rows = await prisma.result.findMany({
    where: { studentId, published: true },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { assessmentId: true, grade: true, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(({ assessment, ...row }) => ({
    assessmentId: row.assessmentId,
    title: assessment.title,
    module: assessment.module,
    grade: row.grade,
    classification: calculateClassification(row.grade),
  }))
}
