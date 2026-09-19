import { Prisma } from "@prisma/client"

import { formatMoney, parseMoney } from "@/lib/money"

/**
 * The conversion boundary between PostgreSQL money and the shared fee rules. PostgreSQL keeps
 * Decimal(12, 2) columns; the rules in src/lib/domain/fees.ts work on minor-unit bigints.
 */

/** Decimal(12, 2) → minor units. Exact: a Decimal(12, 2) value never has more than 2 decimal places. */
export function fromDecimal(value: Prisma.Decimal): bigint {
  // Decimal#toFixed() with no argument prints every digit in plain notation (no rounding, no exponent).
  return parseMoney(value.toFixed())
}

/** A nullable `_sum` of a Decimal column → minor units (no rows = 0). */
export function sumFromDecimal(value: Prisma.Decimal | null | undefined): bigint {
  return value ? fromDecimal(value) : 0n
}

/** Minor units → Decimal, for writing to PostgreSQL. */
export function toDecimal(minor: bigint): Prisma.Decimal {
  return new Prisma.Decimal(formatMoney(minor))
}
