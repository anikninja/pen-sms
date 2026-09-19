/**
 * The Worker API's response contract (worker/API.md), as zod schemas. The Next.js client validates
 * every response with these before using it, and they turn the ISO date strings of JSON back into
 * Date objects, so pages get exactly the DTOs the PostgreSQL services return. Each schema is checked
 * against its DTO type at compile time (`satisfies z.ZodType<Dto>`).
 */
import { z } from "zod"

import type { Session } from "@/lib/auth/session-types"
import { ENROLMENT_STATUSES, ROLES } from "@/lib/domain/enums"
import type { AssessmentDto, AssessmentSubmissionRow } from "@/lib/services/shared/assessments"
import type { FeeOverviewRow, FeeSummary, PaymentDto, TariffDto } from "@/lib/services/shared/fees"
import type { GradingRows, StaffDashboard, StudentOverview } from "@/lib/services/shared/overviews"
import type { ProgrammeDto } from "@/lib/services/shared/programmes"
import type { MarksheetEntry, ResultDto, StaffResultRow } from "@/lib/services/shared/results"
import type { StudentDto } from "@/lib/services/shared/students"
import type { StudentAssessmentDto, SubmissionDto } from "@/lib/services/shared/submissions"

const date = z.coerce.date()
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const money = z.string().regex(/^-?\d+\.\d{2}$/)
const enrolmentStatus = z.enum(ENROLMENT_STATUSES)
const classification = z.enum(["Distinction", "Merit", "Pass", "Fail"])
const feeStatus = z.enum(["NO_FEE", "PAID", "OVERDUE", "OUTSTANDING"])
const submissionStatus = z.enum(["SUBMITTED", "LATE", "PENDING"])

export const sessionSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  studentId: z.string().nullable(),
}) satisfies z.ZodType<Session>

export const loginAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  studentId: z.string().nullable(),
  passwordHash: z.string(),
})
export type LoginAccount = z.output<typeof loginAccountSchema>

export const programmeSchema = z.object({ id: z.string(), code: z.string(), name: z.string(), active: z.boolean() }) satisfies z.ZodType<ProgrammeDto>

export const studentSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  fullName: z.string(),
  email: z.string(),
  dateOfBirth: calendarDay,
  academicYear: z.number().int(),
  enrolmentStatus,
  programme: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  hasLogin: z.boolean(),
  createdAt: date,
  updatedAt: date,
}) satisfies z.ZodType<StudentDto>

export const feeSummarySchema = z.object({
  currency: z.string(),
  totalFee: money,
  totalPaid: money,
  outstanding: money,
  dueDate: date.nullable(),
  isOverdue: z.boolean(),
  daysOverdue: z.number().int(),
  status: feeStatus,
  hasFeeAssigned: z.boolean(),
  matchesTariff: z.boolean(),
  source: z.enum(["TARIFF", "MANUAL"]).nullable(),
}) satisfies z.ZodType<FeeSummary>

export const paymentSchema = z.object({
  id: z.string(),
  amount: money,
  paymentDate: calendarDay,
  referenceNumber: z.string(),
  createdAt: date,
}) satisfies z.ZodType<PaymentDto>

/** A newly recorded payment, as POST /api/students/:id/payments has always returned it. */
export const paymentRecordSchema = paymentSchema.extend({ studentId: z.string(), updatedAt: date })
export type PaymentRecord = z.output<typeof paymentRecordSchema>

export const tariffSchema = z.object({ amount: money, currency: z.string(), dueDate: date }) satisfies z.ZodType<TariffDto>

export const studentFeesSchema = z.object({ summary: feeSummarySchema, payments: z.array(paymentSchema), tariff: tariffSchema.nullable() })

export const feeOverviewRowSchema = z.object({
  student: z.object({
    id: z.string(),
    studentId: z.string(),
    fullName: z.string(),
    enrolmentStatus,
    programme: z.object({ code: z.string(), name: z.string() }),
  }),
  status: feeStatus,
  currency: z.string().nullable(),
  totalFee: money,
  totalPaid: money,
  outstanding: money,
  dueDate: date.nullable(),
  daysOverdue: z.number().int(),
}) satisfies z.ZodType<FeeOverviewRow>

export const assessmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
  submissionDeadline: date,
  isOpen: z.boolean(),
  isPastDeadline: z.boolean(),
  programme: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  submissionCount: z.number().int(),
  gradedCount: z.number().int(),
  createdAt: date,
  updatedAt: date,
}) satisfies z.ZodType<AssessmentDto>

const assessmentSubmissionRowShape = {
  student: z.object({ id: z.string(), studentId: z.string(), fullName: z.string(), enrolmentStatus }),
  status: submissionStatus,
  submission: z
    .object({ id: z.string(), fileName: z.string(), fileType: z.string(), fileSize: z.number().int(), submittedAt: date, isLate: z.boolean() })
    .nullable(),
  result: z.object({ grade: z.number().int(), classification, published: z.boolean() }).nullable(),
}
export const assessmentSubmissionRowSchema = z.object(assessmentSubmissionRowShape) satisfies z.ZodType<AssessmentSubmissionRow>

export const gradingRowsSchema = z.object({
  rows: z.array(
    z.object({
      ...assessmentSubmissionRowShape,
      overdue: z.object({ outstanding: money, currency: z.string(), daysOverdue: z.number().int() }).nullable(),
    })
  ),
  counts: z.object({
    students: z.number().int(),
    submitted: z.number().int(),
    late: z.number().int(),
    pending: z.number().int(),
    graded: z.number().int(),
    unpublished: z.number().int(),
    overdueGraded: z.number().int(),
  }),
}) satisfies z.ZodType<GradingRows>

export const submissionSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number().int(),
  submittedAt: date,
  isLate: z.boolean(),
}) satisfies z.ZodType<SubmissionDto>

export const submissionResultSchema = z.object({ submission: submissionSchema.extend({ replaced: z.boolean() }) })

export const studentAssessmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
  submissionDeadline: date,
  isOpen: z.boolean(),
  isPastDeadline: z.boolean(),
  status: submissionStatus,
  submission: submissionSchema.nullable(),
  canUpload: z.boolean(),
  uploadBlockedReason: z.string().nullable(),
}) satisfies z.ZodType<StudentAssessmentDto>

export const resultSchema = z.object({
  studentId: z.string(),
  assessmentId: z.string(),
  grade: z.number().int(),
  classification,
  published: z.boolean(),
  updatedAt: date,
}) satisfies z.ZodType<ResultDto>

export const staffResultRowSchema = resultSchema.extend({ title: z.string(), module: z.string() }) satisfies z.ZodType<StaffResultRow>

export const marksheetEntrySchema = z.object({
  assessmentId: z.string(),
  title: z.string(),
  module: z.string(),
  grade: z.number().int(),
  classification,
}) satisfies z.ZodType<MarksheetEntry>

export const staffDashboardSchema = z.object({
  totalStudents: z.number().int(),
  enrolledStudents: z.number().int(),
  totalOutstanding: z.array(z.object({ currency: z.string(), amount: money })),
  overdueStudents: z.number().int(),
  pendingSubmissions: z.number().int(),
  unpublishedResults: z.number().int(),
  overdue: z.array(feeOverviewRowSchema),
}) satisfies z.ZodType<StaffDashboard>

export const studentOverviewSchema = z.object({
  student: studentSchema,
  fee: feeSummarySchema,
  nextDeadline: studentAssessmentSchema.nullable(),
  counts: z.object({ toSubmit: z.number().int(), late: z.number().int(), publishedResults: z.number().int() }),
}) satisfies z.ZodType<StudentOverview>

export const uploadGrantSchema = z.object({
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.object({ "Content-Type": z.string() }),
  expiresAt: date,
  maxBytes: z.number().int(),
})
export type UploadGrant = z.output<typeof uploadGrantSchema>

export const downloadGrantSchema = z.object({ url: z.string().url(), expiresAt: date })
