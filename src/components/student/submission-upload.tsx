"use client"

import { useRef, useState } from "react"
import { UploadIcon } from "lucide-react"

import { submitAssessmentAction } from "@/actions/submissions"
import { useServerAction } from "@/components/shared/use-server-action"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ACCEPTED_FILE_TYPES, checkSubmissionFile } from "@/lib/domain/submissions"

const ACCEPT = [...Object.keys(ACCEPTED_FILE_TYPES), ...Object.values(ACCEPTED_FILE_TYPES)].join(",")

/**
 * Upload or replace a submission (architecture.md §9, §10, §24). The file is checked in the browser
 * for quick feedback; the server re-checks everything and decides lateness from its own clock.
 */
export function SubmissionUpload({
  assessmentId,
  assessmentTitle,
  hasSubmission,
  isPastDeadline,
}: {
  assessmentId: string
  assessmentTitle: string
  hasSubmission: boolean
  isPastDeadline: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const { run, pending, fieldErrors } = useServerAction()
  const inputId = `file-${assessmentId}`
  const error = localError ?? fieldErrors.file?.[0] ?? null

  function upload(file: File) {
    const formData = new FormData()
    formData.append("assessmentId", assessmentId)
    formData.append("file", file)
    run(() => submitAssessmentAction(formData), {
      success: (submission) =>
        `${submission.replaced ? "Submission replaced" : "Submitted"}: ${submission.fileName}${submission.isLate ? " (marked late)" : ""}.`,
      onSuccess: () => {
        formRef.current?.reset()
        setPendingFile(null)
      },
    })
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = (event.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0]
    if (!file) {
      setLocalError("Choose a PDF or DOCX file to upload.")
      return
    }
    const check = checkSubmissionFile(file)
    if (!check.ok) {
      setLocalError(check.error)
      return
    }
    setLocalError(null)
    if (hasSubmission) setPendingFile(file) // replacing asks first
    else upload(file)
  }

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {hasSubmission ? "Replace your submission" : "Upload your work"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id={inputId}
            name="file"
            type="file"
            accept={ACCEPT}
            aria-invalid={!!error}
            aria-describedby={`${inputId}-help`}
            onChange={() => setLocalError(null)}
            className="block w-full max-w-md rounded-md border border-input bg-transparent text-sm file:mr-3 file:h-9 file:border-0 file:border-r file:border-input file:bg-muted file:px-3 file:text-sm file:font-medium aria-invalid:border-destructive"
          />
          <Button type="submit" disabled={pending}>
            <UploadIcon /> {pending ? "Uploading…" : hasSubmission ? "Replace" : "Submit"}
          </Button>
        </div>
        <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
          PDF or DOCX, up to 5 MB.
          {isPastDeadline && !hasSubmission && " The deadline has passed — this submission will be marked late."}
          {hasSubmission && !isPastDeadline && " You can replace your file until the deadline."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <AlertDialog open={pendingFile !== null} onOpenChange={(open) => !open && setPendingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your submission?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current file for {assessmentTitle} will be replaced by <strong>{pendingFile?.name}</strong>. The previous file
              cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep current file</AlertDialogCancel>
            <Button disabled={pending} onClick={() => pendingFile && upload(pendingFile)}>
              {pending ? "Uploading…" : "Replace file"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
