import type { EnrolmentStatus } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import type { FeeStatus } from "@/lib/domain/fees"
import type { SubmissionStatus } from "@/lib/domain/submissions"

type Variant = "default" | "secondary" | "outline" | "destructive"

// Every badge shows a text label; colour is only a secondary cue (architecture.md §35).

const ENROLMENT: Record<EnrolmentStatus, { label: string; variant: Variant }> = {
  ENROLLED: { label: "Enrolled", variant: "default" },
  DEFERRED: { label: "Deferred", variant: "secondary" },
  WITHDRAWN: { label: "Withdrawn", variant: "destructive" },
  COMPLETED: { label: "Completed", variant: "outline" },
}

export function EnrolmentStatusBadge({ status }: { status: EnrolmentStatus }) {
  const { label, variant } = ENROLMENT[status]
  return <Badge variant={variant}>{label}</Badge>
}

const FEE: Record<FeeStatus, { label: string; variant: Variant }> = {
  PAID: { label: "Paid", variant: "outline" },
  OUTSTANDING: { label: "Outstanding", variant: "secondary" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
  NO_FEE: { label: "No fee assigned", variant: "outline" },
}

export function FeeStatusBadge({ status }: { status: FeeStatus }) {
  const { label, variant } = FEE[status]
  return <Badge variant={variant}>{label}</Badge>
}

const SUBMISSION: Record<SubmissionStatus, { label: string; variant: Variant }> = {
  SUBMITTED: { label: "Submitted", variant: "default" },
  LATE: { label: "Late", variant: "destructive" },
  PENDING: { label: "Pending", variant: "outline" },
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const { label, variant } = SUBMISSION[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function PublishedBadge({ published }: { published: boolean }) {
  return published ? <Badge variant="default">Published</Badge> : <Badge variant="secondary">Withheld</Badge>
}

export function OpenBadge({ isOpen }: { isOpen: boolean }) {
  return isOpen ? <Badge variant="default">Open</Badge> : <Badge variant="outline">Closed</Badge>
}
