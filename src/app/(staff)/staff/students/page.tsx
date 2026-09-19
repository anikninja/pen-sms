import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon, SearchIcon } from "lucide-react"

import { ButtonLink } from "@/components/shared/button-link"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { EnrolmentStatusBadge } from "@/components/shared/status-badges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import { data } from "@/lib/data"
import { studentSearchSchema } from "@/lib/validations/students"

export const metadata: Metadata = { title: "Students · Registry" }

const STATUSES = [
  { value: "ENROLLED", label: "Enrolled" },
  { value: "DEFERRED", label: "Deferred" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "COMPLETED", label: "Completed" },
]

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  await requireStaff()

  // Search and filters run in the database query, driven by the URL (architecture.md §20).
  const parsed = studentSearchSchema.safeParse(await searchParams)
  const search = parsed.success ? parsed.data : {}
  const { students, programmes } = await (await data()).getStudentsPage(search)
  const filtered = Boolean(search.q || search.programme || search.status)

  return (
    <>
      <PageHeader
        title="Students"
        description="Search by name or Student ID, and filter by programme or enrolment status."
        actions={
          <ButtonLink href="/staff/students/new">
            <PlusIcon /> New student
          </ButtonLink>
        }
      />

      {/* Keyed on the active filters: client navigation (Clear, sidebar, dashboard links) reuses this
          component, and uncontrolled fields ignore new defaultValues — remounting resets them. */}
      <form
        key={`${search.q ?? ""}|${search.programme ?? ""}|${search.status ?? ""}`}
        method="get"
        className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-end"
        role="search"
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Name or Student ID</Label>
          <Input id="q" name="q" defaultValue={search.q ?? ""} placeholder="e.g. Rahim or SMS-2026-0002" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="programme">Programme</Label>
          <NativeSelect id="programme" name="programme" defaultValue={search.programme ?? ""} className="w-full lg:w-56">
            <NativeSelectOption value="">All programmes</NativeSelectOption>
            {programmes.map((programme) => (
              <NativeSelectOption key={programme.id} value={programme.code}>
                {programme.code} — {programme.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={search.status ?? ""} className="w-full lg:w-40">
            <NativeSelectOption value="">All statuses</NativeSelectOption>
            {STATUSES.map((status) => (
              <NativeSelectOption key={status.value} value={status.value}>
                {status.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit">
            <SearchIcon /> Search
          </Button>
          {filtered && (
            <ButtonLink href="/staff/students" variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
      </form>

      {!parsed.success && <p className="text-sm text-destructive">Some filters were invalid and have been ignored.</p>}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {students.length} {students.length === 1 ? "student" : "students"}
        {filtered ? " match your search" : ""}
      </p>

      {students.length === 0 ? (
        <EmptyState title={filtered ? "No students match your search." : "No students yet."}>
          {filtered ? "Try a different name, Student ID or filter." : "Create the first student record to get started."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/staff/students/${student.id}`} className="underline-offset-4 hover:underline">
                      {student.studentId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{student.fullName}</div>
                    <div className="text-xs text-muted-foreground">{student.email}</div>
                  </TableCell>
                  <TableCell title={student.programme.name}>{student.programme.code}</TableCell>
                  <TableCell>{student.academicYear}</TableCell>
                  <TableCell>
                    <EnrolmentStatusBadge status={student.enrolmentStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <ButtonLink href={`/staff/students/${student.id}`} variant="ghost" size="sm">
                        View
                      </ButtonLink>
                      <ButtonLink href={`/staff/students/${student.id}/edit`} variant="ghost" size="sm">
                        Edit
                      </ButtonLink>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
