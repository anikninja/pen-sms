import type { Metadata } from "next"
import { DownloadIcon, LockIcon } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OpenBadge, SubmissionStatusBadge } from "@/components/shared/status-badges"
import { SubmissionUpload } from "@/components/student/submission-upload"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireStudent } from "@/lib/auth/session"
import { data } from "@/lib/data"
import { formatBytes, formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Assessments · Student Portal" }

export default async function StudentAssessmentsPage() {
  // Assessments of the signed-in student's own programme only (architecture.md §24).
  const session = await requireStudent()
  const assessments = await (await data()).getMyAssessments(session.studentId)

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Submit a PDF or DOCX while an assessment is open. Work submitted after the deadline is accepted but marked late."
      />

      {assessments.length === 0 ? (
        <EmptyState title="No assessments yet">Assessments for your programme will appear here.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {assessments.map((assessment) => {
            const { isPastDeadline } = assessment
            return (
              <Card key={assessment.id}>
                <CardHeader>
                  <CardTitle className="text-base">{assessment.title}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{assessment.module}</span>
                    <span aria-hidden>·</span>
                    <span className={isPastDeadline ? "" : "text-foreground"}>
                      {isPastDeadline ? "Deadline was" : "Due"} {formatDateTime(assessment.submissionDeadline)}
                    </span>
                  </CardDescription>
                  <CardAction className="flex flex-wrap justify-end gap-2">
                    <OpenBadge isOpen={assessment.isOpen} />
                    <SubmissionStatusBadge status={assessment.status} isOpen={assessment.isOpen} />
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  {assessment.submission ? (
                    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <a
                          href={`/api/files/${assessment.submission.id}`}
                          className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                        >
                          <DownloadIcon className="size-4" />
                          {assessment.submission.fileName}
                        </a>
                        <span className="ml-2 text-xs text-muted-foreground">{formatBytes(assessment.submission.fileSize)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        Submitted {formatDateTime(assessment.submission.submittedAt)}
                        {assessment.submission.isLate && <span className="ml-2 font-medium text-destructive">Late</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">You have not submitted this assessment yet.</p>
                  )}

                  {assessment.canUpload ? (
                    <SubmissionUpload
                      assessmentId={assessment.id}
                      assessmentTitle={assessment.title}
                      hasSubmission={assessment.submission !== null}
                      isPastDeadline={isPastDeadline}
                    />
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LockIcon className="size-4 shrink-0" />
                      {assessment.uploadBlockedReason}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
