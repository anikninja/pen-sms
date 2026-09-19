/** Assessments. Same request and response shapes as src/app/api/assessments/…, plus `code` on errors. */
import { createAssessment, getAssessment, listAssessments, updateAssessment } from "@/lib/services/d1/assessments"
import { setAssessmentResultsPublished } from "@/lib/services/d1/results"
import { getStudentAssessments } from "@/lib/services/d1/submissions"
import { assessmentCreateSchema, assessmentListSchema, assessmentUpdateSchema } from "@/lib/validations/assessments"
import { parseId } from "@/lib/validations/ids"
import { publishSchema } from "@/lib/validations/results"

import { json } from "../http"
import type { RouteContext } from "../router"
import { bodyOf, queryOf } from "./common"

const assessmentIdParam = (context: RouteContext) => parseId(context.params.id, "Assessment")

/** GET /v1/assessments — staff: all (optional ?programmeId=); student: own programme with own submission. */
export async function list(context: RouteContext) {
  const { session, db, now } = context
  if (session?.role === "STUDENT" && session.studentId) {
    return json({ assessments: await getStudentAssessments(db, session.studentId, now) })
  }
  return json({ assessments: await listAssessments(db, queryOf(context, assessmentListSchema), now) })
}

/** POST /v1/assessments */
export async function create(context: RouteContext) {
  return json(await createAssessment(context.db, bodyOf(context, assessmentCreateSchema), context.now), 201)
}

/** GET /v1/assessments/:id */
export async function get(context: RouteContext) {
  return json({ assessment: await getAssessment(context.db, assessmentIdParam(context), context.now) })
}

/** PATCH /v1/assessments/:id — edit fields, or { isOpen } to open/close. */
export async function update(context: RouteContext) {
  const id = assessmentIdParam(context)
  return json({ assessment: await updateAssessment(context.db, id, bodyOf(context, assessmentUpdateSchema), context.now) })
}

/** POST /v1/assessments/:id/results/publish — { published } for every result of the assessment. */
export async function publishResults(context: RouteContext) {
  const id = assessmentIdParam(context)
  const { published } = bodyOf(context, publishSchema)
  return json(await setAssessmentResultsPublished(context.db, id, published))
}
