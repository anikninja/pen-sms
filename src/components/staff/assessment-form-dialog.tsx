"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createAssessmentAction, updateAssessmentAction } from "@/actions/assessments"
import { useInitialValue } from "@/components/shared/use-initial-value"
import { formValues, toFieldErrors, useServerAction } from "@/components/shared/use-server-action"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { AssessmentDto } from "@/lib/services/assessments"
import type { ProgrammeDto } from "@/lib/services/programmes"
import { registryDateTimeLocalToIso, toRegistryDateTimeLocal } from "@/lib/utils/datetime"

export function AssessmentFormDialog({
  programmes,
  assessment,
  trigger,
}: {
  programmes: ProgrammeDto[]
  assessment?: AssessmentDto
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open: starts from the latest data and freezes its defaults. */}
        <AssessmentForm programmes={programmes} assessment={assessment} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AssessmentForm({
  onDone,
  ...props
}: {
  programmes: ProgrammeDto[]
  assessment?: AssessmentDto
  onDone: () => void
}) {
  const router = useRouter()
  const { programmes, assessment } = useInitialValue(props)
  const { run, pending, fieldErrors } = useServerAction()
  const editing = Boolean(assessment)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { deadline, ...values } = formValues(event.currentTarget)
    // The deadline input has no time zone; it is entered in Registry (Dhaka) time.
    // An empty value becomes "required"; an unparsable one is passed through for the server to reject.
    const input = { ...values, submissionDeadline: deadline ? (registryDateTimeLocalToIso(deadline) ?? deadline) : undefined }

    if (assessment) {
      run(() => updateAssessmentAction(assessment.id, input), {
        success: "Assessment saved.",
        onSuccess: onDone,
      })
    } else {
      run(() => createAssessmentAction({ ...input, isOpen: true }), {
        success: (result) => `Assessment "${result.assessment.title}" created.`,
        onSuccess: (result) => {
          result.warnings.forEach((warning) => toast.warning(warning))
          onDone()
          router.push(`/staff/assessments/${result.assessment.id}`)
        },
      })
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit assessment" : "New assessment"}</DialogTitle>
        <DialogDescription>
          Students of the chosen programme can submit while the assessment is open. Submissions after the deadline are accepted and flagged late.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!fieldErrors.programmeId}>
          <FieldLabel htmlFor="assessment-programme">Programme</FieldLabel>
          <NativeSelect
            id="assessment-programme"
            name="programmeId"
            defaultValue={assessment?.programme.id ?? ""}
            className="w-full"
            aria-invalid={!!fieldErrors.programmeId}
            required
          >
            <NativeSelectOption value="" disabled>
              Choose a programme
            </NativeSelectOption>
            {programmes.map((programme) => (
              <NativeSelectOption key={programme.id} value={programme.id}>
                {programme.code} — {programme.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {editing && <FieldDescription>Cannot change once work has been submitted or graded.</FieldDescription>}
          <FieldError errors={toFieldErrors(fieldErrors.programmeId)} />
        </Field>
        <Field data-invalid={!!fieldErrors.title}>
          <FieldLabel htmlFor="assessment-title">Title</FieldLabel>
          <Input id="assessment-title" name="title" defaultValue={assessment?.title} aria-invalid={!!fieldErrors.title} required />
          <FieldError errors={toFieldErrors(fieldErrors.title)} />
        </Field>
        <Field data-invalid={!!fieldErrors.module}>
          <FieldLabel htmlFor="assessment-module">Module</FieldLabel>
          <Input id="assessment-module" name="module" defaultValue={assessment?.module} aria-invalid={!!fieldErrors.module} required />
          <FieldError errors={toFieldErrors(fieldErrors.module)} />
        </Field>
        <Field data-invalid={!!fieldErrors.submissionDeadline}>
          <FieldLabel htmlFor="assessment-deadline">Submission deadline (Dhaka time)</FieldLabel>
          <Input
            id="assessment-deadline"
            name="deadline"
            type="datetime-local"
            defaultValue={assessment ? toRegistryDateTimeLocal(assessment.submissionDeadline) : undefined}
            aria-invalid={!!fieldErrors.submissionDeadline}
            required
          />
          <FieldError errors={toFieldErrors(fieldErrors.submissionDeadline)} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create assessment"}
        </Button>
      </DialogFooter>
    </form>
  )
}
