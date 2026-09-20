// Local end-to-end run of the full Cloudflare architecture (docs/local-cloudflare.md):
//
//   Node fetch (browser) → Next.js (DATA_BACKEND=worker) → Worker (wrangler dev) → local D1 + R2
//
// 1. a throwaway local D1 + R2 (never the developer's worker/.wrangler/state), migrated with
//    `wrangler d1 migrations apply --local` and seeded through @prisma/adapter-d1;
// 2. the Worker with `wrangler dev`, and the built Next.js app with `next start`, sharing a fresh
//    random internal secret (never written into the repository);
// 3. scripts/e2e-api.mjs (E2E_BACKEND=worker), optionally scripts/perf-local.mjs (--perf);
// 4. a Worker outage: the app must answer with a safe error, not internals;
// 5. worker/scripts/check-consistency.ts on the resulting D1 + R2.
// DATABASE_URL points at an unreachable host throughout: any PostgreSQL access would fail the run.
//
//   npm run test:e2e:cloudflare [-- --skip-build] [-- --perf] [-- --keep-state]
import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = process.cwd()
if (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).name !== "inx-sms") {
  console.error("Run this from the repository root.")
  process.exit(1)
}
const args = new Set(process.argv.slice(2))
const WORKER_PORT = 8787
const APP_PORT = 3100
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`
const APP_URL = `http://localhost:${APP_PORT}`
const WRANGLER = path.join(ROOT, "worker", "node_modules", "wrangler", "bin", "wrangler.js")
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next")
if (!fs.existsSync(WRANGLER)) {
  console.error("Worker dependencies are missing: run `npm ci --prefix worker` first.")
  process.exit(1)
}

const state = fs.mkdtempSync(path.join(os.tmpdir(), "inx-sms-e2e-"))
const logs = path.join(state, "logs")
fs.mkdirSync(logs)
const secret = crypto.randomBytes(32).toString("base64url")
const envFile = path.join(state, "worker.env")
fs.writeFileSync(envFile, `WORKER_INTERNAL_SECRET="${secret}"\n`)

const baseEnv = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NEXT_TELEMETRY_DISABLED: "1" }
const appEnv = {
  ...baseEnv,
  DATA_BACKEND: "worker",
  WORKER_API_URL: WORKER_URL,
  WORKER_INTERNAL_SECRET: secret,
  // Unreachable on purpose: the Worker backend must never touch PostgreSQL.
  DATABASE_URL: "postgresql://nobody:nobody@postgres.invalid:5432/none",
  AUTH_SECRET: process.env.AUTH_SECRET ?? crypto.randomBytes(32).toString("base64url"),
  DEMO_MODE: "false",
}

const children = []
function start(name, command, commandArgs, options) {
  const out = fs.openSync(path.join(logs, `${name}.log`), "a")
  const child = spawn(command, commandArgs, { ...options, stdio: ["ignore", out, out], detached: process.platform !== "win32" })
  children.push({ name, child })
  return child
}
function stop(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  else {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
}
function run(name, command, commandArgs, env = baseEnv) {
  console.log(`\n▶ ${name}`)
  const result = spawnSync(command, commandArgs, { cwd: ROOT, env, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status})`)
}
async function waitFor(url, accept, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    try {
      const res = await fetch(url)
      if (accept(res.status)) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${url} did not come up (logs: ${logs})`)
}

let failed = false
let worker
let app
try {
  // wrangler reads worker/wrangler.jsonc from its working directory.
  console.log("\n▶ Migrate the local D1 (wrangler d1 migrations apply --local)")
  const migrate = spawnSync(process.execPath, [WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], { cwd: path.join(ROOT, "worker"), env: baseEnv, stdio: "inherit" })
  if (migrate.status !== 0) throw new Error("migration failed")
  run("Seed D1 + R2 through @prisma/adapter-d1", process.execPath, [TSX, "worker/scripts/seed-local.ts", "--persist-to", state])

  if (!args.has("--skip-build")) run("Build Next.js", process.execPath, [NEXT, "build"], appEnv)

  console.log("\n▶ Start the Worker (wrangler dev) and Next.js (next start, DATA_BACKEND=worker)")
  worker = start("worker", process.execPath, [WRANGLER, "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", state, "--env-file", envFile, "--var", `ALLOWED_ORIGINS:${APP_URL}`, "--show-interactive-dev-session=false"], {
    cwd: path.join(ROOT, "worker"),
    env: baseEnv,
  })
  app = start("next", process.execPath, [NEXT, "start", "-p", String(APP_PORT)], { cwd: ROOT, env: appEnv })
  await waitFor(`${WORKER_URL}/health`, (status) => status === 200)
  await waitFor(`${APP_URL}/api/students`, (status) => status === 401)

  run("End-to-end API tests (scripts/e2e-api.mjs, E2E_BACKEND=worker)", process.execPath, ["scripts/e2e-api.mjs"], { ...baseEnv, E2E_BASE_URL: APP_URL, E2E_BACKEND: "worker" })
  if (args.has("--perf")) run("Performance sanity (scripts/perf-local.mjs)", process.execPath, ["scripts/perf-local.mjs"], { ...baseEnv, E2E_BASE_URL: APP_URL, WORKER_URL })

  console.log("\n▶ Worker outage: the app must fail safely")
  const staffCookie = await (async () => {
    const jar = new Map()
    const keep = (res) => res.headers.getSetCookie().forEach((c) => { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)) })
    const csrf = await fetch(`${APP_URL}/api/auth/csrf`)
    keep(csrf)
    const { csrfToken } = await csrf.json()
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
    keep(await fetch(`${APP_URL}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email: "registry@sms.inxapp.net", password: "Password123!" }) }))
    return cookie()
  })()
  stop(worker)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const apiDown = await fetch(`${APP_URL}/api/students`, { headers: { cookie: staffCookie } })
  const apiBody = await apiDown.json().catch(() => ({}))
  const pageDown = await fetch(`${APP_URL}/staff/dashboard`, { headers: { cookie: staffCookie } })
  const pageText = await pageDown.text()
  const loginDown = await fetch(`${APP_URL}/login`)
  const outage = [
    ["API → 500 with a safe message", apiDown.status === 500 && apiBody.error === "The service is temporarily unavailable. Please try again."],
    ["API error has no internals", !/ECONNREFUSED|127\.0\.0\.1|fetch failed|stack|prisma/i.test(JSON.stringify(apiBody))],
    ["page → error page without internals", pageDown.status >= 500 && !/ECONNREFUSED|WORKER_|fetch failed/i.test(pageText)],
    ["login page still renders", loginDown.status === 200],
  ]
  for (const [name, ok] of outage) console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (outage.some(([, ok]) => !ok)) failed = true

  stop(app)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  run("Data consistency (worker/scripts/check-consistency.ts)", process.execPath, [TSX, "worker/scripts/check-consistency.ts", "--persist-to", state])
} catch (error) {
  failed = true
  console.error(`\n✗ ${error.message}`)
  console.error(`Logs: ${logs}`)
} finally {
  for (const { child } of children) stop(child)
  fs.rmSync(envFile, { force: true })
  if (!args.has("--keep-state") && !failed) fs.rmSync(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  else console.log(`Local state kept in ${state}`)
}

console.log(failed ? "\nCloudflare end-to-end run FAILED" : "\nCloudflare end-to-end run passed")
process.exitCode = failed ? 1 : 0
