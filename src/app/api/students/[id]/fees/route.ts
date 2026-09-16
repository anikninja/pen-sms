import { NextResponse } from "next/server"

import { apiRoute } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { getStudentFees } from "@/lib/services/fees"
import { getStudent } from "@/lib/services/students"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// GET /api/students/[id]/fees — fee summary and payment history
export const GET = apiRoute(async (_request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  await getStudent(id) // 404 for unknown students
  return NextResponse.json(await getStudentFees(id))
})
