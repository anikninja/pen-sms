import type { Metadata } from "next"
import Link from "next/link"
import { CalendarClockIcon, ClipboardListIcon, ReceiptIcon, TrophyIcon } from "lucide-react"

import { ButtonLink } from "@/components/shared/button-link"
import { PageHeader } from "@/components/shared/page-header"
import { EnrolmentStatusBadge, FeeStatusBadge, SubmissionStatusBadge } from "@/components/shared/status-badges"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { requireStudent } from "@/lib/auth/session"
import { orNotFound } from "@/lib/pages"
import { getStudentOverview } from "@/lib/services/student-portal"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Dashboard · Student Portal" }

export default async function StudentDashboardPage() {
  // The student is always taken from the session, never from the URL (architecture.md §24).
  const session = await requireStudent()
  const { student, fee, nextDeadline, counts } = await orNotFound(getStudentOverview(session.studentId))

  const details = [
    { label: "Student ID", value: <span className="font-mono">{student.studentId}</span> },
    { label: "Programme", value: `${student.programme.name} (${student.programme.code})` },
    { label: "Academic Year", value: student.academicYear },
    { label: "Email", value: student.email },
    { label: "Enrolment Status", value: <EnrolmentStatusBadge status={student.enrolmentStatus} /> },
  ]

  return (
    <>
      <PageHeader title={`Welcome, ${student.fullName}`} description="Your enrolment, fees, assessments and results" />

      {student.enrolmentStatus !== "ENROLLED" && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          Your enrolment status is <strong>{student.enrolmentStatus.toLowerCase()}</strong>, so you cannot submit new work. Contact the
          Registry if this is not right.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <ReceiptIcon className="size-4" /> Outstanding balance
            </CardDescription>
            <CardTitle className={`text-2xl tabular-nums ${fee.isOverdue ? "text-destructive" : ""}`}>
              {fee.hasFeeAssigned ? formatCurrency(fee.outstanding, fee.currency) : "No fee assigned"}
            </CardTitle>
            <CardAction>
              <FeeStatusBadge status={fee.status} />
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {fee.status === "OVERDUE" && `${fee.daysOverdue} ${fee.daysOverdue === 1 ? "day" : "days"} overdue — due ${formatDate(fee.dueDate!)}`}
            {fee.status === "OUTSTANDING" && `Due ${formatDate(fee.dueDate!)}`}
            {fee.status === "PAID" && "Paid in full. Thank you."}
            {fee.status === "NO_FEE" && "The Registry has not assigned a fee to you yet."}
          </CardContent>
          <CardFooter>
            <ButtonLink href="/student/fees" variant="outline" size="sm">
              View fees
            </ButtonLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <CalendarClockIcon className="size-4" /> Next deadline
            </CardDescription>
            <CardTitle className="text-lg">
              {nextDeadline ? formatDateTime(nextDeadline.submissionDeadline) : "No upcoming deadlines"}
            </CardTitle>
            {nextDeadline && (
              <CardAction>
                <SubmissionStatusBadge status={nextDeadline.status} />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {nextDeadline ? `${nextDeadline.title} · ${nextDeadline.module}` : "You have no open assessments with a future deadline."}
          </CardContent>
          <CardFooter>
            <ButtonLink href="/student/assessments" variant="outline" size="sm">
              View assessments
            </ButtonLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <ClipboardListIcon className="size-4" /> Work to do
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">{counts.toSubmit}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {counts.toSubmit === 1 ? "assessment" : "assessments"} still to submit
            {counts.late > 0 && ` · ${counts.late} submitted late`}
          </CardContent>
          <CardFooter className="flex items-center gap-2 text-sm">
            <TrophyIcon className="size-4 text-muted-foreground" />
            <Link href="/student/marksheet" className="underline-offset-4 hover:underline">
              {counts.publishedResults} published {counts.publishedResults === 1 ? "result" : "results"}
            </Link>
          </CardFooter>
        </Card>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Enrolment details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {details.map((item) => (
              <div key={item.label} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="text-sm font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  )
}
