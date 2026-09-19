/**
 * Seeds the Worker's LOCAL D1 database and LOCAL R2 bucket (wrangler's state in worker/.wrangler)
 * with the demo data of prisma/d1/seed.ts, through @prisma/adapter-d1 — so dates are stored exactly
 * as the Worker stores them. Never touches PostgreSQL or anything in Cloudflare.
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
  const proxy = await getPlatformProxy<{ DB: D1Database; FILES: R2Bucket }>({
    configPath: path.join(__dirname, "..", "wrangler.jsonc"),
    // Local only: never connect bindings to Cloudflare from this script.
    remoteBindings: false,
  })
  const db = new PrismaClient({ adapter: new PrismaD1(proxy.env.DB) })
  try {
    const { counts, files } = await seedD1(db)
    for (const file of files) {
      await proxy.env.FILES.put(file.key, file.bytes, { httpMetadata: { contentType: "application/pdf" } })
    }
    console.log("Seeded the local D1 database:", counts)
    console.log(`Put ${files.length} submission files into the local R2 bucket.`)
  } finally {
    await db.$disconnect()
    await proxy.dispose()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
