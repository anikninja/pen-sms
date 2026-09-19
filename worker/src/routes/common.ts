import { DomainError, parseInput } from "@/lib/errors"
import type { z } from "zod"

import { parseJsonBody } from "../http"
import type { RouteContext } from "../router"

/** The JSON body, validated with the same schema the Next.js API uses (the Worker never trusts its caller's validation). */
export function bodyOf<S extends z.ZodType>(context: RouteContext, schema: S): z.output<S> {
  return parseInput(schema, parseJsonBody(context.body))
}

export function queryOf<S extends z.ZodType>(context: RouteContext, schema: S): z.output<S> {
  return parseInput(schema, context.query)
}

/** The signed-in student's own Student row id. Only used on "student" routes, where it is guaranteed. */
export function ownStudentId(context: RouteContext): string {
  const studentId = context.session?.studentId
  if (!studentId) throw new DomainError("FORBIDDEN", "Only students can do this.")
  return studentId
}
