import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OpenBadge } from "@/components/shared/status-badges"
import { AssessmentPicker } from "@/components/staff/assessment-picker"
import { GradeTable } from "@/components/staff/grade-table"
import { AssessmentPublishButtons } from "@/components/staff/result-actions"
import { requireStaff } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"
import { listAssessments } from "@/lib/services/assessments"
import { getGradingRows } from "@/lib/services/grading"
import { formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Results · Registry" }

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ assessment?: string }> }) {
  await requireStaff()
  const requested = (await searchParams).assessment

  const [assessments, withheld] = await Promise.all([
    listAssessments(),
    prisma.result.groupBy({ by: ["assessmentId"], where: { published: false }, _count: { _all: true } }),
  ])
  const withheldByAssessment = new Map(withheld.map((row) => [row.assessmentId, row._count._all]))

  // Default to the first assessment that still has withheld results, so outstanding work is shown first.
  const selected =
    assessments.find((assessment) => assessment.id === requested) ??
    (requested ? null : (assessments.find((assessment) => withheldByAssessment.has(assessment.id)) ?? assessments[0] ?? null))

  const grading = selected ? await getGradingRows(selected.id) : null

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
              unpublished: withheldByAssessment.get(assessment.id) ?? 0,
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
              <GradeTable assessmentId={selected.id} assessmentTitle={selected.title} rows={grading.rows} />
            </section>
          )}
        </>
      )}
    </>
  )
}
