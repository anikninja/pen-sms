/**
 * Data consistency check for the LOCAL D1 database and R2 bucket (wrangler's local state), run after
 * the end-to-end tests (scripts/e2e-cloudflare-local.mjs). Read-only. Fails (exit 1) when:
 * - any row points at a missing parent (orphaned records);
 * - a Student ID is duplicated or malformed;
 * - a money value is not a positive integer of minor units, or a student has paid more than the fee
 *   (a negative balance), or has payments without a fee;
 * - a grade is outside 0–100, or a STUDENT login has no student;
 * - an R2 object has no submission (orphaned object) or a submission has no object.
 *
 *   node node_modules/tsx/dist/cli.mjs worker/scripts/check-consistency.ts [--persist-to <dir>]
 */
import path from "node:path"

import { getPlatformProxy } from "wrangler"

type Check = { name: string; ok: boolean; detail?: unknown }

function persistPath(): { path: string } | undefined {
  const index = process.argv.indexOf("--persist-to")
  return index === -1 ? undefined : { path: path.join(path.resolve(process.argv[index + 1]), "v3") }
}

async function main() {
  const proxy = await getPlatformProxy<{ DB: D1Database; FILES: R2Bucket }>({
    configPath: path.join(__dirname, "..", "wrangler.jsonc"),
    persist: persistPath(),
    remoteBindings: false,
  })
  const { DB, FILES } = proxy.env
  const rows = async <T = Record<string, unknown>>(sql: string) => (await DB.prepare(sql).all<T>()).results
  const checks: Check[] = []
  const expectNone = async (name: string, sql: string) => {
    const found = await rows(sql)
    checks.push({ name, ok: found.length === 0, detail: found.length ? found.slice(0, 5) : undefined })
  }

  try {
    // Orphaned records (the schema's foreign keys, checked explicitly).
    await expectNone("no fee without its student", `SELECT f.id FROM StudentFee f LEFT JOIN Student s ON s.id = f.studentId WHERE s.id IS NULL`)
    await expectNone("no payment without its student", `SELECT p.id FROM Payment p LEFT JOIN Student s ON s.id = p.studentId WHERE s.id IS NULL`)
    await expectNone("no submission without its student and assessment", `SELECT x.id FROM Submission x LEFT JOIN Student s ON s.id = x.studentId LEFT JOIN Assessment a ON a.id = x.assessmentId WHERE s.id IS NULL OR a.id IS NULL`)
    await expectNone("no result without its student and assessment", `SELECT r.id FROM Result r LEFT JOIN Student s ON s.id = r.studentId LEFT JOIN Assessment a ON a.id = r.assessmentId WHERE s.id IS NULL OR a.id IS NULL`)
    await expectNone("no student without its programme", `SELECT s.id FROM Student s LEFT JOIN Programme p ON p.id = s.programmeId WHERE p.id IS NULL`)
    await expectNone("every STUDENT login has its student", `SELECT u.id FROM User u LEFT JOIN Student s ON s.id = u.studentId WHERE u.role = 'STUDENT' AND s.id IS NULL`)

    // Student IDs
    await expectNone("no duplicate Student IDs", `SELECT studentId, COUNT(*) AS n FROM Student GROUP BY studentId HAVING n > 1`)
    const ids = await rows<{ studentId: string }>(`SELECT studentId FROM Student`)
    const malformed = ids.filter((row) => !/^SMS-\d{4}-\d{4,}$/.test(row.studentId))
    checks.push({ name: "every Student ID has the SMS-YYYY-NNNN form", ok: malformed.length === 0, detail: malformed.slice(0, 5) })

    // Money: exact integers of minor units, and no negative balances
    for (const table of ["ProgrammeFee", "StudentFee", "Payment"]) {
      await expectNone(`${table}.amount is a positive integer`, `SELECT id, typeof(amount) AS t, amount FROM ${table} WHERE typeof(amount) <> 'integer' OR amount <= 0`)
    }
    await expectNone(
      "no student has paid more than the fee (no negative balance)",
      `SELECT f.studentId, f.amount, SUM(p.amount) AS paid FROM StudentFee f JOIN Payment p ON p.studentId = f.studentId GROUP BY f.studentId HAVING paid > f.amount`
    )
    await expectNone("no payments without a fee", `SELECT DISTINCT p.studentId FROM Payment p LEFT JOIN StudentFee f ON f.studentId = p.studentId WHERE f.id IS NULL`)
    await expectNone("no duplicate payment references", `SELECT referenceNumber, COUNT(*) AS n FROM Payment GROUP BY referenceNumber HAVING n > 1`)

    const totals = await rows<{ currency: string; fees: number; paid: number }>(
      `SELECT f.currency, SUM(f.amount) AS fees, COALESCE(SUM((SELECT SUM(p.amount) FROM Payment p WHERE p.studentId = f.studentId)), 0) AS paid FROM StudentFee f GROUP BY f.currency`
    )
    const exact = totals.every((row) => Number.isSafeInteger(row.fees) && Number.isSafeInteger(row.paid))
    checks.push({
      name: "fee and payment totals are exact integers",
      ok: exact,
      detail: totals.map((row) => ({
        currency: row.currency,
        fees: (BigInt(row.fees) / 100n).toString() + "." + String(BigInt(row.fees) % 100n).padStart(2, "0"),
        outstanding: (BigInt(row.fees - row.paid) / 100n).toString() + "." + String(BigInt(row.fees - row.paid) % 100n).padStart(2, "0"),
      })),
    })

    // Results
    await expectNone("grades are whole numbers 0–100", `SELECT id, grade FROM Result WHERE typeof(grade) <> 'integer' OR grade < 0 OR grade > 100`)
    await expectNone("one result per student and assessment", `SELECT studentId, assessmentId, COUNT(*) AS n FROM Result GROUP BY studentId, assessmentId HAVING n > 1`)

    // R2 ↔ database
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await FILES.list({ cursor })
      keys.push(...page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    const fileUrls = (await rows<{ fileUrl: string }>(`SELECT fileUrl FROM Submission`)).map((row) => row.fileUrl)
    const orphanedObjects = keys.filter((key) => !fileUrls.includes(key))
    const missingObjects = fileUrls.filter((key) => !keys.includes(key))
    checks.push({ name: "no orphaned R2 objects (every object belongs to a submission)", ok: orphanedObjects.length === 0, detail: orphanedObjects })
    checks.push({ name: "no missing R2 objects (every submission has its file)", ok: missingObjects.length === 0, detail: missingObjects })

    const counts = await rows(`SELECT (SELECT COUNT(*) FROM Student) AS students, (SELECT COUNT(*) FROM Payment) AS payments, (SELECT COUNT(*) FROM Submission) AS submissions, (SELECT COUNT(*) FROM Result) AS results`)
    console.log("Local D1:", counts[0], `R2 objects: ${keys.length}`)
  } finally {
    await proxy.dispose()
  }

  for (const check of checks) {
    console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}${check.detail && (!check.ok || check.name.includes("totals")) ? ` ${JSON.stringify(check.detail)}` : ""}`)
  }
  const failed = checks.filter((check) => !check.ok).length
  console.log(failed ? `\n${failed} consistency check(s) failed` : `\nAll ${checks.length} consistency checks passed`)
  process.exitCode = failed ? 1 : 0
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
