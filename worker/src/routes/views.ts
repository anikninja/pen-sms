/**
 * Staff page views: everything one page of the Registry area needs, in one request (API.md, "Views").
 */
import { z } from "zod"

import { parseId } from "@/lib/validations/ids"
import { studentSearchSchema } from "@/lib/validations/students"
import {
  getAssessmentPage,
  getAssessmentsPage,
  getResultsPage,
  getStaffDashboard,
  getStudentEditPage,
  getStudentPage,
  getStudentsPage,
} from "@/lib/services/d1/views"

import { json } from "../http"
import type { RouteContext } from "../router"
import { queryOf } from "./common"

/** GET /v1/views/dashboard */
export async function dashboard(context: RouteContext) {
  return json(await getStaffDashboard(context.db, context.now))
}

/** GET /v1/views/students?q=&programme=&status= */
export async function students(context: RouteContext) {
  return json(await getStudentsPage(context.db, queryOf(context, studentSearchSchema)))
}

/** GET /v1/views/students/:id */
export async function student(context: RouteContext) {
  return json(await getStudentPage(context.db, parseId(context.params.id, "Student"), context.now))
}

/** GET /v1/views/students/:id/edit */
export async function studentEdit(context: RouteContext) {
  return json(await getStudentEditPage(context.db, parseId(context.params.id, "Student")))
}

const programmeCodeSchema = z.object({ programme: z.string().max(20).optional() })

/** GET /v1/views/assessments?programme=CODE */
export async function assessments(context: RouteContext) {
  const { programme } = queryOf(context, programmeCodeSchema)
  return json(await getAssessmentsPage(context.db, programme, context.now))
}

/** GET /v1/views/assessments/:id */
export async function assessment(context: RouteContext) {
  return json(await getAssessmentPage(context.db, parseId(context.params.id, "Assessment"), context.now))
}

const resultsSchema = z.object({ assessment: z.string().max(100).optional() })

/** GET /v1/views/results?assessment=ID */
export async function results(context: RouteContext) {
  const { assessment } = queryOf(context, resultsSchema)
  return json(await getResultsPage(context.db, assessment, context.now))
}
