import { PrismaD1 } from "@prisma/adapter-d1"
// Resolves to the Workers build of the D1 client (wasm.js + query_engine_bg.wasm) through the
// "workerd" export condition that wrangler bundles with; the Node.js engine is never used here.
import { PrismaClient } from ".prisma/client-d1"

import type { D1Client } from "@/lib/services/d1/client"

import type { Env } from "./env"

/**
 * A Prisma client for one request, over the request's D1 binding. Created per request and never
 * stored in module scope: an isolate serves many requests, and the binding belongs to this one.
 * The type has no $transaction, which the D1 adapter would not make atomic (src/lib/services/d1/client.ts).
 */
export function createDb(env: Env): D1Client {
  return new PrismaClient({ adapter: new PrismaD1(env.DB) })
}
