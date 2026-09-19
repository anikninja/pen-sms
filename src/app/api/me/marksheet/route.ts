import { NextResponse } from "next/server"

import { apiRoute } from "@/lib/api/response"
import { authorizeStudent } from "@/lib/auth/guards"
import { data } from "@/lib/data"

// GET /api/me/marksheet — the signed-in student's published results only
export const GET = apiRoute(async () => {
  const session = await authorizeStudent()
  return NextResponse.json({ results: await (await data()).getMyMarksheet(session.studentId) })
})
