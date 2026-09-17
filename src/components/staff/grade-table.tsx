"use client"

import { useState } from "react"
import Link from "next/link"
import { DownloadIcon } from "lucide-react"

import { saveGradeAction } from "@/actions/results"
import { EmptyState } from "@/components/shared/empty-state"
import {
  EnrolmentStatusBadge,
  PublishedBadge,
  SubmissionStatusBadge,
} from "@/components/shared/status-badges"
import { useServerAction } from "@/components/shared/use-server-action"
import { ResultPublishToggle, type OverdueInfo } from "@/components/staff/result-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculateClassification } from "@/lib/domain/results"
import type { AssessmentSubmissionRow } from "@/lib/services/assessments"
import { formatDateTime } from "@/lib/utils/format"

export type GradeRow = AssessmentSubmissionRow & { overdue: OverdueInfo }

/**
 * Submission status, download and inline grading for one assessment (§22, §23).
 * Classification is previewed as staff type; the server validates and recalculates it.
 */
export function GradeTable({
  assessmentId,
  assessmentTitle,
  isOpen,
  rows,
}: {
  assessmentId: string
  assessmentTitle: string
  isOpen: boolean
  rows: GradeRow[]
}) {
  if (rows.length === 0) {
    return <EmptyState title="No students to grade">No enrolled students in this programme yet.</EmptyState>
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Submission</TableHead>
            <TableHead>File</TableHead>
            <TableHead className="min-w-64">Grade</TableHead>
            <TableHead>Visibility</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <GradeTableRow key={row.student.id} assessmentId={assessmentId} assessmentTitle={assessmentTitle} isOpen={isOpen} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function GradeTableRow({
  assessmentId,
  assessmentTitle,
  isOpen,
  row,
}: {
  assessmentId: string
  assessmentTitle: string
  isOpen: boolean
  row: GradeRow
}) {
  const saved = row.result?.grade
  const [value, setValue] = useState(saved === undefined ? "" : String(saved))
  const { run, pending, fieldErrors } = useServerAction()

  const trimmed = value.trim()
  const numeric = trimmed === "" ? NaN : Number(trimmed)
  const valid = Number.isInteger(numeric) && numeric >= 0 && numeric <= 100
  const changed = trimmed !== (saved === undefined ? "" : String(saved))
  const localError = trimmed !== "" && !valid ? "Grade must be a whole number between 0 and 100." : null
  const error = localError ?? fieldErrors.grade?.[0] ?? null

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(() => saveGradeAction(row.student.id, assessmentId, { grade: trimmed }), {
      success: (result) => `${row.student.fullName}: ${result.grade} (${result.classification}) saved.`,
    })
  }

  return (
    <TableRow>
      <TableCell>
        <Link href={`/staff/students/${row.student.id}?tab=results`} className="font-medium underline-offset-4 hover:underline">
          {row.student.fullName}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{row.student.studentId}</span>
          {row.student.enrolmentStatus !== "ENROLLED" && <EnrolmentStatusBadge status={row.student.enrolmentStatus} />}
          {row.overdue && <span className="text-destructive">Fee overdue</span>}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <SubmissionStatusBadge status={row.status} isOpen={isOpen} />
        {row.submission && <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.submission.submittedAt)}</div>}
      </TableCell>
      <TableCell>
        {row.submission ? (
          <a href={`/api/files/${row.submission.id}`} className="inline-flex max-w-48 items-center gap-1 text-sm underline-offset-4 hover:underline">
            <DownloadIcon className="size-4 shrink-0" />
            <span className="truncate">{row.submission.fileName}</span>
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <form onSubmit={save} className="flex items-start gap-2" noValidate>
          <div className="space-y-1">
            <Input
              aria-label={`Grade for ${row.student.fullName}`}
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={!!error}
              className="w-20 tabular-nums"
              placeholder="0–100"
            />
            {error && <p className="max-w-48 text-xs text-destructive">{error}</p>}
          </div>
          <span className="w-24 pt-2 text-sm" aria-live="polite">
            {valid ? calculateClassification(numeric) : ""}
          </span>
          <Button type="submit" size="sm" variant={changed ? "default" : "outline"} disabled={!valid || !changed || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </TableCell>
      <TableCell>
        {row.result ? (
          <div className="flex items-center gap-2">
            <PublishedBadge published={row.result.published} />
            <ResultPublishToggle
              studentId={row.student.id}
              assessmentId={assessmentId}
              published={row.result.published}
              studentName={row.student.fullName}
              assessmentTitle={assessmentTitle}
              overdue={row.overdue}
            />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not graded</span>
        )}
      </TableCell>
    </TableRow>
  )
}
