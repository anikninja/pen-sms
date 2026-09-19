/**
 * Page-level views built from other services' results: the staff dashboard, grading rows and the
 * student overview. Pure functions, shared by the PostgreSQL and D1 implementations.
 */
import type { AssessmentSubmissionRow } from "@/lib/services/shared/assessments"
import { totalOutstandingByCurrency, type FeeOverviewRow, type FeeSummary } from "@/lib/services/shared/fees"
import type { MarksheetEntry } from "@/lib/services/shared/results"
import type { StudentDto } from "@/lib/services/shared/students"
import type { StudentAssessmentDto } from "@/lib/services/shared/submissions"

export type StaffDashboard = {
  totalStudents: number
  enrolledStudents: number
  totalOutstanding: { currency: string; amount: string }[]
  overdueStudents: number
  pendingSubmissions: number
  unpublishedResults: number
  overdue: FeeOverviewRow[]
}

/** The six Registry dashboard figures and the overdue fees table (architecture.md §19). */
export function buildStaffDashboard(input: {
  totalStudents: number
  enrolledStudents: number
  fees: FeeOverviewRow[]
  pendingSubmissions: number
  unpublishedResults: number
}): StaffDashboard {
  const overdue = input.fees
    .filter((row) => row.status === "OVERDUE")
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.student.studentId.localeCompare(b.student.studentId))

  return {
    totalStudents: input.totalStudents,
    enrolledStudents: input.enrolledStudents,
    totalOutstanding: totalOutstandingByCurrency(input.fees),
    overdueStudents: overdue.length,
    pendingSubmissions: input.pendingSubmissions,
    unpublishedResults: input.unpublishedResults,
    overdue,
  }
}

export type GradingRow = AssessmentSubmissionRow & {
  overdue: { outstanding: string; currency: string; daysOverdue: number } | null
}

export type GradingRows = {
  rows: GradingRow[]
  counts: {
    students: number
    submitted: number
    late: number
    pending: number
    graded: number
    unpublished: number
    overdueGraded: number
  }
}

/**
 * Submission and grade rows for one assessment, with each student's overdue balance so staff are
 * warned before publishing (architecture.md §13, §22, §23). `overdueFees` are the OVERDUE rows of the fee overview.
 */
export function buildGradingRows(rows: AssessmentSubmissionRow[], overdueFees: FeeOverviewRow[]): GradingRows {
  const overdueByStudent = new Map(overdueFees.map((fee) => [fee.student.id, fee]))

  const gradingRows = rows.map((row) => {
    const fee = overdueByStudent.get(row.student.id)
    return {
      ...row,
      overdue: fee ? { outstanding: fee.outstanding, currency: fee.currency ?? "", daysOverdue: fee.daysOverdue } : null,
    }
  })

  const graded = gradingRows.filter((row) => row.result)
  return {
    rows: gradingRows,
    counts: {
      students: gradingRows.length,
      submitted: gradingRows.filter((row) => row.status !== "PENDING").length,
      late: gradingRows.filter((row) => row.status === "LATE").length,
      pending: gradingRows.filter((row) => row.status === "PENDING" && row.student.enrolmentStatus === "ENROLLED").length,
      graded: graded.length,
      unpublished: graded.filter((row) => !row.result!.published).length,
      overdueGraded: graded.filter((row) => row.overdue).length,
    },
  }
}

export type StudentOverview = {
  student: StudentDto
  fee: FeeSummary
  nextDeadline: StudentAssessmentDto | null
  counts: { toSubmit: number; late: number; publishedResults: number }
}

/** Everything the student dashboard shows at a glance (architecture.md §24). */
export function buildStudentOverview(
  input: { student: StudentDto; fee: FeeSummary; assessments: StudentAssessmentDto[]; results: MarksheetEntry[] },
  now: Date
): StudentOverview {
  const { student, fee, assessments, results } = input
  // Upcoming = open and not yet past its deadline; the soonest one is the "next deadline".
  const upcoming = assessments.filter((assessment) => assessment.isOpen && assessment.submissionDeadline.getTime() >= now.getTime())

  return {
    student,
    fee,
    nextDeadline: upcoming[0] ?? null,
    counts: {
      toSubmit: assessments.filter((assessment) => assessment.status === "PENDING" && assessment.canUpload).length,
      late: assessments.filter((assessment) => assessment.status === "LATE").length,
      publishedResults: results.length,
    },
  }
}
