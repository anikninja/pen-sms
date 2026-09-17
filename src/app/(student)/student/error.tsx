"use client"

import { RouteError, type RouteErrorProps } from "@/components/shared/route-states"

// Catches errors thrown by student pages; renders inside the app shell (the layout is outside this boundary).
export default function StudentError(props: RouteErrorProps) {
  return <RouteError {...props} homeHref="/student/dashboard" />
}
