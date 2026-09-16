import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput } from "@/lib/errors"
import { updateAssessment } from "@/lib/services/assessments"
import { assessmentUpdateSchema } from "@/lib/validations/assessments"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// PATCH /api/assessments/[id] — edit fields, or { isOpen } to open/close
export const PATCH = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Assessment")
  const input = parseInput(assessmentUpdateSchema, await readJson(request))
  return NextResponse.json({ assessment: await updateAssessment(id, input) })
})
