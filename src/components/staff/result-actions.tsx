"use client"

import {
  setAssessmentResultsPublishedAction,
  setResultPublishedAction,
  setStudentResultsPublishedAction,
} from "@/actions/results"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { formatCurrency } from "@/lib/utils/format"

export type OverdueInfo = { outstanding: string; currency: string; daysOverdue: number } | null

function OverdueWarning({ overdue, who }: { overdue: OverdueInfo; who: string }) {
  if (!overdue) return null
  return (
    <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {who} has an overdue balance of <strong>{formatCurrency(overdue.outstanding, overdue.currency)}</strong> (
      {overdue.daysOverdue} {overdue.daysOverdue === 1 ? "day" : "days"} overdue). Results are not withheld automatically —
      publish only if Registry policy allows it.
    </p>
  )
}

/** Publish or withhold one result. Publishing warns when the student is overdue (§13). */
export function ResultPublishToggle({
  studentId,
  assessmentId,
  published,
  studentName,
  assessmentTitle,
  overdue,
}: {
  studentId: string
  assessmentId: string
  published: boolean
  studentName: string
  assessmentTitle: string
  overdue: OverdueInfo
}) {
  return published ? (
    <ConfirmAction
      label="Withhold"
      title="Withhold this result?"
      description={`${studentName} will no longer see their result for ${assessmentTitle}.`}
      confirmLabel="Withhold result"
      confirmVariant="destructive"
      action={() => setResultPublishedAction(studentId, assessmentId, { published: false })}
      success="Result withheld."
    />
  ) : (
    <ConfirmAction
      label="Publish"
      title="Publish this result?"
      description={
        <>
          {studentName} will see their grade for {assessmentTitle}.
          <OverdueWarning overdue={overdue} who={studentName} />
        </>
      }
      confirmLabel="Publish result"
      action={() => setResultPublishedAction(studentId, assessmentId, { published: true })}
      success="Result published."
    />
  )
}

/** Publish or withhold a student's whole marksheet — the brief's "per student" (§13, §23). */
export function MarksheetPublishButtons({
  studentId,
  studentName,
  resultCount,
  unpublishedCount,
  overdue,
}: {
  studentId: string
  studentName: string
  resultCount: number
  unpublishedCount: number
  overdue: OverdueInfo
}) {
  const publishedCount = resultCount - unpublishedCount
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction
        label="Publish marksheet"
        variant="default"
        disabled={unpublishedCount === 0}
        title={`Publish all results for ${studentName}?`}
        description={
          <>
            All {resultCount} of {studentName}&apos;s results will be visible to them ({unpublishedCount} currently withheld).
            <OverdueWarning overdue={overdue} who={studentName} />
          </>
        }
        confirmLabel="Publish marksheet"
        action={() => setStudentResultsPublishedAction(studentId, { published: true })}
        success={(data) => `${data.updated} results published.`}
      />
      <ConfirmAction
        label="Withhold marksheet"
        disabled={publishedCount === 0}
        title={`Withhold all results for ${studentName}?`}
        description={`${studentName} will no longer see any of their ${resultCount} results.`}
        confirmLabel="Withhold marksheet"
        confirmVariant="destructive"
        action={() => setStudentResultsPublishedAction(studentId, { published: false })}
        success={(data) => `${data.updated} results withheld.`}
      />
    </div>
  )
}

/** Publish or withhold every result of one assessment (bulk convenience, §13). */
export function AssessmentPublishButtons({
  assessmentId,
  assessmentTitle,
  gradedCount,
  unpublishedCount,
  overdueGradedCount,
}: {
  assessmentId: string
  assessmentTitle: string
  gradedCount: number
  unpublishedCount: number
  overdueGradedCount: number
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction
        label="Publish all results"
        variant="default"
        disabled={unpublishedCount === 0}
        title={`Publish all results for ${assessmentTitle}?`}
        description={
          <>
            {gradedCount} graded {gradedCount === 1 ? "student" : "students"} will see their result ({unpublishedCount} currently withheld).
            {overdueGradedCount > 0 && (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {overdueGradedCount} of them {overdueGradedCount === 1 ? "has" : "have"} an overdue fee balance. Results are
                not withheld automatically — publish only if Registry policy allows it.
              </p>
            )}
          </>
        }
        confirmLabel="Publish all"
        action={() => setAssessmentResultsPublishedAction(assessmentId, { published: true })}
        success={(data) => `${data.updated} results published.`}
      />
      <ConfirmAction
        label="Withhold all"
        disabled={gradedCount - unpublishedCount === 0}
        title={`Withhold all results for ${assessmentTitle}?`}
        description="No student will see their result for this assessment until it is published again."
        confirmLabel="Withhold all"
        confirmVariant="destructive"
        action={() => setAssessmentResultsPublishedAction(assessmentId, { published: false })}
        success={(data) => `${data.updated} results withheld.`}
      />
    </div>
  )
}
