/**
 * Submission files (API.md, "Files"). Files move between the browser and this Worker directly, so
 * they never pass through Vercel (4.5 MB body limit):
 *
 *   upload:   Next.js → POST …/upload-url (signed, student) → browser PUT /v1/uploads?token=… → R2
 *   download: Next.js → POST /v1/files/:id/download-url (signed) → browser GET /v1/files/download?token=… ← R2
 *
 * The file tokens are short-lived, signed by this Worker, and bound to one user and one
 * submission/assessment; every rule is checked again when the token is used.
 */
import { z } from "zod"

import { MAX_SUBMISSION_BYTES } from "@/lib/domain/submissions"
import { DomainError, fieldError } from "@/lib/errors"
import { verifyFileToken } from "@/lib/internal-auth/token"
import { authorizeDownload, checkUploadAllowed, openSubmissionFile, submitAssessment } from "@/lib/services/d1/submission-files"
import { parseId } from "@/lib/validations/ids"

import { authorize, internalSecrets, MisconfiguredError } from "../auth"
import { json } from "../http"
import type { RouteContext } from "../router"
import { createDownloadUrl, createUploadUrl, R2ObjectStore } from "../storage"
import { bodyOf, ownStudentId } from "./common"

const uploadRequestSchema = z.object({
  fileName: z.string({ error: "Choose a PDF or DOCX file to upload." }).min(1, "Choose a PDF or DOCX file to upload.").max(255),
  fileType: z.string().max(200),
  fileSize: z.number().int().min(0),
})

const MISMATCH = "The uploaded file is not the file that was checked. Please try again."

function signingSecret(context: RouteContext): string {
  const [current] = internalSecrets(context.env)
  if (!current) throw new MisconfiguredError()
  return current
}

/**
 * POST /v1/assessments/:id/submissions/upload-url — student. Body { fileName, fileType, fileSize }.
 * Runs every submission check first (open, enrolled, own programme, type, size, replacement
 * deadline), then returns a 5-minute URL for exactly that file.
 */
export async function requestUpload(context: RouteContext) {
  const studentId = ownStudentId(context)
  const assessmentId = parseId(context.params.id, "Assessment")
  const { fileName, fileType, fileSize } = bodyOf(context, uploadRequestSchema)
  const check = await checkUploadAllowed(context.db, studentId, assessmentId, { name: fileName, type: fileType, size: fileSize }, context.now)

  const { url, expiresAt } = await createUploadUrl(
    context.url.origin,
    signingSecret(context),
    { sub: context.session!.userId, sid: studentId, aid: assessmentId, name: fileName, type: check.mimeType, size: fileSize },
    context.now
  )
  return json({ upload: { url, method: "PUT", headers: { "Content-Type": check.mimeType }, expiresAt, maxBytes: MAX_SUBMISSION_BYTES } })
}

/**
 * PUT /v1/uploads?token=… — the browser sends the file itself (raw body, the declared Content-Type).
 * The token must be valid, its user must still be that student, and the body must be the declared
 * file; then the submission is created or replaced exactly as in submitAssessment.
 */
export async function upload(context: RouteContext) {
  const verified = await verifyFileToken(internalSecrets(context.env), context.url.searchParams.get("token"), "upload", context.now)
  if (!verified.ok) throw new DomainError("UNAUTHORIZED", "This upload link is invalid or has expired. Please try again.")
  const claims = verified.claims

  const session = await authorize(context.db, claims.sub, "student")
  if (session.studentId !== claims.sid) throw new DomainError("FORBIDDEN", "Only students can do this.")

  const contentType = (context.request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase()
  if (contentType !== claims.type || context.body.byteLength !== claims.size) throw fieldError("file", MISMATCH)

  const submission = await submitAssessment(
    context.db,
    new R2ObjectStore(context.env.FILES),
    { studentId: claims.sid, assessmentId: claims.aid, file: { name: claims.name, type: claims.type, bytes: context.body } },
    context.now
  )
  return json({ submission }, submission.replaced ? 200 : 201)
}

/** POST /v1/files/:submissionId/download-url — user. Staff: any file; a student: their own (others are 404). */
export async function requestDownload(context: RouteContext) {
  const { submissionId, key } = await authorizeDownload(context.db, parseId(context.params.submissionId, "File"), context.session!)
  const { url, expiresAt } = await createDownloadUrl(
    context.url.origin,
    signingSecret(context),
    { sub: context.session!.userId, fid: submissionId, key },
    context.now
  )
  return json({ download: { url, expiresAt } })
}

/** GET /v1/files/download?token=… — streams the file from R2 as an attachment. */
export async function download(context: RouteContext) {
  const verified = await verifyFileToken(internalSecrets(context.env), context.url.searchParams.get("token"), "download", context.now)
  if (!verified.ok) throw new DomainError("UNAUTHORIZED", "This download link is invalid or has expired.")
  await authorize(context.db, verified.claims.sub, "user") // the account must still exist

  const file = await openSubmissionFile(context.db, new R2ObjectStore(context.env.FILES), verified.claims.fid, verified.claims.key)
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new Response(file.body, {
    headers: {
      "Content-Type": file.fileType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // The URL carries the token: never send it on as a referrer.
      "Referrer-Policy": "no-referrer",
    },
  })
}
