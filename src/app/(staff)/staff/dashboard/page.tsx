import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { EnrolmentStatusBadge } from "@/components/shared/status-badges"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import { data } from "@/lib/data"
import { formatCurrency, formatDate } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Dashboard · Registry" }

export default async function StaffDashboardPage() {
  // Layouts and pages render in parallel, so each page checks the role itself.
  const session = await requireStaff()
  const dashboard = await (await data()).getStaffDashboard()

  const outstanding =
    dashboard.totalOutstanding.length === 0
      ? "0.00"
      : dashboard.totalOutstanding.map((total) => formatCurrency(total.amount, total.currency)).join(" · ")

  const stats = [
    { label: "Total Students", value: dashboard.totalStudents, href: "/staff/students" },
    { label: "Enrolled Students", value: dashboard.enrolledStudents, href: "/staff/students?status=ENROLLED" },
    { label: "Total Outstanding", value: outstanding, href: "/staff/fees?status=OUTSTANDING" },
    { label: "Overdue Students", value: dashboard.overdueStudents, href: "/staff/fees?status=OVERDUE", alert: dashboard.overdueStudents > 0 },
    { label: "Pending Submissions", value: dashboard.pendingSubmissions, href: "/staff/assessments", hint: "Enrolled students yet to submit to open assessments" },
    { label: "Unpublished Results", value: dashboard.unpublishedResults, href: "/staff/results" },
  ]

  return (
    <>
      <PageHeader title={`Welcome, ${session.name}`} description="Registry overview" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Card className={stat.alert ? "h-full ring-destructive/40" : "h-full transition-colors hover:bg-muted/40"}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className={`text-2xl tabular-nums ${stat.alert ? "text-destructive" : ""}`}>{stat.value}</CardTitle>
              </CardHeader>
              {stat.hint && <CardFooter className="text-xs text-muted-foreground">{stat.hint}</CardFooter>}
            </Card>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Overdue Fees</h2>
          <p className="text-sm text-muted-foreground">Outstanding balance past the due date, most overdue first.</p>
        </div>
        {dashboard.overdue.length === 0 ? (
          <EmptyState title="No overdue fees">Every student with a past due date has paid in full.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Programme</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Days overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.overdue.map((row) => (
                  <TableRow key={row.student.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/staff/students/${row.student.id}?tab=fees`} className="underline-offset-4 hover:underline">
                        {row.student.studentId}
                      </Link>
                    </TableCell>
                    <TableCell>{row.student.fullName}</TableCell>
                    <TableCell>{row.student.programme.code}</TableCell>
                    <TableCell>
                      <EnrolmentStatusBadge status={row.student.enrolmentStatus} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(row.outstanding, row.currency ?? "")}</TableCell>
                    <TableCell>{row.dueDate ? formatDate(row.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-destructive">{row.daysOverdue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  )
}
