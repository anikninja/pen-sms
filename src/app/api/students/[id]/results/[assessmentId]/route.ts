import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"
import { publishSchema, resultUpsertSchema } from "@/lib/validations/results"

type Context = { params: Promise<{ id: string; assessmentId: string }> }

async function ids(params: Context["params"]) {
  const { id, assessmentId } = await params
  return { studentId: parseId(id, "Student"), assessmentId: parseId(assessmentId, "Assessment") }
}

// PUT /api/students/[id]/results/[assessmentId] — { grade }
export const PUT = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const { studentId, assessmentId } = await ids(params)
  const { grade } = parseInput(resultUpsertSchema, await readJson(request))
  return NextResponse.json({ result: await (await data()).upsertResult(studentId, assessmentId, grade) })
})

// PATCH /api/students/[id]/results/[assessmentId] — { published }
export const PATCH = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const { studentId, assessmentId } = await ids(params)
  const { published } = parseInput(publishSchema, await readJson(request))
  return NextResponse.json({ result: await (await data()).setResultPublished(studentId, assessmentId, published) })
})
