"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import type { ActionResult, FieldErrors } from "@/lib/errors"

/**
 * Runs a Server Action from a client component: pending state, field errors for the form,
 * a toast on success and on failure (architecture.md §31, §34).
 */
export function useServerAction() {
  const [pending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    options: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {}
  ) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        setFieldErrors({})
        const message = typeof options.success === "function" ? options.success(result.data) : options.success
        if (message) toast.success(message)
        options.onSuccess?.(result.data)
      } else {
        setFieldErrors(result.fieldErrors ?? {})
        setError(result.error)
        toast.error(result.error)
      }
    })
  }

  function reset() {
    setFieldErrors({})
    setError(null)
  }

  return { run, pending, fieldErrors, error, reset }
}

/** Form fields as plain strings; the server validates and converts them. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {}
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") values[key] = value
  })
  return values
}

/** Adapts server messages to the shadcn <FieldError errors> shape. */
export const toFieldErrors = (messages?: string[]) => messages?.map((message) => ({ message }))
