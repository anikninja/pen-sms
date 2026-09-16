import { EnrolmentStatus } from "@prisma/client"
import { z } from "zod"

import { ageOn, registryToday } from "@/lib/domain/dates"
import {
  emailSchema,
  idSchema,
  isoDateSchema,
  optionalText,
  requiredText,
} from "@/lib/validations/common"

export const MIN_STUDENT_AGE = 15
export const MIN_ACADEMIC_YEAR = 2000

const dateOfBirthSchema = isoDateSchema("Date of birth").superRefine((value, ctx) => {
  const today = registryToday(new Date())
  if (value >= today) {
    ctx.addIssue({ code: "custom", message: "Date of birth must be in the past." })
  } else if (ageOn(value, today) < MIN_STUDENT_AGE) {
    ctx.addIssue({ code: "custom", message: `Student must be at least ${MIN_STUDENT_AGE} years old.` })
  }
})

export const academicYearSchema = z.coerce
  .number({ error: "Academic year is required." })
  .int("Academic year must be a whole year.")
  .refine((year) => year >= MIN_ACADEMIC_YEAR && year <= new Date().getFullYear() + 1, {
    error: () => `Academic year must be between ${MIN_ACADEMIC_YEAR} and ${new Date().getFullYear() + 1}.`,
  })

const enrolmentStatusSchema = z.enum(EnrolmentStatus, {
  error: "Choose a valid enrolment status.",
})

const studentFields = {
  fullName: requiredText("Full name", 120),
  email: emailSchema,
  dateOfBirth: dateOfBirthSchema,
  programmeId: idSchema,
  academicYear: academicYearSchema,
  enrolmentStatus: enrolmentStatusSchema,
}

export const studentCreateSchema = z.object({
  ...studentFields,
  enrolmentStatus: enrolmentStatusSchema.default("ENROLLED"),
  /** When given, a STUDENT login is created with this initial password. */
  password: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().min(8, "Password must be at least 8 characters.").max(72).optional()
  ),
})

export const studentUpdateSchema = z
  .object(studentFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.")

export const studentSearchSchema = z.object({
  q: optionalText(100),
  programme: optionalText(20),
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    enrolmentStatusSchema.optional()
  ),
})

export type StudentCreateInput = z.output<typeof studentCreateSchema>
export type StudentUpdateInput = z.output<typeof studentUpdateSchema>
export type StudentSearchInput = z.output<typeof studentSearchSchema>
