import { getAssessmentSubmissions } from "@/lib/services/assessments"
import { listFeeOverview } from "@/lib/services/fees"

/**
 * Submission and grade rows for one assessment, with each student's overdue balance so staff are
 * warned before publishing (architecture.md §13, §22, §23).
 */
export async function getGradingRows(assessmentId: string) {
  const [rows, fees] = await Promise.all([getAssessmentSubmissions(assessmentId), listFeeOverview({ status: "OVERDUE" })])
  const overdueByStudent = new Map(fees.map((fee) => [fee.student.id, fee]))

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
