import type { DefaultSession } from "next-auth"

type AppRole = "STAFF" | "STUDENT"

declare module "next-auth" {
  interface User {
    role: AppRole
    studentId: string | null
  }

  interface Session {
    user: {
      id: string
      role: AppRole
      studentId: string | null
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role: AppRole
    studentId: string | null
  }
}
