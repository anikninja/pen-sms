/**
 * Which data path the app uses, chosen explicitly with DATA_BACKEND:
 * - "worker":   every read and write goes to the Cloudflare Worker (D1 + R2). No database
 *               credentials exist in the Next.js deployment.
 * - "postgres": the original path — Prisma straight to PostgreSQL, files on the local disk.
 *
 * Unset means "postgres" for local development and CI only. On Vercel it must be set, so a
 * deployment can never end up talking to PostgreSQL by accident, and there is no fallback from one
 * backend to the other at runtime.
 */
export type DataBackend = "postgres" | "worker"

export function dataBackend(): DataBackend {
  const value = process.env.DATA_BACKEND
  if (value === "worker" || value === "postgres") return value
  if (value) throw new Error(`DATA_BACKEND must be "worker" or "postgres" (got "${value}").`)
  if (process.env.VERCEL) throw new Error('DATA_BACKEND is not set. On Vercel it must be set explicitly (normally to "worker").')
  return "postgres"
}
