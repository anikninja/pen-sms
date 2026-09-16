import { cache } from "react"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { ROLE_HOME, type AppRole } from "@/lib/auth/roles"
import { prisma } from "@/lib/prisma"

export type Session = {
  userId: string
  name: string
  email: string
  role: AppRole
  studentId: string | null
}

export type StaffSession = Session & { role: "STAFF"; studentId: null }
export type StudentSession = Session & { role: "STUDENT"; studentId: string }

/**
 * The single source of "who is making this request" for pages, actions and API routes.
 *
 * The JWT only proves identity. Role and student link are re-read from the database on
 * every request, so a deleted account or a changed role takes effect immediately instead of
 * when the cookie expires. Replace this function to swap the auth provider; callers don't change.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const authSession = await auth()
  const userId = authSession?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, studentId: true },
  })
  if (!user) return null

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    studentId: user.studentId,
  }
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
