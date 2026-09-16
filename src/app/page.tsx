import { redirect } from "next/navigation"

import { ROLE_HOME } from "@/lib/auth/roles"
import { getSession } from "@/lib/auth/session"

export default async function Home() {
  const session = await getSession()
  redirect(session ? ROLE_HOME[session.role] : "/login")
}
