import type { Metadata } from "next"
import Link from "next/link"

import { ButtonLink } from "@/components/shared/button-link"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { EnrolmentStatusBadge, FeeStatusBadge } from "@/components/shared/status-badges"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import type { FeeStatus } from "@/lib/domain/fees"
import { listFeeOverview, totalOutstandingByCurrency } from "@/lib/services/fees"
import { formatCurrency, formatDate } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Fees · Registry" }

const FILTERS: { value: FeeStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "OUTSTANDING", label: "Outstanding" },
  { value: "PAID", label: "Paid" },
  { value: "NO_FEE", label: "No fee assigned" },
]

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaff()
  const requested = (await searchParams).status
  const status = FILTERS.find((filter) => filter.value === requested)?.value ?? null

  const all = await listFeeOverview()
  const rows = status ? all.filter((row) => row.status === status) : all
  const countFor = (value: FeeStatus | null) => (value ? all.filter((row) => row.status === value).length : all.length)
  const totals = totalOutstandingByCurrency(rows)

  return (
    <>
      <PageHeader
        title="Fees"
        description="Assigned fee, payments and outstanding balance for every student. Open a student to record a payment or adjust their fee."
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by fee status">
        {FILTERS.map((filter) => {
          const active = filter.value === status
          return (
            <ButtonLink
              key={filter.label}
              href={filter.value ? `/staff/fees?status=${filter.value}` : "/staff/fees"}
              variant={active ? "default" : "outline"}
              size="sm"
              aria-current={active ? "page" : undefined}
            >
              {filter.label} <span className="tabular-nums opacity-70">{countFor(filter.value)}</span>
            </ButtonLink>
          )
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title="No students in this view" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead className="text-right">Total fee</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Fee status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.student.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/staff/students/${row.student.id}?tab=fees`} className="underline-offset-4 hover:underline">
                      {row.student.studentId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.student.fullName}</div>
                    <EnrolmentStatusBadge status={row.student.enrolmentStatus} />
                  </TableCell>
                  <TableCell>{row.student.programme.code}</TableCell>
                  {row.currency ? (
                    <>
                      <TableCell className="text-right tabular-nums">{formatCurrency(row.totalFee, row.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(row.totalPaid, row.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatCurrency(row.outstanding, row.currency)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.dueDate ? formatDate(row.dueDate) : "—"}
                        {row.status === "OVERDUE" && (
                          <div className="text-xs text-destructive">{row.daysOverdue} days overdue</div>
                        )}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No fee assigned
                    </TableCell>
                  )}
                  <TableCell>
                    <FeeStatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totals.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Outstanding in this view:{" "}
          <strong className="text-foreground">{totals.map((total) => formatCurrency(total.amount, total.currency)).join(" · ")}</strong>
        </p>
      )}
    </>
  )
}
