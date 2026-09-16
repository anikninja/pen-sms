"use server"

import { revalidatePath } from "next/cache"

import { authorizeStudent } from "@/lib/auth/guards"
import { fieldError, runAction } from "@/lib/errors"
import { submitAssessment } from "@/lib/services/submissions"
import { parseId } from "@/lib/validations/ids"

/** FormData: assessmentId, file. The student is always the signed-in student (§27.3). */
export async function submitAssessmentAction(formData: FormData) {
  return runAction(async () => {
    const session = await authorizeStudent()
    const file = formData.get("file")
    if (!(file instanceof File)) throw fieldError("file", "Choose a PDF or DOCX file to upload.")

    const submission = await submitAssessment({
      studentId: session.studentId,
      assessmentId: parseId(formData.get("assessmentId"), "Assessment"),
      file,
    })
    revalidatePath("/student", "layout")
    revalidatePath("/staff", "layout")
    return submission
  })
}
