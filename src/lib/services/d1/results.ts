/**
 * Results on Cloudflare D1. Same rules, DTOs and messages as the PostgreSQL service
 * (src/lib/services/results.ts).
 *
 * Entering a grade is ONE statement: the result is inserted or re-graded only when the student and
 * the assessment exist and belong to the same programme (checked inside the INSERT … SELECT), and a
 * concurrent grade for the same pair updates the same row (ON CONFLICT). A new result starts
 * unpublished; re-grading keeps the publish state (§13).
 */
import { DomainError } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
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

const resultSelect = { studentId: true, assessmentId: true, grade: true, published: true, updatedAt: true } as const

async function findResult(db: D1Client, studentId: string, assessmentId: string) {
  return db.result.findUnique({ where: { studentId_assessmentId: { studentId, assessmentId } }, select: resultSelect })
}

export async function upsertResult(db: D1Client, studentId: string, assessmentId: string, grade: number, now = new Date()): Promise<ResultDto> {
  // WHERE is required before ON CONFLICT in an INSERT … SELECT (SQLite parsing rule).
  const written = await db.$executeRaw`
    INSERT INTO "Result" ("id", "studentId", "assessmentId", "grade", "published", "createdAt", "updatedAt")
    SELECT ${crypto.randomUUID()}, s."id", a."id", ${grade}, false, ${now}, ${now}
    FROM "Student" s
    JOIN "Assessment" a ON a."programmeId" = s."programmeId"
    WHERE s."id" = ${studentId} AND a."id" = ${assessmentId}
    ON CONFLICT ("studentId", "assessmentId") DO UPDATE SET
      "grade" = excluded."grade",
      "updatedAt" = excluded."updatedAt"`

  if (written === 0) {
    const [student, assessment] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: { id: true } }),
      db.assessment.findUnique({ where: { id: assessmentId }, select: { id: true } }),
    ])
    if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
    if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
    throw new DomainError("CONFLICT", WRONG_PROGRAMME)
  }

  const row = await findResult(db, studentId, assessmentId)
  if (!row) throw new DomainError("NOT_FOUND", NO_GRADE_YET) // deleted in between (student removed)
  return toResultDto(row)
}

export async function setResultPublished(db: D1Client, studentId: string, assessmentId: string, published: boolean): Promise<ResultDto> {
  const { count } = await db.result.updateMany({ where: { studentId, assessmentId }, data: { published } })
  const row = count === 0 ? null : await findResult(db, studentId, assessmentId)
  if (!row) throw new DomainError("NOT_FOUND", NO_GRADE_YET)
  return toResultDto(row)
}

/** Publishes or withholds a student's whole marksheet — the brief's "per student" (§13). */
export async function setStudentResultsPublished(db: D1Client, studentId: string, published: boolean) {
  const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } })
  if (!student) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  const { count } = await db.result.updateMany({ where: { studentId }, data: { published } })
  return { updated: count }
}

export async function setAssessmentResultsPublished(db: D1Client, assessmentId: string, published: boolean) {
  const assessment = await db.assessment.findUnique({ where: { id: assessmentId }, select: { id: true } })
  if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  const { count } = await db.result.updateMany({ where: { assessmentId }, data: { published } })
  return { updated: count }
}

/** Staff view of one student's results, published or not. */
export async function getStudentResults(db: D1Client, studentId: string): Promise<StaffResultRow[]> {
  const rows = await db.result.findMany({
    where: { studentId },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { ...resultSelect, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(({ assessment, ...row }) => ({ ...toResultDto(row), title: assessment.title, module: assessment.module }))
}

/** Student marksheet. The published filter is in the query, so withheld results never leave the database. */
export async function getStudentPublishedResults(db: D1Client, studentId: string): Promise<MarksheetEntry[]> {
  const rows = await db.result.findMany({
    where: { studentId, published: true },
    orderBy: { assessment: { submissionDeadline: "asc" } },
    select: { assessmentId: true, grade: true, assessment: { select: { title: true, module: true } } },
  })
  return rows.map(toMarksheetEntry)
}

/** Withheld (unpublished) result counts per assessment, for the Results page picker. */
export async function countWithheldByAssessment(db: D1Client): Promise<Record<string, number>> {
  const rows = await db.result.groupBy({ by: ["assessmentId"], where: { published: false }, _count: { _all: true } })
  return Object.fromEntries(rows.map((row) => [row.assessmentId, row._count._all]))
}
