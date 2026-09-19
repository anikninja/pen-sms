"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput, runAction } from "@/lib/errors"
import { assessmentCreateSchema, assessmentUpdateSchema } from "@/lib/validations/assessments"
import { parseId } from "@/lib/validations/ids"

function revalidateAssessments() {
  revalidatePath("/staff", "layout")
  revalidatePath("/student", "layout")
}

export async function createAssessmentAction(input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const result = await (await data()).createAssessment(parseInput(assessmentCreateSchema, input))
    revalidateAssessments()
    return result
  })
}

export async function updateAssessmentAction(assessmentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const assessment = await (await data()).updateAssessment(
      parseId(assessmentId, "Assessment"),
      parseInput(assessmentUpdateSchema, input)
    )
    revalidateAssessments()
    return assessment
  })
}

export async function setAssessmentOpenAction(assessmentId: unknown, isOpen: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const assessment = await (await data()).updateAssessment(parseId(assessmentId, "Assessment"), {
      isOpen: parseInput(z.boolean({ error: "isOpen must be true or false." }), isOpen),
    })
    revalidateAssessments()
    return assessment
  })
}
