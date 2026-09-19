/** Result DTOs and messages shared by the PostgreSQL and D1 result services. */
import { calculateClassification, type Classification } from "@/lib/domain/results"

export const NO_GRADE_YET = "No grade has been entered for this student and assessment yet."
export const WRONG_PROGRAMME = "This student is not in the assessment's programme."

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

export type StaffResultRow = ResultDto & { title: string; module: string }

export const toResultDto = (row: Omit<ResultDto, "classification">): ResultDto => ({
  ...row,
  classification: calculateClassification(row.grade),
})

export function toMarksheetEntry(row: { assessmentId: string; grade: number; assessment: { title: string; module: string } }): MarksheetEntry {
  return {
    assessmentId: row.assessmentId,
    title: row.assessment.title,
    module: row.assessment.module,
    grade: row.grade,
    classification: calculateClassification(row.grade),
  }
}
