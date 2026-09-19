"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { authorizeStudent } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { fieldError, parseInput, runAction } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"

function revalidateSubmissions() {
  revalidatePath("/student", "layout")
  revalidatePath("/staff", "layout")
}

/** FormData: assessmentId, file. The student is always the signed-in student (§27.3). */
export async function submitAssessmentAction(formData: FormData) {
  return runAction(async () => {
    const session = await authorizeStudent()
    const file = formData.get("file")
    if (!(file instanceof File)) throw fieldError("file", "Choose a PDF or DOCX file to upload.")

    const submission = await (await data()).submitAssessment({
      studentId: session.studentId,
      assessmentId: parseId(formData.get("assessmentId"), "Assessment"),
      file,
    })
    revalidateSubmissions()
    return submission
  })
}

const declaredFileSchema = z.object({
  name: z.string().min(1, "Choose a PDF or DOCX file to upload.").max(255),
  type: z.string().max(200),
  size: z.number().int().min(0),
})

/**
 * Step 1 of a direct upload (Worker backend): runs every submission check and returns a short-lived
 * URL on the Worker for the browser to send the file to, so the file never passes through this
 * server (Vercel limits request bodies to 4.5 MB). Returns null when the backend takes uploads
 * through submitAssessmentAction instead (PostgreSQL + local disk).
 */
export async function requestUploadAction(assessmentId: unknown, file: unknown) {
  return runAction(async () => {
    await authorizeStudent()
    return (await data()).requestSubmissionUpload(parseId(assessmentId, "Assessment"), parseInput(declaredFileSchema, file))
  })
}

/** Step 2, after the browser has uploaded the file to the Worker: refresh the pages that show it. */
export async function uploadCompletedAction() {
  return runAction(async () => {
    await authorizeStudent()
    revalidateSubmissions()
  })
}
