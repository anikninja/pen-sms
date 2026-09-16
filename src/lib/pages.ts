import { notFound } from "next/navigation"

import { DomainError } from "@/lib/errors"
import { idSchema } from "@/lib/validations/common"

/** Route params are user input: a malformed id renders the 404 page instead of reaching Prisma. */
export function idOr404(value: string): string {
  if (!idSchema.safeParse(value).success) notFound()
  return value
}

/** Turns a service NOT_FOUND into the 404 page; any other error still propagates. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound()
    throw error
  }
}
