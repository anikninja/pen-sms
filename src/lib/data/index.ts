/**
 * The app's single data boundary. Pages, Server Actions, API routes and auth call `data()` and get
 * the implementation selected by DATA_BACKEND (src/lib/data/backend.ts):
 *   worker   → src/lib/data/worker.ts   (Cloudflare Worker → D1 + R2; no database credentials here)
 *   postgres → src/lib/data/postgres.ts (Prisma → PostgreSQL; files on the local disk)
 * The implementation is imported lazily, so the Worker deployment never loads a PostgreSQL client.
 */
import { dataBackend } from "@/lib/data/backend"
import type { DataApi } from "@/lib/data/types"

export type * from "@/lib/data/types"
export { dataBackend } from "@/lib/data/backend"

export async function data(): Promise<DataApi> {
  if (dataBackend() === "worker") return (await import("@/lib/data/worker")).workerData
  return (await import("@/lib/data/postgres")).postgresData
}
