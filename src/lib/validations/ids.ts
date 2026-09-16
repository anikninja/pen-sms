import { DomainError } from "@/lib/errors"
import { idSchema } from "@/lib/validations/common"

/** Route params and action arguments are client-controlled. A malformed id is simply "not found". */
export function parseId(value: unknown, what: string): string {
  const parsed = idSchema.safeParse(value)
  if (!parsed.success) throw new DomainError("NOT_FOUND", `${what} not found.`)
  return parsed.data
}
