"use client"

import { useActionState } from "react"

import { loginAction, type LoginState } from "@/actions/auth"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const toErrors = (messages?: string[]) => messages?.map((message) => ({ message }))

export function LoginForm({ className }: { className?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {})

  return (
    <form action={formAction} className={cn("flex flex-col gap-6", className)} noValidate>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Sign in to PEN SMS</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Registry staff and students use the same sign-in.
          </p>
        </div>

        {state.error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <Field data-invalid={!!state.fieldErrors?.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            // React resets the form after the action; keying on the submitted email remounts the field
            // with it, instead of changing defaultValue on a mounted (uncontrolled) Base UI input.
            key={state.email ?? ""}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.email}
            aria-invalid={!!state.fieldErrors?.email}
            required
          />
          <FieldError errors={toErrors(state.fieldErrors?.email)} />
        </Field>

        <Field data-invalid={!!state.fieldErrors?.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!state.fieldErrors?.password}
            required
          />
          <FieldError errors={toErrors(state.fieldErrors?.password)} />
        </Field>

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
