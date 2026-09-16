import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput } from "@/lib/errors"
import { assignStudentFee } from "@/lib/services/fees"
import { feeAssignSchema } from "@/lib/validations/fees"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// PUT /api/students/[id]/fee — { source: "TARIFF" } or { source: "MANUAL", amount, dueDate, currency? }
export const PUT = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  const input = parseInput(feeAssignSchema, await readJson(request))
  return NextResponse.json({ summary: await assignStudentFee(id, input) })
})
