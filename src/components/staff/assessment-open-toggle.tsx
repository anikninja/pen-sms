"use client"

import { setAssessmentOpenAction } from "@/actions/assessments"
import { ConfirmAction } from "@/components/shared/confirm-action"

export function AssessmentOpenToggle({ assessmentId, title, isOpen }: { assessmentId: string; title: string; isOpen: boolean }) {
  return isOpen ? (
    <ConfirmAction
      label="Close submissions"
      title={`Close "${title}" for submissions?`}
      description="Students will no longer be able to submit or replace work. Grading is not affected, and you can reopen it later."
      confirmLabel="Close submissions"
      confirmVariant="destructive"
      action={() => setAssessmentOpenAction(assessmentId, false)}
      success="Assessment closed for submissions."
    />
  ) : (
    <ConfirmAction
      label="Reopen submissions"
      title={`Reopen "${title}" for submissions?`}
      description="Students can submit again. Anything submitted after the deadline is flagged late."
      confirmLabel="Reopen submissions"
      action={() => setAssessmentOpenAction(assessmentId, true)}
      success="Assessment reopened for submissions."
    />
  )
}
