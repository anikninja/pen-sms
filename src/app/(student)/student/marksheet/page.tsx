import type { Metadata } from "next"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStudent } from "@/lib/auth/session"
import type { Classification } from "@/lib/domain/results"
import { data } from "@/lib/data"

export const metadata: Metadata = { title: "Marksheet · Student Portal" }

const CLASSIFICATION_VARIANT: Record<Classification, "default" | "secondary" | "outline" | "destructive"> = {
  Distinction: "default",
  Merit: "secondary",
  Pass: "outline",
  Fail: "destructive",
}

export default async function MarksheetPage() {
  const session = await requireStudent()
  // Published results only. The filter is in the database query, so withheld results are never
  // loaded, rendered or sent to the browser — not even as a count (architecture.md §13, §24).
  const results = await (await data()).getMyMarksheet(session.studentId)

  return (
    <>
      <PageHeader
        title="Marksheet"
        description="Your published results. Results appear here once the Registry publishes them."
      />

      {results.length === 0 ? (
        <EmptyState title="No published results yet">Check back after your assessments have been marked and published.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessment</TableHead>
                <TableHead>Module</TableHead>
                <TableHead className="text-right">Grade</TableHead>
                <TableHead>Classification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.assessmentId}>
                  <TableCell className="font-medium">{result.title}</TableCell>
                  <TableCell>{result.module}</TableCell>
                  <TableCell className="text-right tabular-nums">{result.grade}</TableCell>
                  <TableCell>
                    <Badge variant={CLASSIFICATION_VARIANT[result.classification]}>{result.classification}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Classification: Distinction 70–100 · Merit 60–69 · Pass 40–59 · Fail 0–39.
      </p>
    </>
  )
}
