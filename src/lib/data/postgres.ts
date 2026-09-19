/**
 * The original data path: Prisma straight to PostgreSQL, files on the local disk. Only loaded when
 * DATA_BACKEND is "postgres" (src/lib/data/index.ts imports it lazily), so a Worker deployment never
 * creates a PostgreSQL client. Each view composes the PostgreSQL services exactly as the pages did.
 */
import { prisma } from "@/lib/prisma"
import * as assessments from "@/lib/services/assessments"
import { getStaffDashboard } from "@/lib/services/dashboard"
import * as fees from "@/lib/services/fees"
import { getGradingRows } from "@/lib/services/grading"
import { listProgrammes } from "@/lib/services/programmes"
import * as results from "@/lib/services/results"
import { getStudentOverview } from "@/lib/services/student-portal"
import * as students from "@/lib/services/students"
import * as submissions from "@/lib/services/submissions"
import type { DataApi } from "@/lib/data/types"

export const postgresData: DataApi = {
  async findLoginAccount(email) {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, studentId: true, passwordHash: true },
    })
  },

  async loadSession(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, studentId: true },
    })
    return user ? { userId: user.id, name: user.name, email: user.email, role: user.role, studentId: user.studentId } : null
  },

  getStaffDashboard: () => getStaffDashboard(),

  async getStudentsPage(search) {
    const [list, programmes] = await Promise.all([students.listStudents(search), listProgrammes()])
    return { students: list, programmes }
  },

  async getStudentPage(id) {
    const student = await students.getStudent(id)
    const [studentFees, studentAssessments, studentResults] = await Promise.all([
      fees.getStudentFees(id),
      submissions.getStudentAssessments(id),
      results.getStudentResults(id),
    ])
    return { student, fees: studentFees, assessments: studentAssessments, results: studentResults }
  },

  async getStudentEditPage(id) {
    const [student, programmes] = await Promise.all([students.getStudent(id), listProgrammes()])
    return { student, programmes }
  },

  listProgrammes: (options) => listProgrammes(options),
  listFeeOverview: (filter) => fees.listFeeOverview(filter),

  async getAssessmentsPage(programmeCode) {
    const programmes = await listProgrammes()
    const programme = programmes.find((candidate) => candidate.code === programmeCode)
    return { programmes, assessments: await assessments.listAssessments({ programmeId: programme?.id }) }
  },

  async getAssessmentPage(id) {
    const assessment = await assessments.getAssessment(id)
    const [grading, programmes] = await Promise.all([getGradingRows(id), listProgrammes()])
    return { assessment, grading, programmes }
  },

  async getResultsPage(requested) {
    const [list, withheldRows] = await Promise.all([
      assessments.listAssessments(),
      prisma.result.groupBy({ by: ["assessmentId"], where: { published: false }, _count: { _all: true } }),
    ])
    const withheld = Object.fromEntries(withheldRows.map((row) => [row.assessmentId, row._count._all]))
    // Default to the first assessment that still has withheld results, so outstanding work is shown first.
    const selected =
      list.find((assessment) => assessment.id === requested) ??
      (requested ? null : (list.find((assessment) => Object.hasOwn(withheld, assessment.id)) ?? list[0] ?? null))
    return { assessments: list, withheld, selectedId: selected?.id ?? null, grading: selected ? await getGradingRows(selected.id) : null }
  },

  getMyOverview: (studentId) => getStudentOverview(studentId),
  async getMyFees(studentId) {
    const [summary, payments] = await Promise.all([fees.getStudentFeeSummary(studentId), fees.listPayments(studentId)])
    return { summary, payments }
  },
  getMyAssessments: (studentId) => submissions.getStudentAssessments(studentId),
  getMyMarksheet: (studentId) => results.getStudentPublishedResults(studentId),

  listStudents: (search) => students.listStudents(search),
  getStudent: (id) => students.getStudent(id),
  createStudent: (input) => students.createStudent(input),
  updateStudent: (id, input) => students.updateStudent(id, input),
  getStudentFees: (id) => fees.getStudentFees(id),
  assignStudentFee: (id, input) => fees.assignStudentFee(id, input),
  createPayment: (id, input) => fees.createPayment(id, input),
  listAssessments: (filter) => assessments.listAssessments(filter),
  createAssessment: (input) => assessments.createAssessment(input),
  updateAssessment: (id, input) => assessments.updateAssessment(id, input),
  upsertResult: (studentId, assessmentId, grade) => results.upsertResult(studentId, assessmentId, grade),
  setResultPublished: (studentId, assessmentId, published) => results.setResultPublished(studentId, assessmentId, published),
  setStudentResultsPublished: (studentId, published) => results.setStudentResultsPublished(studentId, published),
  setAssessmentResultsPublished: (assessmentId, published) => results.setAssessmentResultsPublished(assessmentId, published),

  submitAssessment: (params) => submissions.submitAssessment(params),
  // Uploads go through the server here (Server Action / multipart route), as before.
  requestSubmissionUpload: async () => null,
  async getSubmissionDownload(submissionId, session) {
    const file = await submissions.getSubmissionFile(submissionId, session)
    return { kind: "file", content: new Uint8Array(file.content), fileName: file.fileName, fileType: file.fileType }
  },
}
