import { NextResponse } from "next/server"

import { apiRoute } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// GET /api/students/[id]/fees — fee summary and payment history
export const GET = apiRoute(async (_request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  // Unknown students are 404 "Student not found." in both backends.
  return NextResponse.json(await (await data()).getStudentFees(id))
})
