import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"
import { studentUpdateSchema } from "@/lib/validations/students"

type Context = { params: Promise<{ id: string }> }

// GET /api/students/[id]
export const GET = apiRoute(async (_request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  return NextResponse.json({ student: await (await data()).getStudent(id) })
})

// PATCH /api/students/[id]
export const PATCH = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  const input = parseInput(studentUpdateSchema, await readJson(request))
  return NextResponse.json({ student: await (await data()).updateStudent(id, input) })
})
