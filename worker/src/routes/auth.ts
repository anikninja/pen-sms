import { z } from "zod"

import { emailSchema } from "@/lib/validations/common"

import { json } from "../http"
import type { RouteContext } from "../router"
import { bodyOf } from "./common"

const lookupSchema = z.object({ email: emailSchema })

/**
 * POST /v1/auth/lookup — service. The account for a sign-in attempt, including its bcrypt hash,
 * which the Next.js server compares (bcrypt is too CPU-heavy for Workers Free). `user` is null for
 * an unknown email; the Next.js server then compares against a dummy hash so timing does not
 * reveal which emails exist. Only reachable with a valid internal token: never from a browser.
 */
export async function lookupAccount(context: RouteContext): Promise<Response> {
  const { email } = bodyOf(context, lookupSchema)
  const user = await context.db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, studentId: true, passwordHash: true },
  })
  return json({ user })
}

/** GET /v1/session — user. The signed-in user as D1 has it now (role and student link are never taken from the caller). */
export async function currentSession(context: RouteContext): Promise<Response> {
  return json({ session: context.session })
}
