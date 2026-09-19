import { NextResponse } from "next/server"

import { apiRoute, readJson, searchParamsObject } from "@/lib/api/response"
import { authorizeAny, authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { assessmentCreateSchema, assessmentListSchema } from "@/lib/validations/assessments"

// GET /api/assessments — staff: all (optional ?programmeId=); student: own programme with own submission
export const GET = apiRoute(async (request) => {
  const session = await authorizeAny()
  if (session.role === "STUDENT" && session.studentId) {
    return NextResponse.json({ assessments: await (await data()).getMyAssessments(session.studentId) })
  }
  const filter = parseInput(assessmentListSchema, searchParamsObject(request))
  return NextResponse.json({ assessments: await (await data()).listAssessments(filter) })
})

// POST /api/assessments
export const POST = apiRoute(async (request) => {
  await authorizeStaff()
  const input = parseInput(assessmentCreateSchema, await readJson(request))
  return NextResponse.json(await (await data()).createAssessment(input), { status: 201 })
})
