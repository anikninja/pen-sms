import type { Metadata } from "next"
import { PencilIcon } from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { OpenBadge } from "@/components/shared/status-badges"
import { AssessmentFormDialog } from "@/components/staff/assessment-form-dialog"
import { AssessmentOpenToggle } from "@/components/staff/assessment-open-toggle"
import { GradeTable } from "@/components/staff/grade-table"
import { AssessmentPublishButtons } from "@/components/staff/result-actions"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireStaff } from "@/lib/auth/session"
import { data } from "@/lib/data"
import { idOr404, orNotFound } from "@/lib/pages"
import { formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Assessment · Registry" }

export default async function AssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff()
  const id = idOr404((await params).id)

  const {
    assessment,
    grading: { rows, counts },
    programmes,
  } = await orNotFound((await data()).getAssessmentPage(id))
  const editablePrograms = programmes.filter((programme) => programme.active || programme.id === assessment.programme.id)

  return (
    <>
      <PageHeader
        title={assessment.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{assessment.module}</span>
            <span>·</span>
            <span>{assessment.programme.name}</span>
            <OpenBadge isOpen={assessment.isOpen} />
          </span>
        }
        actions={
          <>
            <AssessmentFormDialog
              programmes={editablePrograms}
              assessment={assessment}
              trigger={
                <Button variant="outline">
                  <PencilIcon /> Edit
                </Button>
              }
            />
            <AssessmentOpenToggle assessmentId={id} title={assessment.title} isOpen={assessment.isOpen} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          ["Deadline", formatDateTime(assessment.submissionDeadline), assessment.isPastDeadline ? "Passed" : "Upcoming"],
          ["Submitted", `${counts.submitted} / ${counts.students}`, counts.late ? `${counts.late} late` : "None late"],
          assessment.isOpen ? ["Pending", counts.pending, "Enrolled, not submitted"] : ["Not submitted", counts.pending, "Closed for submissions"],
          ["Graded", counts.graded, `${counts.students - counts.graded} not graded`],
          ["Withheld", counts.unpublished, `${counts.graded - counts.unpublished} published`],
        ].map(([label, value, hint]) => (
          <Card key={String(label)} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-lg tabular-nums">{value}</CardTitle>
              <CardDescription className="text-xs">{hint}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Submissions and grades</h2>
            <p className="text-sm text-muted-foreground">
              Enrolled students of {assessment.programme.code}, plus anyone who already submitted or was graded.
            </p>
          </div>
          <AssessmentPublishButtons
            assessmentId={id}
            assessmentTitle={assessment.title}
            gradedCount={counts.graded}
            unpublishedCount={counts.unpublished}
            overdueGradedCount={counts.overdueGraded}
          />
        </div>
        <GradeTable assessmentId={id} assessmentTitle={assessment.title} isOpen={assessment.isOpen} rows={rows} />
      </section>
    </>
  )
}
