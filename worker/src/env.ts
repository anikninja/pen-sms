/** Bindings and settings of the Worker (wrangler.jsonc). Secrets never appear in wrangler.jsonc. */
export interface Env {
  /** The SMS D1 database. */
  DB: D1Database
  /** HMAC secret shared with the Next.js server (≥ 32 characters). `wrangler secret put WORKER_INTERNAL_SECRET`. */
  WORKER_INTERNAL_SECRET?: string
  /** Optional: the previous secret, still accepted while the secret is being rotated. */
  WORKER_INTERNAL_SECRET_PREVIOUS?: string
  /** Browser origins allowed to call the Worker directly (file transfers), comma-separated. */
  ALLOWED_ORIGINS?: string
}
