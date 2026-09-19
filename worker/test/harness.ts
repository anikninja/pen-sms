/**
 * Starts the real Worker locally for integration tests:
 *   1. a fresh local D1 in a temporary directory, migrated with `wrangler d1 migrations apply --local`
 *      (the same command and migration files as production);
 *   2. optionally seeded with prisma/d1/seed.ts through @prisma/adapter-d1 over the local D1 binding,
 *      so dates are stored exactly as the Worker stores them;
 *   3. the Worker itself in workerd (unstable_startWorker), with a test-only internal secret.
 * `call()` signs each request like the Next.js server does.
 */
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import { PrismaD1 } from "@prisma/adapter-d1"
import { getPlatformProxy, unstable_startWorker } from "wrangler"

import { PrismaClient } from ".prisma/client-d1"

import { signApiToken } from "@/lib/internal-auth/token"
import type { D1Client } from "@/lib/services/d1/client"

import { seedD1 } from "../../prisma/d1/seed"

const run = promisify(execFile)

export const WORKER_DIR = fileURLToPath(new URL("..", import.meta.url))
const CONFIG = path.join(WORKER_DIR, "wrangler.jsonc")
const WRANGLER = path.join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js")
const BASE_URL = "http://sms-api.test"

/** Test-only secret; never used anywhere else. */
export const TEST_SECRET = "worker-test-secret-0123456789-abcdefghijklmnop"

export type SeededUser = { id: string; email: string; role: "STAFF" | "STUDENT"; studentId: string | null }

export type CallOptions = {
  /** Signed-in user id for the token; null for a service call (login lookup); omit for no token at all. */
  as?: string | null
  body?: unknown
  /** Sends this exact raw body (e.g. invalid JSON). */
  rawBody?: string
  headers?: Record<string, string>
  /** Overrides the signed token entirely. */
  token?: string
}

export type TestWorker = {
  dir: string
  users: Map<string, SeededUser>
  // Response bodies are asserted field by field in the tests; typing every endpoint here adds nothing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: string, pathAndQuery: string, options?: CallOptions) => Promise<{ status: number; data: any; headers: Headers }>
  fetch: (pathAndQuery: string, init?: RequestInit) => Promise<Response>
  /** Stops the Worker but keeps its local D1, e.g. to read it directly with withAdapterDb(). */
  stop: () => Promise<void>
  /** Stops the Worker and deletes its local D1. */
  dispose: () => Promise<void>
}

async function migrate(dir: string) {
  await run(process.execPath, [WRANGLER, "d1", "migrations", "apply", "DB", "--local", "--persist-to", dir], {
    cwd: WORKER_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  })
}

/** Runs `work` against the local D1 through @prisma/adapter-d1 (Node side), then releases the database. */
export async function withAdapterDb<T>(dir: string, work: (db: D1Client) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: CONFIG,
    persist: { path: path.join(dir, "v3") },
    remoteBindings: false,
  })
  const db = new PrismaClient({ adapter: new PrismaD1(proxy.env.DB) })
  try {
    return await work(db)
  } finally {
    await db.$disconnect()
    await proxy.dispose()
  }
}

export async function startTestWorker(
  options: { migrate?: boolean; seed?: boolean; secret?: string | null; prepare?: (db: D1Client) => Promise<void> } = {}
): Promise<TestWorker> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pen-sms-worker-"))
  if (options.migrate !== false) await migrate(dir)

  const users = new Map<string, SeededUser>()
  if (options.seed || options.prepare) {
    await withAdapterDb(dir, async (db) => {
      if (options.seed) await seedD1(db)
      if (options.prepare) await options.prepare(db)
      for (const user of await db.user.findMany({ select: { id: true, email: true, role: true, studentId: true } })) {
        users.set(user.email, user)
      }
    })
  }

  // Always set explicitly (an empty value when testing a missing secret), so a developer's
  // worker/.dev.vars, which wrangler loads automatically, never leaks into the tests.
  const secret = options.secret === undefined ? TEST_SECRET : options.secret
  const worker = await unstable_startWorker({
    config: CONFIG,
    bindings: { WORKER_INTERNAL_SECRET: { type: "plain_text", value: secret ?? "" } },
    dev: { persist: dir, server: { port: 0 }, inspector: false, logLevel: "none" },
  })

  const fetchWorker = async (pathAndQuery: string, init?: RequestInit) =>
    (await worker.fetch(`${BASE_URL}${pathAndQuery}`, init as never)) as unknown as Response

  const call: TestWorker["call"] = async (method, pathAndQuery, callOptions = {}) => {
    const body = callOptions.rawBody ?? (callOptions.body === undefined ? null : JSON.stringify(callOptions.body))
    const headers: Record<string, string> = { ...(body !== null ? { "Content-Type": "application/json" } : {}), ...callOptions.headers }
    if (callOptions.token !== undefined) {
      headers.Authorization = `Bearer ${callOptions.token}`
    } else if (callOptions.as !== undefined) {
      const url = new URL(`${BASE_URL}${pathAndQuery}`)
      const token = await signApiToken(TEST_SECRET, {
        userId: callOptions.as,
        request: { method, pathAndQuery: url.pathname + url.search, body },
      })
      headers.Authorization = `Bearer ${token}`
    }
    const response = await fetchWorker(pathAndQuery, { method, headers, body: body ?? undefined })
    const type = response.headers.get("content-type") ?? ""
    const data = type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer())
    return { status: response.status, data, headers: response.headers }
  }

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await worker.dispose()
  }

  return {
    dir,
    users,
    call,
    fetch: fetchWorker,
    stop,
    dispose: async () => {
      await stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
    },
  }
}

export const YEAR = new Date().getFullYear()
export const sid = (seq: number) => `SMS-${YEAR}-${String(seq).padStart(4, "0")}`
export const ASSESSMENT = {
  DB: "5e3d0a1c-0000-4000-8000-000000000101",
  ALGO: "5e3d0a1c-0000-4000-8000-000000000102",
  STRAT: "5e3d0a1c-0000-4000-8000-000000000103",
  ACC: "5e3d0a1c-0000-4000-8000-000000000104",
} as const
export const STAFF_EMAIL = "registry@pensms.test"
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date())
