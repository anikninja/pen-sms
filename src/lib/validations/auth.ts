import { z } from "zod"

import { emailSchema } from "@/lib/validations/common"

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
})

export type LoginInput = z.infer<typeof loginSchema>
