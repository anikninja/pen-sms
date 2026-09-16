import { NextResponse } from "next/server"

import { apiRoute } from "@/lib/api/response"
import { authorizeStudent } from "@/lib/auth/guards"
import { getStudentPublishedResults } from "@/lib/services/results"

// GET /api/me/marksheet — the signed-in student's published results only
export const GET = apiRoute(async () => {
  const session = await authorizeStudent()
  return NextResponse.json({ results: await getStudentPublishedResults(session.studentId) })
})
