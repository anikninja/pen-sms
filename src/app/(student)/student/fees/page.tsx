import type { Metadata } from "next"

import { EmptyState } from "@/components/shared/empty-state"
import { FeeSummaryCards, PaymentHistoryTable } from "@/components/shared/fee-summary"
import { PageHeader } from "@/components/shared/page-header"
import { FeeStatusBadge } from "@/components/shared/status-badges"
import { requireStudent } from "@/lib/auth/session"
import { getStudentFeeSummary, listPayments } from "@/lib/services/fees"
import { formatCurrency, formatDate } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Fees · Student Portal" }

export default async function StudentFeesPage() {
  // Own fees only: the student id comes from the session (architecture.md §24).
  const session = await requireStudent()
  const [summary, payments] = await Promise.all([
    getStudentFeeSummary(session.studentId),
    listPayments(session.studentId),
  ])

  return (
    <>
      <PageHeader title="Fees" description="Your assigned fee, payments received and what is still outstanding." />

      {!summary.hasFeeAssigned ? (
        <EmptyState title="No fee assigned">
          The Registry has not assigned a fee to you yet. Payments can be recorded once a fee is assigned.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <FeeStatusBadge status={summary.status} />
            {summary.status === "OVERDUE" && (
              <span className="text-sm text-destructive">
                {formatCurrency(summary.outstanding, summary.currency)} was due on {formatDate(summary.dueDate!)} ·{" "}
                {summary.daysOverdue} {summary.daysOverdue === 1 ? "day" : "days"} overdue
              </span>
            )}
            {summary.status === "OUTSTANDING" && (
              <span className="text-sm text-muted-foreground">
                {formatCurrency(summary.outstanding, summary.currency)} due by {formatDate(summary.dueDate!)}
              </span>
            )}
            {summary.status === "PAID" && <span className="text-sm text-muted-foreground">Paid in full.</span>}
          </div>

          {summary.status === "OVERDUE" && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Your balance is overdue. Please pay the outstanding amount or contact the Registry to discuss a payment arrangement.
            </p>
          )}

          <FeeSummaryCards summary={summary} />
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Payment history</h2>
        <PaymentHistoryTable payments={payments} currency={summary.currency} />
      </section>
    </>
  )
}
