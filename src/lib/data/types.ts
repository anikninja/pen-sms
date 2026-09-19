/**
 * Everything the Next.js app reads or writes, as one interface with two implementations:
 * src/lib/data/postgres.ts (Prisma → PostgreSQL, the original path) and src/lib/data/worker.ts
 * (Cloudflare Worker → D1/R2). Pages, Server Actions, API routes and auth use only this, through
 * src/lib/data/index.ts. Reads are page-shaped, so a page render needs one Worker request.
 */
import type { Session } from "@/lib/auth/session-types"
import type { LoginAccount, PaymentRecord, UploadGrant } from "@/lib/data/contract"
import type { AssessmentDto } from "@/lib/services/shared/assessments"
import type { FeeOverviewRow, FeeSummary, PaymentDto, TariffDto } from "@/lib/services/shared/fees"
import type { GradingRows, StaffDashboard, StudentOverview } from "@/lib/services/shared/overviews"
import type { ProgrammeDto } from "@/lib/services/shared/programmes"
import type { MarksheetEntry, ResultDto, StaffResultRow } from "@/lib/services/shared/results"
import type { StudentDto } from "@/lib/services/shared/students"
import type { StudentAssessmentDto, SubmissionDto } from "@/lib/services/shared/submissions"
import type { AssessmentCreateInput, AssessmentUpdateInput } from "@/lib/validations/assessments"
import type { FeeAssignInput, PaymentCreateInput } from "@/lib/validations/fees"
import type { StudentCreateInput, StudentSearchInput, StudentUpdateInput } from "@/lib/validations/students"

export type { LoginAccount, PaymentRecord, UploadGrant } from "@/lib/data/contract"

export type StudentFees = { summary: FeeSummary; payments: PaymentDto[]; tariff: TariffDto | null }
export type SubmissionResult = SubmissionDto & { replaced: boolean }
export type DeclaredFile = { name: string; type: string; size: number }
export type SubmissionDownload =
  | { kind: "file"; content: Uint8Array; fileName: string; fileType: string }
  | { kind: "redirect"; url: string }

export interface DataApi {
  // Authentication
  /** The account for a sign-in attempt, with its bcrypt hash (compared by the caller). */
  findLoginAccount(email: string): Promise<LoginAccount | null>
  /** The user as the database has it now; null for a deleted account. */
  loadSession(userId: string): Promise<Session | null>

  // Staff pages
  getStaffDashboard(): Promise<StaffDashboard>
  getStudentsPage(search: StudentSearchInput): Promise<{ students: StudentDto[]; programmes: ProgrammeDto[] }>
  getStudentPage(id: string): Promise<{ student: StudentDto; fees: StudentFees; assessments: StudentAssessmentDto[]; results: StaffResultRow[] }>
  getStudentEditPage(id: string): Promise<{ student: StudentDto; programmes: ProgrammeDto[] }>
  listProgrammes(options?: { activeOnly?: boolean }): Promise<ProgrammeDto[]>
  listFeeOverview(filter?: { status?: FeeOverviewRow["status"] }): Promise<FeeOverviewRow[]>
  getAssessmentsPage(programmeCode: string | undefined): Promise<{ programmes: ProgrammeDto[]; assessments: AssessmentDto[] }>
  getAssessmentPage(id: string): Promise<{ assessment: AssessmentDto; grading: GradingRows; programmes: ProgrammeDto[] }>
  getResultsPage(requested: string | undefined): Promise<{
    assessments: AssessmentDto[]
    withheld: Record<string, number>
    selectedId: string | null
    grading: GradingRows | null
  }>

  // The signed-in student's pages. `studentId` is the session's own student.
  getMyOverview(studentId: string): Promise<StudentOverview>
  getMyFees(studentId: string): Promise<{ summary: FeeSummary; payments: PaymentDto[] }>
  getMyAssessments(studentId: string): Promise<StudentAssessmentDto[]>
  getMyMarksheet(studentId: string): Promise<MarksheetEntry[]>

  // Staff operations
  listStudents(search: StudentSearchInput): Promise<StudentDto[]>
  getStudent(id: string): Promise<StudentDto>
  createStudent(input: StudentCreateInput): Promise<StudentDto>
  updateStudent(id: string, input: StudentUpdateInput): Promise<StudentDto>
  getStudentFees(id: string): Promise<StudentFees>
  assignStudentFee(id: string, input: FeeAssignInput): Promise<FeeSummary>
  createPayment(id: string, input: PaymentCreateInput): Promise<PaymentRecord>
  listAssessments(filter: { programmeId?: string }): Promise<AssessmentDto[]>
  createAssessment(input: AssessmentCreateInput): Promise<{ assessment: AssessmentDto; warnings: string[] }>
  updateAssessment(id: string, input: AssessmentUpdateInput): Promise<AssessmentDto>
  upsertResult(studentId: string, assessmentId: string, grade: number): Promise<ResultDto>
  setResultPublished(studentId: string, assessmentId: string, published: boolean): Promise<ResultDto>
  setStudentResultsPublished(studentId: string, published: boolean): Promise<{ updated: number }>
  setAssessmentResultsPublished(assessmentId: string, published: boolean): Promise<{ updated: number }>

  // Submission files
  /** Receives a file on the server and stores the submission (Server Action / multipart API route). */
  submitAssessment(params: { studentId: string; assessmentId: string; file: File }): Promise<SubmissionResult>
  /**
   * A URL for the browser to upload the file directly (Worker backend), after every submission
   * check; null when the backend takes uploads through the server instead (PostgreSQL + local disk).
   */
  requestSubmissionUpload(assessmentId: string, file: DeclaredFile): Promise<UploadGrant | null>
  /** The file itself (PostgreSQL + local disk) or a short-lived URL to send the browser to (Worker + R2). */
  getSubmissionDownload(submissionId: string, session: Session): Promise<SubmissionDownload>
}
