/** Bindings and settings of the Worker (wrangler.jsonc). Secrets never appear in wrangler.jsonc. */
export interface Env {
  /** The SMS D1 database. */
  DB: D1Database
  /** The private R2 bucket with submission files. No public access; see storage.ts. */
  FILES: R2Bucket
  /** HMAC secret shared with the Next.js server (≥ 32 characters). `wrangler secret put WORKER_INTERNAL_SECRET`. */
  WORKER_INTERNAL_SECRET?: string
  /** Optional: the previous secret, still accepted while the secret is being rotated. */
  WORKER_INTERNAL_SECRET_PREVIOUS?: string
  /** Browser origins allowed to upload files to the Worker directly (CORS), comma-separated. */
  ALLOWED_ORIGINS?: string
}
