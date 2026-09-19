import { json } from "../http"
import type { RouteContext } from "../router"

/** The tables of prisma/d1/migrations/0001_baseline.sql. */
const EXPECTED_TABLES = ["Assessment", "Payment", "Programme", "ProgrammeFee", "Result", "Student", "StudentFee", "Submission", "User"]

/**
 * GET /health — public. Shows that the Worker runs, D1 answers through Prisma, and the schema is
 * migrated. Reports no data, counts, versions of dependencies, secrets or configuration.
 */
export async function health({ db, now }: RouteContext): Promise<Response> {
  try {
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT name FROM sqlite_master WHERE type = 'table'`
    const present = new Set(tables.map((table) => table.name))
    const missing = EXPECTED_TABLES.filter((table) => !present.has(table))
    const migrations = present.has("d1_migrations")
      ? await db.$queryRaw<{ name: string }[]>`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`
      : []

    const ok = missing.length === 0
    return json(
      {
        status: ok ? "ok" : "degraded",
        d1: "ok",
        schema: { ok, missingTables: missing, latestMigration: migrations[0]?.name ?? null },
        time: now.toISOString(),
      },
      ok ? 200 : 503
    )
  } catch (error) {
    console.error(JSON.stringify({ event: "health_d1_failed", message: error instanceof Error ? error.name : "unknown" }))
    return json({ status: "error", d1: "unreachable", time: now.toISOString() }, 503)
  }
}
