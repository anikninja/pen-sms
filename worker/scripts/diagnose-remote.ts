/**
 * Read-only diagnosis of a deployed Worker after the INX SMS rebrand. Writes nothing and prints no
 * secret. Answers two questions that look the same from the sign-in screen:
 *
 *   1. Is the Worker running the rebranded build? The internal token's signing key is derived from
 *      constants that the rebrand changed, so a Worker built before it rejects (401) a token signed
 *      by this checkout, whatever the address.
 *   2. Which addresses does D1 hold? Before 0002_rebrand_demo_emails.sql the accounts are still
 *      @pensms.test / @student.pensms.test, so the new addresses cannot sign in.
 *
 *   WORKER_API_URL=https://sms-api.inxapp.net WORKER_INTERNAL_SECRET_FILE=<secrets file> \
 *     node node_modules/tsx/dist/cli.mjs worker/scripts/diagnose-remote.ts
 */
import { readFileSync } from "node:fs"

import { signApiToken } from "../../src/lib/internal-auth/token"

function secretFromFile(file: string): string {
  const text = readFileSync(file, "utf8").trim()
  if (!text.startsWith("{")) return text
  const value = (JSON.parse(text) as Record<string, unknown>).WORKER_INTERNAL_SECRET
  if (typeof value !== "string") throw new Error(`${file} has no WORKER_INTERNAL_SECRET.`)
  return value
}

const BASE = process.env.WORKER_API_URL
const SECRET = process.env.WORKER_INTERNAL_SECRET_FILE ? secretFromFile(process.env.WORKER_INTERNAL_SECRET_FILE) : process.env.WORKER_INTERNAL_SECRET
if (!BASE || !SECRET) {
  console.error("Set WORKER_API_URL and WORKER_INTERNAL_SECRET_FILE (or WORKER_INTERNAL_SECRET).")
  process.exit(1)
}

/** Signs with THIS checkout's constants, so a 401 means the deployed Worker predates the rebrand. */
async function lookup(email: string) {
  const url = new URL("/v1/auth/lookup", BASE)
  const payload = JSON.stringify({ email })
  const token = await signApiToken(SECRET!, { userId: null, request: { method: "POST", pathAndQuery: url.pathname, body: payload } })
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: payload })
  const data = (await res.json().catch(() => null)) as { user?: { role?: string } | null } | null
  return { status: res.status, found: Boolean(data?.user), role: data?.user?.role }
}

async function main() {
  const health = (await (await fetch(new URL("/health", BASE))).json()) as { schema?: { latestMigration: string | null } }
  const migration = health.schema?.latestMigration ?? null
  console.log(`\nD1 latest migration: ${migration}`)
  console.log(`  ${migration === "0002_rebrand_demo_emails.sql" ? "OK - the address migration has been applied." : "NOT APPLIED - the accounts still have their old addresses."}`)

  const probes = [
    ["registry@sms.inxapp.net", "staff, new"],
    ["registry@pensms.test", "staff, old"],
    ["rahim.uddin@sms.inxapp.net", "student, new"],
    ["rahim.uddin@student.pensms.test", "student, old"],
  ] as const

  console.log("\nAccount lookup (read-only):")
  let unauthorized = 0
  for (const [email, label] of probes) {
    const { status, found, role } = await lookup(email)
    if (status === 401) unauthorized++
    const verdict = status === 401 ? "401 - token rejected" : found ? `FOUND (${role})` : "not found"
    console.log(`  ${email.padEnd(34)} ${String(label).padEnd(14)} ${verdict}`)
  }

  console.log("\nVerdict:")
  if (unauthorized === probes.length) {
    console.log("  The Worker REJECTS tokens signed by this checkout: it is still the pre-rebrand build.")
    console.log("  Deploy it:  cd worker && npx wrangler deploy --env production --secrets-file ~/.inxapp-sms-deploy/worker-secrets.json")
  } else if (migration !== "0002_rebrand_demo_emails.sql") {
    console.log("  The Worker is the rebranded build, but D1 still holds the old addresses.")
    console.log("  Apply it:   cd worker && npx wrangler d1 migrations apply DB --env production --remote")
  } else {
    console.log("  Worker and D1 both look rebranded; the failure is elsewhere (check Vercel's env and build).")
  }
  console.log()
}

void main()
