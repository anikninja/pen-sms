import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput } from "@/lib/errors"
import { createPayment } from "@/lib/services/fees"
import { paymentCreateSchema } from "@/lib/validations/fees"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// POST /api/students/[id]/payments — { amount, paymentDate, referenceNumber }
export const POST = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  const input = parseInput(paymentCreateSchema, await readJson(request))
  return NextResponse.json({ payment: await createPayment(id, input) }, { status: 201 })
})
