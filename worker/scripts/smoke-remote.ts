/**
 * Smoke test of a deployed Worker, called directly (no Next.js): health, the trust boundary,
 * sign-in lookup, session, a database read, authorization, a database write, and an R2 upload and
 * download. Needs the Worker's internal secret, which it only uses in memory.
 *
 *   WORKER_API_URL=https://sms-api.inxapp.net WORKER_INTERNAL_SECRET_FILE=<secrets file> \
 *     node node_modules/tsx/dist/cli.mjs worker/scripts/smoke-remote.ts
 *
 * The secret comes from WORKER_INTERNAL_SECRET_FILE (the JSON file given to `wrangler deploy
 * --secrets-file`, or a file holding just the value), so it never appears on a command line;
 * WORKER_INTERNAL_SECRET works too.
 *
 * Every write is put back: an already-published result is withheld and published again (a withheld
 * grade is never shown), and the uploaded test file is replaced again by the original demo file
 * (only its upload time changes). Works against the local Worker too (http://127.0.0.1:8787), which
 * is how it is tested.
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
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://sms.inxapp.net"
if (!BASE || !SECRET) {
  console.error("Set WORKER_API_URL and WORKER_INTERNAL_SECRET_FILE (or WORKER_INTERNAL_SECRET).")
  process.exit(1)
}

const STAFF = "registry@pensms.test"
const FARHANA = "farhana.akter@student.pensms.test"
const RAHIM = "rahim.uddin@student.pensms.test"
const STRAT = "5e3d0a1c-0000-4000-8000-000000000103" // open MBA assessment; Farhana has a submission

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 300)}`}`)
  if (!ok) failures++
}

async function call(method: string, path: string, userId: string | null, body?: unknown) {
  const url = new URL(path, BASE)
  const payload = body === undefined ? null : JSON.stringify(body)
  const token = await signApiToken(SECRET!, { userId, request: { method, pathAndQuery: url.pathname + url.search, body: payload } })
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
    body: payload,
  })
  return { status: res.status, data: (await res.json().catch(() => null)) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function main() {
  const health = await fetch(new URL("/health", BASE))
  const healthBody = (await health.json()) as { status: string; schema?: { latestMigration: string | null } }
  check("health: Worker, D1 and schema", health.status === 200 && healthBody.status === "ok" && healthBody.schema?.latestMigration === "0001_baseline.sql", healthBody)

  if (new URL(BASE!).protocol === "https:") {
    const plain = new URL("/health", BASE)
    plain.protocol = "http:"
    const insecure = await fetch(plain, { redirect: "manual" })
    check("plain HTTP → 403 (HTTPS only)", insecure.status === 403, insecure.status)
  }

  const unsigned = await fetch(new URL("/v1/students", BASE))
  check("unsigned request → 401", unsigned.status === 401)

  const lookup = await call("POST", "/v1/auth/lookup", null, { email: STAFF })
  check("sign-in lookup returns the staff account", lookup.status === 200 && lookup.data?.user?.role === "STAFF", lookup.status)
  const staffId: string = lookup.data.user.id
  const farhanaId: string = (await call("POST", "/v1/auth/lookup", null, { email: FARHANA })).data.user.id
  const rahimId: string = (await call("POST", "/v1/auth/lookup", null, { email: RAHIM })).data.user.id

  const session = await call("GET", "/v1/session", staffId)
  check("session: role read from D1", session.status === 200 && session.data.session.role === "STAFF", session.data)

  const dashboard = await call("GET", "/v1/views/dashboard", staffId)
  check("database read: dashboard", dashboard.status === 200 && typeof dashboard.data.totalStudents === "number", dashboard.status)

  check("authorization: a student on a staff route → 403", (await call("GET", "/v1/students", rahimId)).status === 403)
  check("authorization: staff on a student route → 403", (await call("GET", "/v1/me/marksheet", staffId)).status === 403)

  // Database write, then put back: withhold an already-published result and publish it again, so a
  // withheld grade is never shown to a student, not even for a moment.
  type GradingRow = { student: { id: string }; result: { published: boolean } | null }
  let target: { path: string } | null = null
  const results = await call("GET", "/v1/views/results", staffId)
  for (const { id } of (results.data.assessments ?? []) as { id: string }[]) {
    const view = id === results.data.selectedId ? results : await call("GET", `/v1/views/results?assessment=${encodeURIComponent(id)}`, staffId)
    const row = (view.data.grading?.rows as GradingRow[] | undefined)?.find((r) => r.result?.published)
    if (row) {
      target = { path: `/v1/students/${row.student.id}/results/${id}` }
      break
    }
  }
  if (target) {
    const withheld = await call("PATCH", target.path, staffId, { published: false })
    const republished = await call("PATCH", target.path, staffId, { published: true })
    check(
      "database write: a published result withheld and published again",
      withheld.status === 200 && withheld.data.result.published === false && republished.status === 200 && republished.data.result.published === true,
      { withheld: withheld.status, republished: republished.status }
    )
  } else {
    check("database write: a published result to toggle exists", false)
  }

  // R2 upload and download, then put the original demo file back.
  const farhanaAssessments = await call("GET", "/v1/me/assessments", farhanaId)
  const original = farhanaAssessments.data.assessments.find((a: { id: string }) => a.id === STRAT)?.submission
  const originalDownload = original ? await call("POST", `/v1/files/${original.id}/download-url`, farhanaId) : null
  const originalBytes = originalDownload ? new Uint8Array(await (await fetch(originalDownload.data.download.url)).arrayBuffer()) : null
  check("R2 download of the demo file", !!originalBytes && originalBytes.byteLength > 0, originalDownload?.status)

  const upload = async (name: string, bytes: Uint8Array) => {
    const grant = await call("POST", `/v1/assessments/${STRAT}/submissions/upload-url`, farhanaId, { fileName: name, fileType: "application/pdf", fileSize: bytes.byteLength })
    if (grant.status !== 200) return { status: grant.status, data: grant.data }
    const res = await fetch(grant.data.upload.url, { method: "PUT", headers: grant.data.upload.headers, body: bytes as BodyInit })
    return { status: res.status, data: (await res.json()) as { submission: { id: string } } }
  }
  const smokeBytes = new TextEncoder().encode("%PDF-1.4 smoke test")
  const uploaded = await upload("smoke-test.pdf", smokeBytes)
  check("R2 upload through a signed URL", uploaded.status === 200 || uploaded.status === 201, uploaded)
  if (uploaded.status < 300) {
    const id = uploaded.data.submission.id
    const grant = await call("POST", `/v1/files/${id}/download-url`, farhanaId)
    const bytes = new Uint8Array(await (await fetch(grant.data.download.url)).arrayBuffer())
    check("R2 download returns the uploaded bytes", new TextDecoder().decode(bytes) === "%PDF-1.4 smoke test")
    check("another student cannot get a download URL → 404", (await call("POST", `/v1/files/${id}/download-url`, rahimId)).status === 404)
    if (original && originalBytes) {
      const restored = await upload(original.fileName, originalBytes)
      check("original demo file put back", restored.status === 200, restored.status)
    }
  }

  const preflight = (origin: string) =>
    fetch(new URL("/v1/uploads", BASE), { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT" } })
  check(`CORS: ${APP_ORIGIN} may upload`, (await preflight(APP_ORIGIN)).status === 204)
  check("CORS: other origins may not", (await preflight("https://example.com")).status === 403)

  console.log(failures ? `\n${failures} smoke check(s) failed` : "\nAll smoke checks passed")
  process.exitCode = failures ? 1 : 0
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
