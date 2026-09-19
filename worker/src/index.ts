/**
 * PEN SMS API Worker: the database (D1) boundary of the application. Only the Next.js server calls
 * it, with a signed internal token per request; see API.md for endpoints, access rules and shapes.
 */
import { handle } from "./app"
import type { Env } from "./env"

export default {
  fetch(request, env): Promise<Response> {
    return handle(request, env)
  },
} satisfies ExportedHandler<Env>
