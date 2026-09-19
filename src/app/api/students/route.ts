import { NextResponse } from "next/server"

import { apiRoute, readJson, searchParamsObject } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { studentCreateSchema, studentSearchSchema } from "@/lib/validations/students"

// GET /api/students?q=&programme=&status=
export const GET = apiRoute(async (request) => {
  await authorizeStaff()
  const search = parseInput(studentSearchSchema, searchParamsObject(request))
  return NextResponse.json({ students: await (await data()).listStudents(search) })
})

// POST /api/students
export const POST = apiRoute(async (request) => {
  await authorizeStaff()
  const input = parseInput(studentCreateSchema, await readJson(request))
  return NextResponse.json({ student: await (await data()).createStudent(input) }, { status: 201 })
})
