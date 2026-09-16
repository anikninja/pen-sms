"use server"

import { revalidatePath } from "next/cache"

import { authorizeStaff } from "@/lib/auth/guards"
import { parseInput, runAction } from "@/lib/errors"
import { assignStudentFee, createPayment } from "@/lib/services/fees"
import { feeAssignSchema, paymentCreateSchema } from "@/lib/validations/fees"
import { parseId } from "@/lib/validations/ids"

function revalidateFees() {
  revalidatePath("/staff", "layout")
  revalidatePath("/student", "layout")
}

export async function createPaymentAction(studentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const payment = await createPayment(parseId(studentId, "Student"), parseInput(paymentCreateSchema, input))
    revalidateFees()
    return payment
  })
}

export async function assignStudentFeeAction(studentId: unknown, input: unknown) {
  return runAction(async () => {
    await authorizeStaff()
    const summary = await assignStudentFee(parseId(studentId, "Student"), parseInput(feeAssignSchema, input))
    revalidateFees()
    return summary
  })
}
