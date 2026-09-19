import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OpenBadge } from "@/components/shared/status-badges"
import { AssessmentPicker } from "@/components/staff/assessment-picker"
import { GradeTable } from "@/components/staff/grade-table"
import { AssessmentPublishButtons } from "@/components/staff/result-actions"
import { requireStaff } from "@/lib/auth/session"
import { data } from "@/lib/data"
import { formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Results · Registry" }

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ assessment?: string }> }) {
  await requireStaff()
  const requested = (await searchParams).assessment

  // The data layer picks the assessment: the requested one, else the first that still has withheld
  // results (so outstanding work is shown first), else the first.
  const { assessments, withheld, selectedId, grading } = await (await data()).getResultsPage(requested)
  const selected = assessments.find((assessment) => assessment.id === selectedId) ?? null

  return (
    <>
      <PageHeader
        title="Results"
        description="Choose an assessment, enter grades (0–100), then publish or withhold them. Students only see published results."
      />

      {assessments.length === 0 ? (
        <EmptyState title="No assessments yet">
          <Link href="/staff/assessments" className="underline underline-offset-4">
            Create an assessment
          </Link>{" "}
          before entering grades.
        </EmptyState>
      ) : (
        <>
          <AssessmentPicker
            selectedId={selected?.id ?? null}
            options={assessments.map((assessment) => ({
              id: assessment.id,
              title: assessment.title,
              module: assessment.module,
              programmeCode: assessment.programme.code,
              unpublished: withheld[assessment.id] ?? 0,
            }))}
          />

          {!selected || !grading ? (
            <EmptyState title="Assessment not found">Choose an assessment from the list.</EmptyState>
          ) : (
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-medium">
                    <Link href={`/staff/assessments/${selected.id}`} className="underline-offset-4 hover:underline">
                      {selected.title}
                    </Link>
                    <OpenBadge isOpen={selected.isOpen} />
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.programme.code} · deadline {formatDateTime(selected.submissionDeadline)} · {grading.counts.graded} of{" "}
                    {grading.counts.students} graded · {grading.counts.unpublished} withheld
                  </p>
                </div>
                <AssessmentPublishButtons
                  assessmentId={selected.id}
                  assessmentTitle={selected.title}
                  gradedCount={grading.counts.graded}
                  unpublishedCount={grading.counts.unpublished}
                  overdueGradedCount={grading.counts.overdueGraded}
                />
              </div>
              <GradeTable assessmentId={selected.id} assessmentTitle={selected.title} isOpen={selected.isOpen} rows={grading.rows} />
            </section>
          )}
        </>
      )}
    </>
  )
}
