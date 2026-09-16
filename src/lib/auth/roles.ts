export type AppRole = "STAFF" | "STUDENT"

export const ROLE_HOME: Record<AppRole, string> = {
  STAFF: "/staff/dashboard",
  STUDENT: "/student/dashboard",
}

// URL prefix each role is allowed to open.
export const ROLE_AREA: Record<AppRole, string> = {
  STAFF: "/staff",
  STUDENT: "/student",
}
