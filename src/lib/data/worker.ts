/**
 * The Cloudflare path: every read and write is one request to the Worker API (worker/API.md),
 * signed for the signed-in user. There are no database credentials here. Only loaded when
 * DATA_BACKEND is "worker" (src/lib/data/index.ts).
 *
 * The user id comes from the Auth.js session cookie of the current request; the Worker reads that
 * user's role and student link from D1 itself, so nothing here grants permissions. bcrypt runs here,
 * not in the Worker (Workers Free CPU limit): new passwords are hashed before they are sent.
 */
import bcrypt from "bcryptjs"
import { z } from "zod"

import { auth } from "@/auth"
import { callWorker, putToWorker } from "@/lib/api/worker-client"
import {
  assessmentSchema,
  downloadGrantSchema,
  feeOverviewRowSchema,
  feeSummarySchema,
  gradingRowsSchema,
  loginAccountSchema,
  marksheetEntrySchema,
  paymentRecordSchema,
  paymentSchema,
  programmeSchema,
  resultSchema,
  sessionSchema,
  staffDashboardSchema,
  staffResultRowSchema,
  studentAssessmentSchema,
  studentFeesSchema,
  studentOverviewSchema,
  studentSchema,
  submissionResultSchema,
  uploadGrantSchema,
} from "@/lib/data/contract"
import type { DataApi } from "@/lib/data/types"
import { DomainError } from "@/lib/errors"
import type { StudentCreateRecord } from "@/lib/validations/students"

const BCRYPT_COST = 10

/** The signed-in user's id from the Auth.js session cookie; the Worker authorises it. */
async function currentUserId(): Promise<string> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) throw new DomainError("UNAUTHORIZED", "Please sign in.")
  return userId
}

type Request<S extends z.ZodType> = Omit<Parameters<typeof callWorker<S>>[0], "userId">

/** A request for the signed-in user. */
async function call<S extends z.ZodType>(request: Request<S>): Promise<z.output<S>> {
  return callWorker({ ...request, userId: await currentUserId() })
}

const students = z.object({ students: z.array(studentSchema) })
const student = z.object({ student: studentSchema })
const programmes = z.object({ programmes: z.array(programmeSchema) })
const assessment = z.object({ assessment: assessmentSchema })
const assessments = z.object({ assessments: z.array(assessmentSchema) })
const myAssessments = z.object({ assessments: z.array(studentAssessmentSchema) })
const result = z.object({ result: resultSchema })
const updated = z.object({ updated: z.number().int() })

export const workerData: DataApi = {
  async findLoginAccount(email) {
    // Before sign-in there is no user: a service call (the token carries no user id).
    const { user } = await callWorker({
      method: "POST",
      path: "/v1/auth/lookup",
      body: { email },
      userId: null,
      schema: z.object({ user: loginAccountSchema.nullable() }),
    })
    return user
  },

  async loadSession(userId) {
    try {
      const { session } = await callWorker({ method: "GET", path: "/v1/session", userId, schema: z.object({ session: sessionSchema }) })
      return session
    } catch (error) {
      // A deleted account (or a role that no longer exists) is simply signed out.
      if (error instanceof DomainError && error.code === "UNAUTHORIZED") return null
      throw error
    }
  },

  getStaffDashboard: () => call({ method: "GET", path: "/v1/views/dashboard", schema: staffDashboardSchema }),

  getStudentsPage: (search) =>
    call({
      method: "GET",
      path: "/v1/views/students",
      query: search,
      schema: z.object({ students: z.array(studentSchema), programmes: z.array(programmeSchema) }),
    }),

  getStudentPage: (id) =>
    call({
      method: "GET",
      path: `/v1/views/students/${encodeURIComponent(id)}`,
      schema: z.object({
        student: studentSchema,
        fees: studentFeesSchema,
        assessments: z.array(studentAssessmentSchema),
        results: z.array(staffResultRowSchema),
      }),
    }),

  getStudentEditPage: (id) =>
    call({
      method: "GET",
      path: `/v1/views/students/${encodeURIComponent(id)}/edit`,
      schema: z.object({ student: studentSchema, programmes: z.array(programmeSchema) }),
    }),

  async listProgrammes(options = {}) {
    return (await call({ method: "GET", path: "/v1/programmes", query: { activeOnly: options.activeOnly ? "true" : undefined }, schema: programmes })).programmes
  },

  async listFeeOverview(filter = {}) {
    return (await call({ method: "GET", path: "/v1/fees", query: { status: filter.status }, schema: z.object({ rows: z.array(feeOverviewRowSchema) }) })).rows
  },

  getAssessmentsPage: (programmeCode) =>
    call({
      method: "GET",
      path: "/v1/views/assessments",
      query: { programme: programmeCode },
      schema: z.object({ programmes: z.array(programmeSchema), assessments: z.array(assessmentSchema) }),
    }),

  getAssessmentPage: (id) =>
    call({
      method: "GET",
      path: `/v1/views/assessments/${encodeURIComponent(id)}`,
      schema: z.object({ assessment: assessmentSchema, grading: gradingRowsSchema, programmes: z.array(programmeSchema) }),
    }),

  getResultsPage: (requested) =>
    call({
      method: "GET",
      path: "/v1/views/results",
      query: { assessment: requested },
      schema: z.object({
        assessments: z.array(assessmentSchema),
        withheld: z.record(z.string(), z.number().int()),
        selectedId: z.string().nullable(),
        grading: gradingRowsSchema.nullable(),
      }),
    }),

  // The Worker always uses the session's own student; the id is not sent.
  getMyOverview: () => call({ method: "GET", path: "/v1/me/overview", schema: studentOverviewSchema }),
  getMyFees: () => call({ method: "GET", path: "/v1/me/fees", schema: z.object({ summary: feeSummarySchema, payments: z.array(paymentSchema) }) }),
  async getMyAssessments() {
    return (await call({ method: "GET", path: "/v1/me/assessments", schema: myAssessments })).assessments
  },
  async getMyMarksheet() {
    return (await call({ method: "GET", path: "/v1/me/marksheet", schema: z.object({ results: z.array(marksheetEntrySchema) }) })).results
  },

  async listStudents(search) {
    return (await call({ method: "GET", path: "/v1/students", query: search, schema: students })).students
  },
  async getStudent(id) {
    return (await call({ method: "GET", path: `/v1/students/${encodeURIComponent(id)}`, schema: student })).student
  },
  async createStudent(input) {
    const { password, ...fields } = input
    const record: StudentCreateRecord = { ...fields, ...(password ? { passwordHash: await bcrypt.hash(password, BCRYPT_COST) } : {}) }
    return (await call({ method: "POST", path: "/v1/students", body: record, schema: student })).student
  },
  async updateStudent(id, input) {
    return (await call({ method: "PATCH", path: `/v1/students/${encodeURIComponent(id)}`, body: input, schema: student })).student
  },
  getStudentFees: (id) => call({ method: "GET", path: `/v1/students/${encodeURIComponent(id)}/fees`, schema: studentFeesSchema }),
  async assignStudentFee(id, input) {
    return (await call({ method: "PUT", path: `/v1/students/${encodeURIComponent(id)}/fee`, body: input, schema: z.object({ summary: feeSummarySchema }) })).summary
  },
  async createPayment(id, input) {
    return (await call({ method: "POST", path: `/v1/students/${encodeURIComponent(id)}/payments`, body: input, schema: z.object({ payment: paymentRecordSchema }) })).payment
  },

  async listAssessments(filter) {
    return (await call({ method: "GET", path: "/v1/assessments", query: { programmeId: filter.programmeId }, schema: assessments })).assessments
  },
  createAssessment: (input) =>
    call({ method: "POST", path: "/v1/assessments", body: input, schema: z.object({ assessment: assessmentSchema, warnings: z.array(z.string()) }) }),
  async updateAssessment(id, input) {
    return (await call({ method: "PATCH", path: `/v1/assessments/${encodeURIComponent(id)}`, body: input, schema: assessment })).assessment
  },

  async upsertResult(studentId, assessmentId, grade) {
    const path = `/v1/students/${encodeURIComponent(studentId)}/results/${encodeURIComponent(assessmentId)}`
    return (await call({ method: "PUT", path, body: { grade }, schema: result })).result
  },
  async setResultPublished(studentId, assessmentId, published) {
    const path = `/v1/students/${encodeURIComponent(studentId)}/results/${encodeURIComponent(assessmentId)}`
    return (await call({ method: "PATCH", path, body: { published }, schema: result })).result
  },
  setStudentResultsPublished: (studentId, published) =>
    call({ method: "POST", path: `/v1/students/${encodeURIComponent(studentId)}/results/publish`, body: { published }, schema: updated }),
  setAssessmentResultsPublished: (assessmentId, published) =>
    call({ method: "POST", path: `/v1/assessments/${encodeURIComponent(assessmentId)}/results/publish`, body: { published }, schema: updated }),

  async requestSubmissionUpload(assessmentId, file) {
    const { upload } = await call({
      method: "POST",
      path: `/v1/assessments/${encodeURIComponent(assessmentId)}/submissions/upload-url`,
      body: { fileName: file.name, fileType: file.type, fileSize: file.size },
      schema: z.object({ upload: uploadGrantSchema }),
    })
    return upload
  },

  /** A file received by the Next.js server (multipart API route): forwarded to the Worker through a signed upload URL. */
  async submitAssessment({ assessmentId, file }) {
    const grant = await workerData.requestSubmissionUpload(assessmentId, { name: file.name, type: file.type, size: file.size })
    if (!grant) throw new DomainError("INTERNAL", "Uploads are not available.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    return (await putToWorker(grant.url, { type: grant.headers["Content-Type"], bytes }, submissionResultSchema)).submission
  },

  async getSubmissionDownload(submissionId) {
    const { download } = await call({
      method: "POST",
      path: `/v1/files/${encodeURIComponent(submissionId)}/download-url`,
      schema: z.object({ download: downloadGrantSchema }),
    })
    return { kind: "redirect", url: download.url }
  },
}
