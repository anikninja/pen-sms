import { NextResponse } from "next/server"

import { apiRoute, readJson, searchParamsObject } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput } from "@/lib/errors"
import { createStudent, listStudents } from "@/lib/services/students"
import { studentCreateSchema, studentSearchSchema } from "@/lib/validations/students"

// GET /api/students?q=&programme=&status=
export const GET = apiRoute(async (request) => {
  await authorizeStaff()
  const search = parseInput(studentSearchSchema, searchParamsObject(request))
  return NextResponse.json({ students: await listStudents(search) })
})

// POST /api/students
export const POST = apiRoute(async (request) => {
  await authorizeStaff()
  const input = parseInput(studentCreateSchema, await readJson(request))
  return NextResponse.json({ student: await createStudent(input) }, { status: 201 })
})
