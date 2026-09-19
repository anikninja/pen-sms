/**
 * Staff operations on students, their fees, payments and results. Same request and response shapes
 * as the Next.js JSON API (src/app/api/students/…), plus `code` on errors.
 */
import { assignStudentFee, createPayment, getStudentFees } from "@/lib/services/d1/fees"
import { setResultPublished, setStudentResultsPublished, upsertResult } from "@/lib/services/d1/results"
import { createStudent, getStudent, listStudents, updateStudent } from "@/lib/services/d1/students"
import { feeAssignSchema, paymentCreateSchema } from "@/lib/validations/fees"
import { parseId } from "@/lib/validations/ids"
import { publishSchema, resultUpsertSchema } from "@/lib/validations/results"
import { studentCreateRecordSchema, studentSearchSchema, studentUpdateSchema } from "@/lib/validations/students"

import { json } from "../http"
import type { RouteContext } from "../router"
import { bodyOf, queryOf } from "./common"

const studentIdParam = (context: RouteContext) => parseId(context.params.id, "Student")

/** GET /v1/students?q=&programme=&status= */
export async function list(context: RouteContext) {
  return json({ students: await listStudents(context.db, queryOf(context, studentSearchSchema)) })
}

/** POST /v1/students — the create input with `passwordHash` (bcrypt, hashed by the Next.js server) instead of `password`. */
export async function create(context: RouteContext) {
  const input = bodyOf(context, studentCreateRecordSchema)
  return json({ student: await createStudent(context.db, input, context.now) }, 201)
}

/** GET /v1/students/:id */
export async function get(context: RouteContext) {
  return json({ student: await getStudent(context.db, studentIdParam(context)) })
}

/** PATCH /v1/students/:id */
export async function update(context: RouteContext) {
  const id = studentIdParam(context)
  return json({ student: await updateStudent(context.db, id, bodyOf(context, studentUpdateSchema)) })
}

/** GET /v1/students/:id/fees — fee summary, payment history and the current tariff. */
export async function fees(context: RouteContext) {
  const id = studentIdParam(context)
  await getStudent(context.db, id) // 404 for unknown students, as in the Next.js route
  return json(await getStudentFees(context.db, id, context.now))
}

/** PUT /v1/students/:id/fee — { source: "TARIFF" } or { source: "MANUAL", amount, dueDate, currency? } */
export async function assignFee(context: RouteContext) {
  const id = studentIdParam(context)
  return json({ summary: await assignStudentFee(context.db, id, bodyOf(context, feeAssignSchema), context.now) })
}

/** POST /v1/students/:id/payments — { amount, paymentDate, referenceNumber } */
export async function recordPayment(context: RouteContext) {
  const id = studentIdParam(context)
  return json({ payment: await createPayment(context.db, id, bodyOf(context, paymentCreateSchema), context.now) }, 201)
}

function resultIds(context: RouteContext) {
  return { studentId: studentIdParam(context), assessmentId: parseId(context.params.assessmentId, "Assessment") }
}

/** PUT /v1/students/:id/results/:assessmentId — { grade } */
export async function saveGrade(context: RouteContext) {
  const { studentId, assessmentId } = resultIds(context)
  const { grade } = bodyOf(context, resultUpsertSchema)
  return json({ result: await upsertResult(context.db, studentId, assessmentId, grade, context.now) })
}

/** PATCH /v1/students/:id/results/:assessmentId — { published } */
export async function publishResult(context: RouteContext) {
  const { studentId, assessmentId } = resultIds(context)
  const { published } = bodyOf(context, publishSchema)
  return json({ result: await setResultPublished(context.db, studentId, assessmentId, published) })
}

/** POST /v1/students/:id/results/publish — { published } for the whole marksheet */
export async function publishMarksheet(context: RouteContext) {
  const id = studentIdParam(context)
  const { published } = bodyOf(context, publishSchema)
  return json(await setStudentResultsPublished(context.db, id, published))
}
