"use client"

import { RouteError, type RouteErrorProps } from "@/components/shared/route-states"

// Errors outside the role areas' own boundaries: the login page, or a role layout failing (e.g. the database is unreachable).
export default function RootError(props: RouteErrorProps) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <RouteError {...props} homeHref="/" />
    </main>
  )
}
