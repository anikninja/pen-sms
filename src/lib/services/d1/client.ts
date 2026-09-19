import type { PrismaClient } from ".prisma/client-d1"

/**
 * The Prisma client as the D1 services may use it (generated from prisma/d1/schema.prisma).
 *
 * `$transaction` is removed on purpose. With @prisma/adapter-d1 (6.12), "implicit & explicit
 * transactions will be ignored and run as individual queries" — neither the interactive form nor
 * the array (batch) form is atomic on D1. Prisma nested writes and non-native upserts are several
 * statements for the same reason. The D1 services therefore make every invariant hold inside a
 * SINGLE SQL statement (D1 runs statements one at a time, each atomically), and use compensating
 * writes only where one statement cannot span the tables involved.
 */
export type D1Client = Omit<PrismaClient, "$transaction">

/**
 * Integer results of raw queries arrive as bigint (native SQLite engine) or number (D1 adapter);
 * normalise them. Throws on anything that is not an exact integer.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value)
  if (value === null || value === undefined) return 0n
  throw new TypeError(`Expected an integer from the database, got ${typeof value}: ${String(value)}`)
}
