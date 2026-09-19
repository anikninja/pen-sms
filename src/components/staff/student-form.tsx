"use client"

import { useRouter } from "next/navigation"

import { createStudentAction, updateStudentAction } from "@/actions/students"
import { formValues, toFieldErrors, useServerAction } from "@/components/shared/use-server-action"
import { ButtonLink } from "@/components/shared/button-link"
import { useInitialValue } from "@/components/shared/use-initial-value"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { ProgrammeDto } from "@/lib/services/shared/programmes"
import type { StudentDto } from "@/lib/services/shared/students"

const STATUSES = [
  { value: "ENROLLED", label: "Enrolled" },
  { value: "DEFERRED", label: "Deferred" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "COMPLETED", label: "Completed" },
]

export function StudentForm(props: {
  mode: "create" | "edit"
  programmes: ProgrammeDto[]
  student?: StudentDto
  defaultYear: number
}) {
  // Saving revalidates this page before redirecting; frozen defaults keep the uncontrolled inputs stable.
  const { mode, programmes, student, defaultYear } = useInitialValue(props)
  const router = useRouter()
  const { run, pending, fieldErrors } = useServerAction()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = formValues(event.currentTarget)

    if (mode === "create") {
      run(() => createStudentAction(values), {
        success: (created) => `Student ${created.studentId} created.`,
        onSuccess: (created) => router.push(`/staff/students/${created.id}`),
      })
    } else if (student) {
      run(() => updateStudentAction(student.id, values), {
        success: "Student details saved.",
        onSuccess: () => router.push(`/staff/students/${student.id}`),
      })
    }
  }

  const err = (field: string) => fieldErrors[field]

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl">
      <FieldGroup>
        {mode === "edit" && student && (
          <Field>
            <FieldLabel>Student ID</FieldLabel>
            <Input value={student.studentId} disabled readOnly className="font-mono" />
            <FieldDescription>Generated automatically and never changes.</FieldDescription>
          </Field>
        )}

        <Field data-invalid={!!err("fullName")}>
          <FieldLabel htmlFor="fullName">Full name</FieldLabel>
          <Input id="fullName" name="fullName" defaultValue={student?.fullName} aria-invalid={!!err("fullName")} required />
          <FieldError errors={toFieldErrors(err("fullName"))} />
        </Field>

        <Field data-invalid={!!err("email")}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" defaultValue={student?.email} aria-invalid={!!err("email")} required />
          {mode === "edit" && student?.hasLogin && (
            <FieldDescription>This student signs in with this email; changing it changes their login.</FieldDescription>
          )}
          <FieldError errors={toFieldErrors(err("email"))} />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field data-invalid={!!err("dateOfBirth")}>
            <FieldLabel htmlFor="dateOfBirth">Date of birth</FieldLabel>
            <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={student?.dateOfBirth} aria-invalid={!!err("dateOfBirth")} required />
            <FieldError errors={toFieldErrors(err("dateOfBirth"))} />
          </Field>

          <Field data-invalid={!!err("academicYear")}>
            <FieldLabel htmlFor="academicYear">Academic year</FieldLabel>
            <Input
              id="academicYear"
              name="academicYear"
              type="number"
              min={2000}
              max={defaultYear + 1}
              defaultValue={student?.academicYear ?? defaultYear}
              aria-invalid={!!err("academicYear")}
              required
            />
            <FieldError errors={toFieldErrors(err("academicYear"))} />
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field data-invalid={!!err("programmeId")}>
            <FieldLabel htmlFor="programmeId">Programme</FieldLabel>
            <NativeSelect id="programmeId" name="programmeId" defaultValue={student?.programme.id ?? ""} className="w-full" aria-invalid={!!err("programmeId")} required>
              <NativeSelectOption value="" disabled>
                Choose a programme
              </NativeSelectOption>
              {programmes.map((programme) => (
                <NativeSelectOption key={programme.id} value={programme.id}>
                  {programme.code} — {programme.name}
                  {programme.active ? "" : " (inactive)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {mode === "edit" && (
              <FieldDescription>Changing programme or year does not change the assigned fee.</FieldDescription>
            )}
            <FieldError errors={toFieldErrors(err("programmeId"))} />
          </Field>

          <Field data-invalid={!!err("enrolmentStatus")}>
            <FieldLabel htmlFor="enrolmentStatus">Enrolment status</FieldLabel>
            <NativeSelect id="enrolmentStatus" name="enrolmentStatus" defaultValue={student?.enrolmentStatus ?? "ENROLLED"} className="w-full">
              {STATUSES.map((status) => (
                <NativeSelectOption key={status.value} value={status.value}>
                  {status.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={toFieldErrors(err("enrolmentStatus"))} />
          </Field>
        </div>

        {mode === "create" && (
          <Field data-invalid={!!err("password")}>
            <FieldLabel htmlFor="password">Initial password (optional)</FieldLabel>
            <Input id="password" name="password" type="password" autoComplete="new-password" aria-invalid={!!err("password")} />
            <FieldDescription>
              Set one to create a student login with their email. Leave empty if the student does not need to sign in yet.
            </FieldDescription>
            <FieldError errors={toFieldErrors(err("password"))} />
          </Field>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : mode === "create" ? "Create student" : "Save changes"}
          </Button>
          <ButtonLink href={student ? `/staff/students/${student.id}` : "/staff/students"} variant="outline">
            Cancel
          </ButtonLink>
        </div>
      </FieldGroup>
    </form>
  )
}
