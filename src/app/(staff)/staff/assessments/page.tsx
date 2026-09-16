import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { ButtonLink } from "@/components/shared/button-link"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { OpenBadge } from "@/components/shared/status-badges"
import { AssessmentFormDialog } from "@/components/staff/assessment-form-dialog"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import { listAssessments } from "@/lib/services/assessments"
import { listProgrammes } from "@/lib/services/programmes"
import { formatDateTime } from "@/lib/utils/format"

export const metadata: Metadata = { title: "Assessments · Registry" }

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ programme?: string }> }) {
  await requireStaff()
  const programmeCode = (await searchParams).programme

  const programmes = await listProgrammes()
  const programme = programmes.find((candidate) => candidate.code === programmeCode)
  const assessments = await listAssessments({ programmeId: programme?.id })
  const activeProgrammes = programmes.filter((candidate) => candidate.active)

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Create assessments per programme, open or close them for submissions, and grade the work."
        actions={
          <AssessmentFormDialog
            programmes={activeProgrammes}
            trigger={
              <Button>
                <PlusIcon /> New assessment
              </Button>
            }
          />
        }
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by programme">
        <ButtonLink href="/staff/assessments" variant={programme ? "outline" : "default"} size="sm">
          All programmes
        </ButtonLink>
        {programmes.map((candidate) => (
          <ButtonLink
            key={candidate.id}
            href={`/staff/assessments?programme=${candidate.code}`}
            variant={candidate.id === programme?.id ? "default" : "outline"}
            size="sm"
          >
            {candidate.code}
          </ButtonLink>
        ))}
      </nav>

      {assessments.length === 0 ? (
        <EmptyState title="No assessments yet">Create one to start collecting submissions.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Graded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.map((assessment) => (
                <TableRow key={assessment.id}>
                  <TableCell>
                    <Link href={`/staff/assessments/${assessment.id}`} className="font-medium underline-offset-4 hover:underline">
                      {assessment.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{assessment.module}</div>
                  </TableCell>
                  <TableCell>{assessment.programme.code}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(assessment.submissionDeadline)}
                    {assessment.isPastDeadline && <div className="text-xs text-muted-foreground">Deadline passed</div>}
                  </TableCell>
                  <TableCell>
                    <OpenBadge isOpen={assessment.isOpen} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{assessment.submissionCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{assessment.gradedCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
