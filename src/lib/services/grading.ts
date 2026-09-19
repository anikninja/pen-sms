import { getAssessmentSubmissions } from "@/lib/services/assessments"
import { listFeeOverview } from "@/lib/services/fees"
import { buildGradingRows, type GradingRows } from "@/lib/services/shared/overviews"

/**
 * Submission and grade rows for one assessment, with each student's overdue balance so staff are
 * warned before publishing (architecture.md §13, §22, §23).
 */
export async function getGradingRows(assessmentId: string): Promise<GradingRows> {
  const [rows, fees] = await Promise.all([getAssessmentSubmissions(assessmentId), listFeeOverview({ status: "OVERDUE" })])
  return buildGradingRows(rows, fees)
}
