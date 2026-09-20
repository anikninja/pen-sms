/**
 * Runs the D1 seed (prisma/d1/seed.ts) against a LOCAL SQLite file created from
 * prisma/d1/migrations/0001_baseline.sql, through Prisma's native SQLite engine — for trying out the
 * D1 schema and services. Never touches PostgreSQL (DATABASE_URL is not read) or Cloudflare.
 *
 *   D1_LOCAL_SQLITE_URL="file:/absolute/path/inx-sms-d1.sqlite" npx tsx prisma/d1/seed-local.ts
 *
 * Not for Wrangler's local D1 state or a real D1 database: the native engine stores DateTime as integer
 * milliseconds, @prisma/adapter-d1 as ISO text. Seed real D1 through the Worker (a later phase).
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { PrismaClient } from ".prisma/client-d1"

import { seedD1 } from "./seed"

async function main() {
  const url = process.env.D1_LOCAL_SQLITE_URL
  if (!url?.startsWith("file:")) {
    throw new Error('Set D1_LOCAL_SQLITE_URL to a local SQLite file, e.g. "file:/tmp/inx-sms-d1.sqlite".')
  }
  if (url.includes(".wrangler")) {
    throw new Error("Refusing to seed Wrangler's D1 state with the native engine (different DateTime encoding).")
  }

  // A new file gets the D1 baseline schema first.
  const file = url.slice("file:".length).split("?")[0]
  if (!existsSync(file)) {
    const raw = new DatabaseSync(file)
    raw.exec(readFileSync(path.join(__dirname, "migrations", "0001_baseline.sql"), "utf8"))
    raw.close()
    console.log(`Created ${file} from prisma/d1/migrations/0001_baseline.sql`)
  }

  const db = new PrismaClient({ datasourceUrl: url })
  try {
    const { counts, files } = await seedD1(db)
    console.log("Seeded D1 schema (local SQLite):", counts)
    console.log(`${files.length} submission files are not written (R2 is a later phase).`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
