import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { ROLE_AREA, ROLE_HOME } from "@/lib/auth/roles"

// Optimistic gate based on the session cookie only. It keeps users out of the other role's
// area early; the real check runs again in each layout, page, action and API route (getSession).
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl
  const user = req.auth?.user

  if (!user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl))
  }

  const area = ROLE_AREA[user.role]
  if (pathname !== area && !pathname.startsWith(`${area}/`)) {
    return NextResponse.redirect(new URL(ROLE_HOME[user.role], req.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/staff/:path*", "/student/:path*"],
}
