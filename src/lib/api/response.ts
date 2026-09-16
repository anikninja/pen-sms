import { NextResponse } from "next/server"

import { DomainError, toDomainError, type ErrorCode } from "@/lib/errors"

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
}

export function apiError(error: unknown): NextResponse {
  const domainError = toDomainError(error)
  return NextResponse.json(
    {
      error: domainError.message,
      ...(domainError.fieldErrors ? { fieldErrors: domainError.fieldErrors } : {}),
    },
    { status: STATUS[domainError.code] }
  )
}

/** Wraps a Route Handler: DomainErrors become JSON error responses (architecture.md §17.1). */
export function apiRoute<Ctx>(handler: (request: Request, context: Ctx) => Promise<Response>) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    try {
      return await handler(request, context)
    } catch (error) {
      return apiError(error)
    }
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new DomainError("VALIDATION", "Request body must be valid JSON.")
  }
}

export function searchParamsObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams)
}
