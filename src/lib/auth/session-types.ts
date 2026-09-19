import type { AppRole } from "@/lib/auth/roles"

/** Who is making a request. Framework-free, so the Cloudflare Worker shares it with the Next.js app. */
export type Session = {
  userId: string
  name: string
  email: string
  role: AppRole
  studentId: string | null
}

export type StaffSession = Session & { role: "STAFF"; studentId: null }
export type StudentSession = Session & { role: "STUDENT"; studentId: string }
