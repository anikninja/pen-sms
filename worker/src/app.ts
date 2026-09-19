/**
 * Request handling: route → read the body → verify the internal token → load the user from D1 and
 * check the role → run the handler → map any error to { error, code, fieldErrors? }.
 * The full endpoint list with access rules is in API.md.
 */
import { DomainError } from "@/lib/errors"

import { authorize, MisconfiguredError, verifyRequest } from "./auth"
import { createDb } from "./db"
import type { Env } from "./env"
import { errorResponse, json, MAX_JSON_BODY_BYTES, payloadTooLarge } from "./http"
import { Router } from "./router"
import * as assessments from "./routes/assessments"
import * as auth from "./routes/auth"
import * as catalogue from "./routes/catalogue"
import { health } from "./routes/health"
import * as me from "./routes/me"
import * as students from "./routes/students"
import * as views from "./routes/views"

export const router = new Router()
  .get("/health", "public", health)

  // Authentication (API.md, "Authentication")
  .post("/v1/auth/lookup", "service", auth.lookupAccount)
  .get("/v1/session", "user", auth.currentSession)

  // Staff: students, fees, payments, results
  .get("/v1/students", "staff", students.list)
  .post("/v1/students", "staff", students.create)
  .get("/v1/students/:id", "staff", students.get)
  .patch("/v1/students/:id", "staff", students.update)
  .get("/v1/students/:id/fees", "staff", students.fees)
  .put("/v1/students/:id/fee", "staff", students.assignFee)
  .post("/v1/students/:id/payments", "staff", students.recordPayment)
  .put("/v1/students/:id/results/:assessmentId", "staff", students.saveGrade)
  .patch("/v1/students/:id/results/:assessmentId", "staff", students.publishResult)
  .post("/v1/students/:id/results/publish", "staff", students.publishMarksheet)

  // Programmes and the fee overview
  .get("/v1/programmes", "staff", catalogue.programmes)
  .get("/v1/fees", "staff", catalogue.feeOverview)

  // Assessments (the list is role-dependent, like GET /api/assessments)
  .get("/v1/assessments", "user", assessments.list)
  .post("/v1/assessments", "staff", assessments.create)
  .get("/v1/assessments/:id", "staff", assessments.get)
  .patch("/v1/assessments/:id", "staff", assessments.update)
  .post("/v1/assessments/:id/results/publish", "staff", assessments.publishResults)

  // The signed-in student's own data
  .get("/v1/me/overview", "student", me.overview)
  .get("/v1/me/fees", "student", me.fees)
  .get("/v1/me/assessments", "student", me.assessments)
  .get("/v1/me/marksheet", "student", me.marksheet)

  // Staff page views (one request per page)
  .get("/v1/views/dashboard", "staff", views.dashboard)
  .get("/v1/views/students", "staff", views.students)
  .get("/v1/views/students/:id", "staff", views.student)
  .get("/v1/views/students/:id/edit", "staff", views.studentEdit)
  .get("/v1/views/assessments", "staff", views.assessments)
  .get("/v1/views/assessments/:id", "staff", views.assessment)
  .get("/v1/views/results", "staff", views.results)

/** Reads the whole body up to `limit` bytes; null when it is larger. */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0)
  if (declared > limit) return null
  const body = new Uint8Array(await request.arrayBuffer())
  return body.byteLength > limit ? null : body
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const now = new Date()
  const url = new URL(request.url)

  const match = router.match(request.method, url.pathname)
  if (match.kind === "not-found") return json({ error: "Not found.", code: "NOT_FOUND" }, 404)
  if (match.kind === "method-not-allowed") {
    return json({ error: "Method not allowed.", code: "VALIDATION" }, 405, { Allow: match.allowed.join(", ") })
  }
  const { route, params } = match

  try {
    const body = await readBody(request, MAX_JSON_BODY_BYTES)
    if (!body) return payloadTooLarge()

    const db = createDb(env)
    let session = null
    if (route.access !== "public") {
      const claims = await verifyRequest(request, url, body, env, now)
      if (route.access !== "service") session = await authorize(db, claims, route.access)
    }

    return await route.handler({
      request,
      env,
      url,
      params,
      query: Object.fromEntries(url.searchParams),
      body,
      db,
      session,
      now,
    })
  } catch (error) {
    if (error instanceof MisconfiguredError) {
      console.error(JSON.stringify({ event: "worker_misconfigured", message: error.message }))
      return errorResponse(new DomainError("INTERNAL", "The service is not configured."))
    }
    return errorResponse(error)
  }
}
