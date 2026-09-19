import { getStudentFeeSummary } from "@/lib/services/fees"
import { getStudentPublishedResults } from "@/lib/services/results"
import { buildStudentOverview, type StudentOverview } from "@/lib/services/shared/overviews"
import { getStudent } from "@/lib/services/students"
import { getStudentAssessments } from "@/lib/services/submissions"

/**
 * Everything the student dashboard shows at a glance (architecture.md §24). The student id always
 * comes from the session; nothing here is ever looked up by a value from the URL.
 */
export async function getStudentOverview(studentId: string, now = new Date()): Promise<StudentOverview> {
  const [student, fee, assessments, results] = await Promise.all([
    getStudent(studentId),
    getStudentFeeSummary(studentId, now),
    getStudentAssessments(studentId),
    getStudentPublishedResults(studentId),
  ])
  return buildStudentOverview({ student, fee, assessments, results }, now)
}
