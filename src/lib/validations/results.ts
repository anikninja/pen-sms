import { z } from "zod"

const GRADE_RANGE = "Grade must be between 0 and 100."

export const gradeSchema = z
  .union([z.number(), z.string().trim().min(1, "Enter a grade.")], { error: "Enter a grade." })
  .transform((value) => (typeof value === "string" ? Number(value) : value))
  .pipe(
    z
      .number({ error: "Grade must be a number." })
      .int("Grade must be a whole number.")
      .min(0, GRADE_RANGE)
      .max(100, GRADE_RANGE)
  )

export const resultUpsertSchema = z.object({ grade: gradeSchema })

export const publishSchema = z.object({
  published: z.boolean({ error: "published must be true or false." }),
})

export type ResultUpsertInput = z.output<typeof resultUpsertSchema>
