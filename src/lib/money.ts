/**
 * Exact money arithmetic in minor units (1/100 of the currency, e.g. paisa for BDT).
 *
 * Amounts are `bigint`s and never pass through floating point. Decimal strings ("150000.00")
 * are the only other representation: they arrive from forms and the API, and leave in DTOs.
 * PostgreSQL stores money as Decimal(12, 2); Cloudflare D1 stores the minor-unit integer.
 */

/** Minor units per currency unit: money has exactly 2 decimal places everywhere in the app. */
export const MINOR_UNITS_PER_UNIT = 100n

/** The largest single amount: 9,999,999,999.99 (PostgreSQL Decimal(12, 2); the D1 CHECK constraints). */
export const MAX_AMOUNT_MINOR = 999_999_999_999n

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

export type ParsedDecimal = {
  negative: boolean
  whole: string
  fraction: string
}

/** Splits a plain decimal string ("-12.5", "007", "0.10") into its parts; null for anything else. */
export function parseDecimalParts(value: string): ParsedDecimal | null {
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) return null
  return { negative: match[1] === "-", whole: match[2], fraction: match[3] ?? "" }
}

/** True when the decimal is zero or negative ("0", "-0.00", "-5"), decided on the digits alone. */
export function isNonPositive({ negative, whole, fraction }: ParsedDecimal): boolean {
  const isZero = /^0+$/.test(whole) && /^0*$/.test(fraction)
  return negative || isZero
}

/**
 * "150000.5" → 15000050n, "-0.05" → -5n. Accepts at most 2 decimal places and no range limit
 * (sums may exceed a single amount). Throws RangeError on anything else — use it on trusted values
 * (database rows, DTOs); user input goes through `moneySchema`, which reports each problem.
 */
export function parseMoney(value: string): bigint {
  const parts = parseDecimalParts(value)
  if (!parts || parts.fraction.length > 2) {
    throw new RangeError(`Not a money amount with at most 2 decimal places: "${value}"`)
  }
  const minor = BigInt(parts.whole) * MINOR_UNITS_PER_UNIT + BigInt(parts.fraction.padEnd(2, "0"))
  return parts.negative ? -minor : minor
}

/** 10050n → "100.50", 5n → "0.05", -5n → "-0.05". */
export function formatMoney(minor: bigint): string {
  const negative = minor < 0n
  const absolute = negative ? -minor : minor
  const whole = absolute / MINOR_UNITS_PER_UNIT
  const fraction = (absolute % MINOR_UNITS_PER_UNIT).toString().padStart(2, "0")
  return `${negative ? "-" : ""}${whole}.${fraction}`
}

/** 15000000n → "150,000.00". Thousands separators as en-US; exact for any size. */
export function formatMoneyGrouped(minor: bigint): string {
  const [whole, fraction] = formatMoney(minor).split(".")
  const sign = whole.startsWith("-") ? "-" : ""
  const digits = sign ? whole.slice(1) : whole
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`
}

/** Within the range a single stored amount may take (PostgreSQL Decimal(12, 2)). */
export function isAmountInRange(minor: bigint): boolean {
  return minor >= -MAX_AMOUNT_MINOR && minor <= MAX_AMOUNT_MINOR
}

export function sumMoney(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n)
}

export function maxMoney(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}
