import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"
import { publishSchema } from "@/lib/validations/results"

type Context = { params: Promise<{ id: string }> }

// POST /api/students/[id]/results/publish — { published } for the student's whole marksheet
export const POST = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  const { published } = parseInput(publishSchema, await readJson(request))
  return NextResponse.json(await (await data()).setStudentResultsPublished(id, published))
})
