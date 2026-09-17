import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { DownloadIcon, PencilIcon } from "lucide-react"

import { ButtonLink } from "@/components/shared/button-link"
import { EmptyState } from "@/components/shared/empty-state"
import { FeeSummaryCards, PaymentHistoryTable } from "@/components/shared/fee-summary"
import { PageHeader } from "@/components/shared/page-header"
import {
  EnrolmentStatusBadge,
  FeeStatusBadge,
  OpenBadge,
  PublishedBadge,
  SubmissionStatusBadge,
} from "@/components/shared/status-badges"
import { AssignFeeDialog, RecordPaymentDialog, ReassignTariffButton } from "@/components/staff/fee-dialogs"
import { MarksheetPublishButtons, ResultPublishToggle, type OverdueInfo } from "@/components/staff/result-actions"
import { UrlTabs } from "@/components/staff/url-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import { registryToday } from "@/lib/domain/dates"
import { idOr404, orNotFound } from "@/lib/pages"
import { getStudentFees } from "@/lib/services/fees"
import { getStudentResults } from "@/lib/services/results"
import { getStudent } from "@/lib/services/students"
import { getStudentAssessments } from "@/lib/services/submissions"
import { formatBytes, formatDate, formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Student · Registry" }

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff()
  const id = idOr404((await params).id)

  const student = await orNotFound(getStudent(id))
  const [{ summary, payments, tariff }, assessments, results] = await Promise.all([
    getStudentFees(id),
    getStudentAssessments(id),
    getStudentResults(id),
  ])

  const overdue: OverdueInfo = summary.isOverdue
    ? { outstanding: summary.outstanding, currency: summary.currency, daysOverdue: summary.daysOverdue }
    : null
  const unpublishedCount = results.filter((result) => !result.published).length

  const details = (
    <Card className="max-w-3xl">
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {[
            ["Student ID", <span key="id" className="font-mono">{student.studentId}</span>],
            ["Full name", student.fullName],
            ["Email", student.email],
            ["Date of birth", formatDate(student.dateOfBirth)],
            ["Programme", `${student.programme.name} (${student.programme.code})`],
            ["Academic year", student.academicYear],
            ["Enrolment status", <EnrolmentStatusBadge key="status" status={student.enrolmentStatus} />],
            ["Student login", student.hasLogin ? "Yes — signs in with this email" : "No login"],
          ].map(([label, value]) => (
            <div key={String(label)} className="space-y-1">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )

  const fees = (
    <div className="space-y-6">
      {!summary.hasFeeAssigned ? (
        <EmptyState title="No fee assigned">
          {tariff
            ? "A tariff exists for this programme and year — assign it or set a manual fee."
            : "There is no tariff for this programme and academic year. Set a manual fee to record payments."}
        </EmptyState>
      ) : (
        <FeeSummaryCards summary={summary} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FeeStatusBadge status={summary.status} />
        {summary.isOverdue && (
          <span className="text-sm text-destructive">
            {summary.daysOverdue} {summary.daysOverdue === 1 ? "day" : "days"} overdue
          </span>
        )}
        {summary.hasFeeAssigned && (
          <span className="text-sm text-muted-foreground">
            {summary.source === "TARIFF" ? "From programme tariff" : "Manual fee"}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <AssignFeeDialog studentId={id} summary={summary} tariff={tariff} />
          <RecordPaymentDialog studentId={id} summary={summary} today={registryToday(new Date())} />
        </div>
      </div>

      {summary.hasFeeAssigned && !summary.matchesTariff && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>Fee does not match programme tariff.</strong>{" "}
            {summary.source === "MANUAL"
              ? "This fee was set manually."
              : "The student's programme or academic year changed after the fee was assigned."}
            {!tariff && " There is no tariff for the current programme and year."}
          </p>
          {tariff && <ReassignTariffButton studentId={id} tariff={tariff} />}
        </div>
      )}

      <section className="space-y-3">
        <h3 className="font-medium">Payment history</h3>
        <PaymentHistoryTable payments={payments} currency={summary.currency} />
      </section>
    </div>
  )

  const submissions =
    assessments.length === 0 ? (
      <EmptyState title="No assessments for this programme yet" />
    ) : (
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assessment</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>File</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assessments.map((assessment) => (
              <TableRow key={assessment.id}>
                <TableCell>
                  <Link href={`/staff/assessments/${assessment.id}`} className="font-medium underline-offset-4 hover:underline">
                    {assessment.title}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {assessment.module} <OpenBadge isOpen={assessment.isOpen} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(assessment.submissionDeadline)}</TableCell>
                <TableCell>
                  <SubmissionStatusBadge status={assessment.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {assessment.submission ? formatDateTime(assessment.submission.submittedAt) : "—"}
                </TableCell>
                <TableCell>
                  {assessment.submission ? (
                    <a href={`/api/files/${assessment.submission.id}`} className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
                      <DownloadIcon className="size-4" />
                      {assessment.submission.fileName}
                      <span className="text-xs text-muted-foreground">({formatBytes(assessment.submission.fileSize)})</span>
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )

  const resultsTab = (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {results.length === 0
            ? "No grades entered yet."
            : `${results.length - unpublishedCount} published · ${unpublishedCount} withheld`}
        </p>
        {results.length > 0 && (
          <MarksheetPublishButtons
            studentId={id}
            studentName={student.fullName}
            resultCount={results.length}
            unpublishedCount={unpublishedCount}
            overdue={overdue}
          />
        )}
      </div>
      {results.length === 0 ? (
        <EmptyState title="No results yet">Grades are entered from the assessment page or the Results page.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessment</TableHead>
                <TableHead className="text-right">Grade</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.assessmentId}>
                  <TableCell>
                    <Link href={`/staff/assessments/${result.assessmentId}`} className="font-medium underline-offset-4 hover:underline">
                      {result.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{result.module}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{result.grade}</TableCell>
                  <TableCell>{result.classification}</TableCell>
                  <TableCell>
                    <PublishedBadge published={result.published} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ResultPublishToggle
                      studentId={id}
                      assessmentId={result.assessmentId}
                      published={result.published}
                      studentName={student.fullName}
                      assessmentTitle={result.title}
                      overdue={overdue}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title={student.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{student.studentId}</span>
            <span>·</span>
            <span>{student.programme.code}</span>
            <span>·</span>
            <span>{student.academicYear}</span>
            <EnrolmentStatusBadge status={student.enrolmentStatus} />
            {summary.hasFeeAssigned && <FeeStatusBadge status={summary.status} />}
          </span>
        }
        actions={
          <ButtonLink href={`/staff/students/${id}/edit`} variant="outline">
            <PencilIcon /> Edit
          </ButtonLink>
        }
      />
      <Suspense>
        <UrlTabs
          defaultTab="details"
          tabs={[
            { value: "details", label: "Details", content: details },
            { value: "fees", label: "Fees", content: fees },
            { value: "submissions", label: "Submissions", content: submissions },
            { value: "results", label: `Results (${results.length})`, content: resultsTab },
          ]}
        />
      </Suspense>
    </>
  )
}
