import { NextResponse } from "next/server"

import { apiRoute, readJson } from "@/lib/api/response"
import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput } from "@/lib/errors"
import { paymentCreateSchema } from "@/lib/validations/fees"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ id: string }> }

// POST /api/students/[id]/payments — { amount, paymentDate, referenceNumber }
export const POST = apiRoute(async (request, { params }: Context) => {
  await authorizeStaff()
  const id = parseId((await params).id, "Student")
  const input = parseInput(paymentCreateSchema, await readJson(request))
  return NextResponse.json({ payment: await (await data()).createPayment(id, input) }, { status: 201 })
})
