"use client"

import { RouteError, type RouteErrorProps } from "@/components/shared/route-states"

// Catches errors thrown by staff pages; renders inside the app shell (the layout is outside this boundary).
export default function StaffError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/staff/dashboard" />
}
