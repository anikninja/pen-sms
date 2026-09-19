import { cache } from "react"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { ROLE_HOME } from "@/lib/auth/roles"
import type { Session, StaffSession, StudentSession } from "@/lib/auth/session-types"
import { data } from "@/lib/data"

export type { Session, StaffSession, StudentSession } from "@/lib/auth/session-types"

/**
 * The single source of "who is making this request" for pages, actions and API routes.
 *
 * The JWT only proves identity. Role and student link are re-read from the database (PostgreSQL,
 * or D1 through the Worker) on every request, so a deleted account or a changed role takes effect
 * immediately instead of when the cookie expires. Replace this function to swap the auth provider;
 * callers don't change.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const authSession = await auth()
  const userId = authSession?.user?.id
  if (!userId) return null

  return (await data()).loadSession(userId)
})

/** For pages and layouts: sends signed-out users to /login and other roles to their own home. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.role !== "STAFF") redirect(ROLE_HOME[session.role])
  return session as StaffSession
}

export async function requireStudent(): Promise<StudentSession> {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.role !== "STUDENT" || !session.studentId) redirect(ROLE_HOME[session.role])
  return session as StudentSession
}
