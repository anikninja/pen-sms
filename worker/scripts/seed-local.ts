/**
 * Seeds the Worker's LOCAL D1 database (wrangler's state in worker/.wrangler) with the demo data of
 * prisma/d1/seed.ts, through @prisma/adapter-d1 — so dates are stored exactly as the Worker stores
 * them. Never touches PostgreSQL, a remote D1 database or R2.
 *
 *   npm --prefix worker run db:migrate:local
 *   npm --prefix worker run db:seed:local
 */
import path from "node:path"

import { PrismaD1 } from "@prisma/adapter-d1"
import { getPlatformProxy } from "wrangler"

import { PrismaClient } from ".prisma/client-d1"

import { seedD1 } from "../../prisma/d1/seed"

async function main() {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: path.join(__dirname, "..", "wrangler.jsonc"),
    // Local only: never connect bindings to Cloudflare from this script.
    remoteBindings: false,
  })
  const db = new PrismaClient({ adapter: new PrismaD1(proxy.env.DB) })
  try {
    const { counts, files } = await seedD1(db)
    console.log("Seeded the local D1 database:", counts)
    console.log(`${files.length} submission files are returned by the seed; R2 uploads come with file storage (Phase 5).`)
  } finally {
    await db.$disconnect()
    await proxy.dispose()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
