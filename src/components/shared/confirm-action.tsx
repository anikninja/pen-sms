"use client"

import { useState } from "react"
import type { VariantProps } from "class-variance-authority"

import { useServerAction } from "@/components/shared/use-server-action"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import type { ActionResult } from "@/lib/errors"

/** A button that asks for confirmation, then runs a Server Action (architecture.md §34). */
export function ConfirmAction<T>({
  label,
  title,
  description,
  confirmLabel,
  action,
  success,
  variant = "outline",
  size = "sm",
  confirmVariant = "default",
  disabled,
}: {
  label: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  action: () => Promise<ActionResult<T>>
  success: string | ((data: T) => string)
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
  confirmVariant?: VariantProps<typeof buttonVariants>["variant"]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { run, pending } = useServerAction()

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} size={size} disabled={disabled || pending} />}>
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={confirmVariant}
            disabled={pending}
            onClick={() => run(action, { success, onSuccess: () => setOpen(false) })}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
