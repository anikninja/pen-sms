import { z } from "zod"

import { isIsoDate, registryToday } from "@/lib/domain/dates"
import { formatMoney, isAmountInRange, isNonPositive, parseDecimalParts, parseMoney } from "@/lib/money"

export const idSchema = z.uuid("Invalid id.")

/** Empty strings from forms and query strings become undefined. */
export const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  )

export const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`)

export const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."))

/** A calendar date as YYYY-MM-DD. */
export const isoDateSchema = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .refine(isIsoDate, `${label} must be a valid date (YYYY-MM-DD).`)

/** A calendar date that is today or earlier in the Registry time zone. */
export const pastOrTodaySchema = (label: string, futureMessage: string) =>
  isoDateSchema(label).refine((value) => value <= registryToday(new Date()), futureMessage)

/** An ISO 8601 date-time with a time zone, e.g. 2026-09-30T23:59:00+06:00. */
export const dateTimeSchema = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .pipe(
      z.iso.datetime({
        offset: true,
        error: `${label} must be a date and time with a time zone (e.g. 2026-09-30T23:59:00+06:00).`,
      })
    )
    .transform((value) => new Date(value))

/**
 * Money arrives as a string or number and leaves as a normalised string ("150000.00"): at most
 * 2 decimal places, positive, and within Decimal(12, 2) (MAX_AMOUNT_MINOR). Checked on the digits
 * with exact integer arithmetic (src/lib/money.ts); PostgreSQL services turn the string into a
 * Decimal, D1 services into minor units with parseMoney().
 */
export const moneySchema = (positiveMessage: string) =>
  z
    .union([z.string(), z.number()], { error: "Enter an amount." })
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
      const parts = parseDecimalParts(value)
      if (!parts) {
        ctx.addIssue({ code: "custom", message: "Enter a valid amount." })
        return
      }
      if (isNonPositive(parts)) {
        ctx.addIssue({ code: "custom", message: positiveMessage })
        return
      }
      if (parts.fraction.length > 2) {
        ctx.addIssue({ code: "custom", message: "Amount can have at most 2 decimal places." })
        return
      }
      if (!isAmountInRange(parseMoney(value))) {
        ctx.addIssue({ code: "custom", message: "Amount is too large." })
      }
    })
    .transform((value) => formatMoney(parseMoney(value)))
