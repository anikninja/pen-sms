/** Staff reads that are not tied to one student: programmes and the fee overview. */
import { z } from "zod"

import { listFeeOverview } from "@/lib/services/d1/fees"
import { listProgrammes } from "@/lib/services/d1/programmes"

import { json } from "../http"
import type { RouteContext } from "../router"
import { queryOf } from "./common"

const programmeListSchema = z.object({ activeOnly: z.enum(["true", "false"]).optional() })

/** GET /v1/programmes?activeOnly=true */
export async function programmes(context: RouteContext) {
  const { activeOnly } = queryOf(context, programmeListSchema)
  return json({ programmes: await listProgrammes(context.db, { activeOnly: activeOnly === "true" }) })
}

const feeOverviewSchema = z.object({ status: z.enum(["NO_FEE", "PAID", "OUTSTANDING", "OVERDUE"]).optional() })

/** GET /v1/fees?status= — every student's fee position (the Fees page and dashboard totals). */
export async function feeOverview(context: RouteContext) {
  const filter = queryOf(context, feeOverviewSchema)
  return json({ rows: await listFeeOverview(context.db, filter, context.now) })
}
