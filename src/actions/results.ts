"use server"

import { revalidatePath } from "next/cache"

import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput, runAction } from "@/lib/errors"
import {
  setAssessmentResultsPublished,
  setResultPublished,
  setStudentResultsPublished,
  upsertResult,
} from "@/lib/services/results"
import { parseId } from "@/lib/validations/ids"
import { publishSchema, resultUpsertSchema } from "@/lib/validations/results"

function revalidateResults() {
  revalidatePath("/staff", "layout")
  revalidatePath("/student", "layout")
}

export async function saveGradeAction(studentId: unknown, assessmentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const { grade } = parseInput(resultUpsertSchema, input)
    const result = await upsertResult(parseId(studentId, "Student"), parseId(assessmentId, "Assessment"), grade)
    revalidateResults()
    return result
  })
}

export async function setResultPublishedAction(studentId: unknown, assessmentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const { published } = parseInput(publishSchema, input)
    const result = await setResultPublished(
      parseId(studentId, "Student"),
      parseId(assessmentId, "Assessment"),
      published
    )
    revalidateResults()
    return result
  })
}

export async function setStudentResultsPublishedAction(studentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const { published } = parseInput(publishSchema, input)
    const result = await setStudentResultsPublished(parseId(studentId, "Student"), published)
    revalidateResults()
    return result
  })
}

export async function setAssessmentResultsPublishedAction(assessmentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const { published } = parseInput(publishSchema, input)
    const result = await setAssessmentResultsPublished(parseId(assessmentId, "Assessment"), published)
    revalidateResults()
    return result
  })
}
