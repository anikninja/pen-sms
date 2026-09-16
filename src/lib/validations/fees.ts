import { z } from "zod"

import { isoDateSchema, moneySchema, pastOrTodaySchema } from "@/lib/validations/common"

export const paymentCreateSchema = z.object({
  amount: moneySchema("Payment amount must be greater than zero."),
  paymentDate: pastOrTodaySchema("Payment date", "Payment date cannot be in the future."),
  referenceNumber: z
    .string({ error: "Reference number is required." })
    .trim()
    .toUpperCase()
    .min(1, "Reference number is required.")
    .max(50, "Reference number must be at most 50 characters.")
    .regex(/^[A-Z0-9][A-Z0-9\-_/]*$/, "Use letters, numbers, and - _ / only."),
})

export const feeAssignSchema = z.discriminatedUnion(
  "source",
  [
    z.object({ source: z.literal("TARIFF") }),
    z.object({
      source: z.literal("MANUAL"),
      amount: moneySchema("Fee must be greater than zero."),
      dueDate: isoDateSchema("Due date"),
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code.")
        .default("BDT"),
    }),
  ],
  { error: 'Source must be "TARIFF" or "MANUAL".' }
)

export type PaymentCreateInput = z.output<typeof paymentCreateSchema>
export type FeeAssignInput = z.output<typeof feeAssignSchema>
