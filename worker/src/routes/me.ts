/**
 * The signed-in student's own data. The student is always the one in the session (read from D1),
 * never an id from the request (architecture.md §24, §27.3).
 */
import { getStudentPublishedResults } from "@/lib/services/d1/results"
import { getStudentAssessments } from "@/lib/services/d1/submissions"
import { getMyFeesPage, getStudentOverview } from "@/lib/services/d1/views"

import { json } from "../http"
import type { RouteContext } from "../router"
import { ownStudentId } from "./common"

/** GET /v1/me/marksheet — published results only. */
export async function marksheet(context: RouteContext) {
  return json({ results: await getStudentPublishedResults(context.db, ownStudentId(context)) })
}

/** GET /v1/me/assessments */
export async function assessments(context: RouteContext) {
  return json({ assessments: await getStudentAssessments(context.db, ownStudentId(context), context.now) })
}

/** GET /v1/me/overview — the student dashboard. */
export async function overview(context: RouteContext) {
  return json(await getStudentOverview(context.db, ownStudentId(context), context.now))
}

/** GET /v1/me/fees — fee summary and payment history. */
export async function fees(context: RouteContext) {
  return json(await getMyFeesPage(context.db, ownStudentId(context), context.now))
}
