/**
 * Assessments on Cloudflare D1. Same rules, DTOs and messages as the PostgreSQL service
 * (src/lib/services/assessments.ts). Two differences, both explained where they occur: a programme
 * move is one conditional UPDATE, and the submission list uses flat queries (D1's parameter limit).
 */
import type { Prisma } from ".prisma/client-d1"

import { DomainError } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
import { requireActiveProgramme } from "@/lib/services/d1/programmes"
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

export async function listAssessments(db: D1Client, filter: { programmeId?: string } = {}, now = new Date()): Promise<AssessmentDto[]> {
  const rows = await db.assessment.findMany({
    where: filter.programmeId ? { programmeId: filter.programmeId } : undefined,
    orderBy: [{ submissionDeadline: "asc" }, { title: "asc" }],
    select: assessmentSelect,
  })
  return rows.map((row) => toAssessmentDto(row, now))
}

export async function getAssessment(db: D1Client, id: string, now = new Date()): Promise<AssessmentDto> {
  const row = await db.assessment.findUnique({ where: { id }, select: assessmentSelect })
  if (!row) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
  return toAssessmentDto(row, now)
}

export async function createAssessment(
  db: D1Client,
  input: AssessmentCreateInput,
  now = new Date()
): Promise<{ assessment: AssessmentDto; warnings: string[] }> {
  await requireActiveProgramme(db, input.programmeId)
  const row = await db.assessment.create({ data: input, select: assessmentSelect })
  return { assessment: toAssessmentDto(row, now), warnings: deadlineWarnings(input.submissionDeadline, now) }
}

/**
 * Edits an assessment or opens/closes it. Its programme is fixed once work has been submitted or graded.
 *
 * A programme move is one conditional UPDATE: it only applies while the assessment still has no
 * submissions and no results, so a submission arriving at the same moment cannot end up attached
 * to an assessment of another programme. (PostgreSQL checks, then updates.)
 */
export async function updateAssessment(db: D1Client, id: string, input: AssessmentUpdateInput, now = new Date()): Promise<AssessmentDto> {
  const current = await db.assessment.findUnique({ where: { id }, select: { programmeId: true } })
  if (!current) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)

  const { programmeId, ...fields } = input
  if (programmeId && programmeId !== current.programmeId) {
    await requireActiveProgramme(db, programmeId)
    // Raw SQL: Prisma may run an updateMany with relation filters as a read and a write.
    const moved = await db.$executeRaw`
      UPDATE "Assessment" SET "programmeId" = ${programmeId}, "updatedAt" = ${now}
      WHERE "id" = ${id}
        AND NOT EXISTS (SELECT 1 FROM "Submission" WHERE "assessmentId" = ${id})
        AND NOT EXISTS (SELECT 1 FROM "Result" WHERE "assessmentId" = ${id})`
    if (moved === 0) {
      const exists = await db.assessment.findUnique({ where: { id }, select: { id: true } })
      throw exists ? new DomainError("CONFLICT", PROGRAMME_LOCKED) : new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)
    }
    if (Object.keys(fields).length === 0) return getAssessment(db, id, now)
  }

  const row = await db.assessment.update({ where: { id }, data: fields, select: assessmentSelect })
  return toAssessmentDto(row, now)
}

/**
 * Pending submissions (§19): ENROLLED students of each open assessment's programme who have not
 * submitted. Deferred, withdrawn and completed students are not counted.
 */
export async function countPendingSubmissions(db: D1Client): Promise<number> {
  const open = await db.assessment.findMany({ where: { isOpen: true }, select: { id: true, programmeId: true } })
  const counts = await Promise.all(
    open.map((assessment) =>
      db.student.count({
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
 *
 * Three flat queries joined here, instead of nested `submissions`/`results` selections: on D1,
 * Prisma 6.12 loads a filtered nested relation with one bound parameter per parent row and fails
 * past ~98 students ("too many SQL variables"; see prisma/d1/README.md). Each query below has a
 * constant number of parameters. Unique (studentId, assessmentId) keeps it to one of each per student.
 */
export async function getAssessmentSubmissions(db: D1Client, assessmentId: string): Promise<AssessmentSubmissionRow[]> {
  const assessment = await db.assessment.findUnique({ where: { id: assessmentId }, select: { programmeId: true } })
  if (!assessment) throw new DomainError("NOT_FOUND", ASSESSMENT_NOT_FOUND)

  const [students, submissions, results] = await Promise.all([
    db.student.findMany({
      where: {
        programmeId: assessment.programmeId,
        OR: [
          { enrolmentStatus: "ENROLLED" },
          { submissions: { some: { assessmentId } } },
          { results: { some: { assessmentId } } },
        ],
      },
      orderBy: { studentId: "asc" },
      select: { id: true, studentId: true, fullName: true, enrolmentStatus: true },
    }),
    db.submission.findMany({
      where: { assessmentId },
      select: { studentId: true, id: true, fileName: true, fileType: true, fileSize: true, submittedAt: true, isLate: true },
    }),
    db.result.findMany({ where: { assessmentId }, select: { studentId: true, grade: true, published: true } }),
  ])

  const submissionOf = new Map(submissions.map(({ studentId, ...submission }) => [studentId, submission]))
  const resultOf = new Map(results.map(({ studentId, ...result }) => [studentId, result]))
  return toAssessmentSubmissionRows(
    students.map((student) => {
      const submission = submissionOf.get(student.id)
      const result = resultOf.get(student.id)
      return { ...student, submissions: submission ? [submission] : [], results: result ? [result] : [] }
    })
  )
}
