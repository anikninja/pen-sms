import bcrypt from "bcryptjs"
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { data } from "@/lib/data"
import { loginSchema } from "@/lib/validations/auth"

// Compared against when the email is unknown, so a missing account takes as long as a wrong password.
const DUMMY_PASSWORD_HASH = "$2b$10$zYlrVsFIjKv7dBLuk0.UOeA4XY3dMrgh89IHKJrfNgGGzguGS7xPC"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        // The account comes from PostgreSQL or the Worker (DATA_BACKEND); bcrypt always runs here.
        const user = await (await data()).findLoginAccount(parsed.data.email)
        const passwordOk = await bcrypt.compare(
          parsed.data.password,
          user?.passwordHash ?? DUMMY_PASSWORD_HASH
        )
        if (!user || !passwordOk) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          studentId: user.studentId,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        token.role = user.role
        token.studentId = user.studentId
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub ?? ""
      session.user.role = token.role
      session.user.studentId = token.studentId
      return session
    },
  },
})
