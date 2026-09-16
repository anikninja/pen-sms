import { DomainError } from "@/lib/errors"
import { getSession, type Session, type StaffSession, type StudentSession } from "@/lib/auth/session"

/**
 * Role checks for Server Actions and API routes. Unlike requireStaff()/requireStudent(), these
 * throw UNAUTHORIZED (401) / FORBIDDEN (403) instead of redirecting (architecture.md §27.3).
 */
export async function authorizeAny(): Promise<Session> {
  const session = await getSession()
  if (!session) throw new DomainError("UNAUTHORIZED", "Please sign in.")
  return session
}

export async function authorizeStaff(): Promise<StaffSession> {
  const session = await authorizeAny()
  if (session.role !== "STAFF") throw new DomainError("FORBIDDEN", "Only Registry staff can do this.")
  return session as StaffSession
}

export async function authorizeStudent(): Promise<StudentSession> {
  const session = await authorizeAny()
  if (session.role !== "STUDENT" || !session.studentId) {
    throw new DomainError("FORBIDDEN", "Only students can do this.")
  }
  return session as StudentSession
}
