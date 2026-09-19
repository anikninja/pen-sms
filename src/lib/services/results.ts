import { DomainError } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { ASSESSMENT_NOT_FOUND } from "@/lib/services/shared/assessments"
import {
  NO_GRADE_YET,
  toMarksheetEntry,
  toResultDto,
  WRONG_PROGRAMME,
  type MarksheetEntry,
  type ResultDto,
  type StaffResultRow,
} from "@/lib/services/shared/results"
import { STUDENT_NOT_FOUND } from "@/lib/services/shared/students"

export type { MarksheetEntry, ResultDto, StaffResultRow } from "@/lib/services/shared/results"

const resultSelect = { studentId: true, assessmentId: true, grade: true, published: true, updatedAt: true } as const

/**
 * Enters or re-grades a result. A new result starts unpublished; re-grading keeps the current
 * publish state (see architecture.md §13).
 */
export async function upsertResult(studentId: string, assessmentId: string, grade: number): Promise<ResultDto> {
  const [student, assessment] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { programmeId: true } }),
    prisma.assessment.findUnique({ where: { id: assessmentId }, select: { programmeId: true } }),
  ])
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  if (student.programmeId !== assessment.programmeId) {
    throw new DomainError("CONFLICT", WRONG_PROGRAMME)
  }

  const row = await prisma.result.upsert({
    where: { studentId_assessmentId: { studentId, assessmentId } },
    create: { studentId, assessmentId, grade, published: false },
    update: { grade },
    select: resultSelect,
  })
  return toResultDto(row)
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
    throw new DomainError("NOT_FOUND", NO_GRADE_YET)
  }
  const row = await prisma.result.update({ where: { id: existing.id }, data: { published }, select: resultSelect })
  return toResultDto(row)
}

/** Publishes or withholds a student's whole marksheet — the brief's "per student" (§13). */
export async function setStudentResultsPublished(studentId: string, published: boolean) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  const { count } = await prisma.result.updateMany({ where: { studentId }, data: { published } })
  return { updated: count }
}

export async function setAssessmentResultsPublished(assessmentId: string, published: boolean) {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { id: true } })
  if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  const { count } = await prisma.result.updateMany({ where: { assessmentId }, data: { published } })
  return { updated: count }
}

/** Staff view of one student's results, published or not. */
export async function getStudentResults(studentId: string): Promise<StaffResultRow[]> {
  const rows = await prisma.result.findMany({
    where: { studentId },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { ...resultSelect, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(({ assessment, ...row }) => ({ ...toResultDto(row), title: assessment.title, module: assessment.module }))
}

/** Student marksheet. The published filter is in the query, so withheld results never leave the database. */
export async function getStudentPublishedResults(studentId: string): Promise<MarksheetEntry[]> {
  const rows = await prisma.result.findMany({
    where: { studentId, published: true },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { assessmentId: true, grade: true, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(toMarksheetEntry)
}
