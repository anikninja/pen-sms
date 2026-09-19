import { NextResponse } from "next/server"
import { z } from "zod"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStudent } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { DomainError, parseInput } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

const declaredFileSchema = z.object({
  fileName: z.string({ error: "Choose a PDF or DOCX file to upload." }).min(1, "Choose a PDF or DOCX file to upload.").max(255),
  fileType: z.string().max(200),
  fileSize: z.number().int().min(0),
})

// POST /api/assessments/[id]/submissions/upload-url — { fileName, fileType, fileSize }
// Runs every submission check, then returns { upload: { url, method: "PUT", headers, expiresAt, maxBytes } }:
// PUT the file to that URL (the Cloudflare Worker) within 5 minutes. Worker backend only.
export const POST = apiRoute(async (request, { params }: Context) => {
  await authorizeStudent()
  const assessmentId = parseId((await params).id, "Assessment")
  const { fileName, fileType, fileSize } = parseInput(declaredFileSchema, await readJson(request))
  const upload = await (await data()).requestSubmissionUpload(assessmentId, { name: fileName, type: fileType, size: fileSize })
  if (!upload) throw new DomainError("NOT_FOUND", "Direct uploads are not available here. POST the file to /api/assessments/:id/submissions.")
  return NextResponse.json({ upload })
})
