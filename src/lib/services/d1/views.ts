/**
 * Page-shaped reads on Cloudflare D1: everything one page needs, in one call, so the Next.js app
 * makes one request to the Worker per page instead of one per service (worker/API.md, "Views").
 * Each view composes the D1 services and the shared builders exactly as the PostgreSQL pages do.
 */
import type { D1Client } from "@/lib/services/d1/client"
import { countPendingSubmissions, getAssessment, getAssessmentSubmissions, listAssessments } from "@/lib/services/d1/assessments"
import { getStudentFees, getStudentFeeSummary, listFeeOverview, listPayments } from "@/lib/services/d1/fees"
import { listProgrammes } from "@/lib/services/d1/programmes"
import { countWithheldByAssessment, getStudentPublishedResults, getStudentResults } from "@/lib/services/d1/results"
import { getStudent, listStudents } from "@/lib/services/d1/students"
import { getStudentAssessments } from "@/lib/services/d1/submissions"
import {
  buildGradingRows,
  buildStaffDashboard,
  buildStudentOverview,
  type GradingRows,
  type StaffDashboard,
  type StudentOverview,
} from "@/lib/services/shared/overviews"
import type { StudentSearchInput } from "@/lib/validations/students"

export async function getStaffDashboard(db: D1Client, now = new Date()): Promise<StaffDashboard> {
  const [totalStudents, enrolledStudents, fees, pendingSubmissions, unpublishedResults] = await Promise.all([
    db.student.count(),
    db.student.count({ where: { enrolmentStatus: "ENROLLED" } }),
    listFeeOverview(db, {}, now),
    countPendingSubmissions(db),
    db.result.count({ where: { published: false } }),
  ])
  return buildStaffDashboard({ totalStudents, enrolledStudents, fees, pendingSubmissions, unpublishedResults })
}

export async function getGradingRows(db: D1Client, assessmentId: string, now = new Date()): Promise<GradingRows> {
  const [rows, fees] = await Promise.all([getAssessmentSubmissions(db, assessmentId), listFeeOverview(db, { status: "OVERDUE" }, now)])
  return buildGradingRows(rows, fees)
}

/** Staff › Students: the filtered list and every programme (for the filter). */
export async function getStudentsPage(db: D1Client, search: StudentSearchInput) {
  const [students, programmes] = await Promise.all([listStudents(db, search), listProgrammes(db)])
  return { students, programmes }
}

/** Staff › Student: details, fees and payments, the programme's assessments with this student's work, results. */
export async function getStudentPage(db: D1Client, studentId: string, now = new Date()) {
  const student = await getStudent(db, studentId) // NOT_FOUND first, as on the page
  const [fees, assessments, results] = await Promise.all([
    getStudentFees(db, studentId, now),
    getStudentAssessments(db, studentId, now),
    getStudentResults(db, studentId),
  ])
  return { student, fees, assessments, results }
}

/** Staff › Student › Edit. */
export async function getStudentEditPage(db: D1Client, studentId: string) {
  const [student, programmes] = await Promise.all([getStudent(db, studentId), listProgrammes(db)])
  return { student, programmes }
}

/** Staff › Assessments, optionally for one programme (by code, as in the page URL). */
export async function getAssessmentsPage(db: D1Client, programmeCode: string | undefined, now = new Date()) {
  const programmes = await listProgrammes(db)
  const programme = programmes.find((candidate) => candidate.code === programmeCode)
  const assessments = await listAssessments(db, { programmeId: programme?.id }, now)
  return { programmes, assessments }
}

/** Staff › Assessment: the assessment, its submission and grade rows, and the programmes for the edit form. */
export async function getAssessmentPage(db: D1Client, assessmentId: string, now = new Date()) {
  const assessment = await getAssessment(db, assessmentId, now) // NOT_FOUND first, as on the page
  const [grading, programmes] = await Promise.all([getGradingRows(db, assessmentId, now), listProgrammes(db)])
  return { assessment, grading, programmes }
}

/**
 * Staff › Results. Without a requested assessment, shows the first one that still has withheld
 * results (then the first one); a requested id that does not exist selects nothing.
 */
export async function getResultsPage(db: D1Client, requested: string | undefined, now = new Date()) {
  const [assessments, withheld] = await Promise.all([listAssessments(db, {}, now), countWithheldByAssessment(db)])
  const selected =
    assessments.find((assessment) => assessment.id === requested) ??
    (requested ? null : (assessments.find((assessment) => Object.hasOwn(withheld, assessment.id)) ?? assessments[0] ?? null))
  const grading = selected ? await getGradingRows(db, selected.id, now) : null
  return { assessments, withheld, selectedId: selected?.id ?? null, grading }
}

/** Student › Dashboard. */
export async function getStudentOverview(db: D1Client, studentId: string, now = new Date()): Promise<StudentOverview> {
  const [student, fee, assessments, results] = await Promise.all([
    getStudent(db, studentId),
    getStudentFeeSummary(db, studentId, now),
    getStudentAssessments(db, studentId, now),
    getStudentPublishedResults(db, studentId),
  ])
  return buildStudentOverview({ student, fee, assessments, results }, now)
}

/** Student › Fees. */
export async function getMyFeesPage(db: D1Client, studentId: string, now = new Date()) {
  const [summary, payments] = await Promise.all([getStudentFeeSummary(db, studentId, now), listPayments(db, studentId)])
  return { summary, payments }
}
