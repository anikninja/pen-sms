/**
 * Prepares the demo data for a NEW, EMPTY production D1 database and R2 bucket — as files to review
 * and then apply with Wrangler (docs/deployment.md). Talks to nothing remote.
 *
 * 1. seeds a throwaway local D1 through @prisma/adapter-d1 (so values are stored exactly as the
 *    Worker stores them: ISO-8601 dates, integer minor units), with dates relative to today;
 * 2. writes <out>/seed.sql: plain INSERTs in foreign-key order. They fail on a database that
 *    already has data (unique keys), so they can never overwrite anything;
 * 3. writes <out>/files/<key>: the submission PDFs, and <out>/r2-commands.txt to upload them.
 *
 *   node node_modules/tsx/dist/cli.mjs worker/scripts/prepare-remote-seed.ts [--out <dir>]
 *
 * The output contains the demo accounts' bcrypt hashes (password "Password123!"): keep it out of git
 * (the default location, worker/.wrangler/remote-seed, is git-ignored) and delete it after use.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { PrismaD1 } from "@prisma/adapter-d1"
import { getPlatformProxy } from "wrangler"

import { PrismaClient } from ".prisma/client-d1"

import { seedD1 } from "../../prisma/d1/seed"

const WORKER_DIR = path.join(__dirname, "..")
// Parents before children, so every foreign key already exists when its row is inserted.
const TABLES = ["Programme", "ProgrammeFee", "Student", "StudentFee", "User", "Payment", "Assessment", "Submission", "Result"]

function outDir(): string {
  const index = process.argv.indexOf("--out")
  return index === -1 ? path.join(WORKER_DIR, ".wrangler", "remote-seed") : path.resolve(process.argv[index + 1])
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} as SQL`)
    return String(value)
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  throw new Error(`Unexpected value of type ${typeof value}`)
}

async function main() {
  const out = outDir()
  const state = mkdtempSync(path.join(os.tmpdir(), "pen-sms-remote-seed-"))
  try {
    execFileSync(process.execPath, [path.join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js"), "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], {
      cwd: WORKER_DIR,
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: "ignore",
    })

    const proxy = await getPlatformProxy<{ DB: D1Database }>({
      configPath: path.join(WORKER_DIR, "wrangler.jsonc"),
      persist: { path: path.join(state, "v3") },
      remoteBindings: false,
    })
    const db = new PrismaClient({ adapter: new PrismaD1(proxy.env.DB) })
    try {
      const { counts, files } = await seedD1(db)

      const lines = [
        `-- PEN SMS demo data for an EMPTY production D1 database (generated ${new Date().toISOString()}).`,
        "-- Plain INSERTs: applying this to a database that already has data fails instead of overwriting it.",
        "-- Dates are relative to the generation day (e.g. one programme fee is already overdue).",
      ]
      for (const table of TABLES) {
        const { results } = await proxy.env.DB.prepare(`SELECT * FROM "${table}"`).all<Record<string, unknown>>()
        lines.push("", `-- ${table}: ${results.length} rows`)
        for (const row of results) {
          const columns = Object.keys(row)
          lines.push(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((c) => sqlValue(row[c])).join(", ")});`)
        }
      }

      rmSync(out, { recursive: true, force: true })
      mkdirSync(path.join(out, "files"), { recursive: true })
      writeFileSync(path.join(out, "seed.sql"), lines.join("\n") + "\n")
      const commands: string[] = []
      for (const file of files) {
        const target = path.join(out, "files", ...file.key.split("/"))
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, file.bytes)
        commands.push(`npx wrangler r2 object put "inxapp-sms-files/${file.key}" --file "${target}" --content-type application/pdf --remote`)
      }
      writeFileSync(path.join(out, "r2-commands.txt"), commands.join("\n") + "\n")

      console.log("Demo data prepared:", counts)
      console.log(`  ${path.join(out, "seed.sql")}`)
      console.log(`  ${files.length} files in ${path.join(out, "files")} (upload commands: r2-commands.txt)`)
      console.log("Review seed.sql, apply it only to the new, empty database, then delete the folder.")
    } finally {
      await db.$disconnect()
      await proxy.dispose()
    }
  } finally {
    rmSync(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
