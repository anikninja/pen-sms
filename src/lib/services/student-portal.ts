import { getStudentFeeSummary } from "@/lib/services/fees"
import { getStudentPublishedResults } from "@/lib/services/results"
import { getStudent } from "@/lib/services/students"
import { getStudentAssessments, type StudentAssessmentDto } from "@/lib/services/submissions"

/**
 * Everything the student dashboard shows at a glance (architecture.md §24). The student id always
 * comes from the session; nothing here is ever looked up by a value from the URL.
 */
export async function getStudentOverview(studentId: string, now = new Date()) {
  const [student, fee, assessments, results] = await Promise.all([
    getStudent(studentId),
    getStudentFeeSummary(studentId, now),
    getStudentAssessments(studentId),
    getStudentPublishedResults(studentId),
  ])

  // Upcoming = open and not yet past its deadline; the soonest one is the "next deadline".
  const upcoming = assessments.filter((assessment) => assessment.isOpen && assessment.submissionDeadline.getTime() >= now.getTime())
  const nextDeadline: StudentAssessmentDto | null = upcoming[0] ?? null

  return {
    student,
    fee,
    nextDeadline,
    counts: {
      toSubmit: assessments.filter((assessment) => assessment.status === "PENDING" && assessment.canUpload).length,
      late: assessments.filter((assessment) => assessment.status === "LATE").length,
      publishedResults: results.length,
    },
  }
}
