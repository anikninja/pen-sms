import type { EnrolmentStatus } from "@prisma/client"

import { Badge } from "@/components/ui/badge"

// Text label is always shown; colour is only a secondary cue.
const STATUS: Record<EnrolmentStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  ENROLLED: { label: "Enrolled", variant: "default" },
  DEFERRED: { label: "Deferred", variant: "secondary" },
  WITHDRAWN: { label: "Withdrawn", variant: "destructive" },
  COMPLETED: { label: "Completed", variant: "outline" },
}

export function EnrolmentStatusBadge({ status }: { status: EnrolmentStatus }) {
  const { label, variant } = STATUS[status]
  return <Badge variant={variant}>{label}</Badge>
}
