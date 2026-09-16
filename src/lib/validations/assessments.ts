import { z } from "zod"

import { dateTimeSchema, idSchema, requiredText } from "@/lib/validations/common"

const assessmentFields = {
  programmeId: idSchema,
  title: requiredText("Title", 200),
  module: requiredText("Module", 120),
  submissionDeadline: dateTimeSchema("Submission deadline"),
  isOpen: z.boolean({ error: "isOpen must be true or false." }),
}

export const assessmentCreateSchema = z.object({
  ...assessmentFields,
  isOpen: assessmentFields.isOpen.default(true),
})

export const assessmentUpdateSchema = z
  .object(assessmentFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.")

export const assessmentListSchema = z.object({
  programmeId: z.preprocess((value) => (value === "" ? undefined : value), idSchema.optional()),
})

export type AssessmentCreateInput = z.output<typeof assessmentCreateSchema>
export type AssessmentUpdateInput = z.output<typeof assessmentUpdateSchema>
