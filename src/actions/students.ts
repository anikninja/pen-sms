"use server"

import { revalidatePath } from "next/cache"

import { authorizeStaff } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseInput, runAction } from "@/lib/errors"
import { parseId } from "@/lib/validations/ids"
import { studentCreateSchema, studentUpdateSchema } from "@/lib/validations/students"

export async function createStudentAction(input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const student = await (await data()).createStudent(parseInput(studentCreateSchema, input))
    revalidatePath("/staff", "layout")
    return student
  })
}

export async function updateStudentAction(studentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const student = await (await data()).updateStudent(parseId(studentId, "Student"), parseInput(studentUpdateSchema, input))
    revalidatePath("/staff", "layout")
    revalidatePath("/student", "layout")
    return student
  })
}
