import { NextResponse } from "next/server"

import { apiRoute } from "@/lib/api/response"
import { authorizeStudent } from "@/lib/auth/guards"
import { MAX_SUBMISSION_BYTES } from "@/lib/domain/submissions"
import { DomainError, fieldError } from "@/lib/errors"
import { submitAssessment } from "@/lib/services/submissions"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// Room for multipart boundaries and headers on top of the 5 MB file limit.
const MAX_BODY_BYTES = MAX_SUBMISSION_BYTES + 64 * 1024

// POST /api/assessments/[id]/submissions — multipart/form-data with a "file" field
export const POST = apiRoute(async (request, { params }: Context) => {
  const session = await authorizeStudent()
  const assessmentId = parseId((await params).id, "Assessment")

  // Reject oversized uploads before reading the body into memory.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw fieldError("file", "File must be smaller than 5 MB.")
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new DomainError("VALIDATION", "Send the file as multipart/form-data.")
  }
  const file = formData.get("file")
  if (!(file instanceof File)) throw fieldError("file", "Choose a PDF or DOCX file to upload.")

  const submission = await submitAssessment({ studentId: session.studentId, assessmentId, file })
  return NextResponse.json({ submission }, { status: submission.replaced ? 200 : 201 })
})
