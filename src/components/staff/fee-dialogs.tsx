"use client"

import { useState } from "react"

import { assignStudentFeeAction, createPaymentAction } from "@/actions/payments"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { useInitialValue } from "@/components/shared/use-initial-value"
import { formValues, toFieldErrors, useServerAction } from "@/components/shared/use-server-action"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { FeeSummary, TariffDto } from "@/lib/services/fees"
import { formatCurrency, formatDate, toIsoDate } from "@/lib/utils/format"

// Each dialog's form is its own component: it mounts when the dialog opens (so it starts from the
// latest data) and freezes its defaults, so a refresh after saving can't change them while open.

export function RecordPaymentDialog({
  studentId,
  summary,
  today,
}: {
  studentId: string
  summary: FeeSummary
  today: string
}) {
  const [open, setOpen] = useState(false)

  // The server enforces these too; the disabled button only saves a round trip.
  const blockedReason =
    summary.status === "NO_FEE"
      ? "Assign a fee before recording payments."
      : summary.status === "PAID"
        ? "This student has paid in full."
        : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={!!blockedReason} title={blockedReason ?? undefined} />}>
        Record payment
      </DialogTrigger>
      <DialogContent>
        <RecordPaymentForm studentId={studentId} summary={summary} today={today} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RecordPaymentForm({
  studentId,
  onDone,
  ...props
}: {
  studentId: string
  summary: FeeSummary
  today: string
  onDone: () => void
}) {
  const { summary, today } = useInitialValue(props)
  const { run, pending, fieldErrors } = useServerAction()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = formValues(event.currentTarget)
    run(() => createPaymentAction(studentId, values), {
      success: (payment) => `Payment ${payment.referenceNumber} of ${formatCurrency(payment.amount, summary.currency)} recorded.`,
      onSuccess: onDone,
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Record payment</DialogTitle>
        <DialogDescription>
          Outstanding balance: <strong>{formatCurrency(summary.outstanding, summary.currency)}</strong>
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!fieldErrors.amount}>
          <FieldLabel htmlFor="amount">Amount ({summary.currency})</FieldLabel>
          <Input id="amount" name="amount" inputMode="decimal" placeholder="e.g. 25000" aria-invalid={!!fieldErrors.amount} autoFocus required />
          <FieldError errors={toFieldErrors(fieldErrors.amount)} />
        </Field>
        <Field data-invalid={!!fieldErrors.paymentDate}>
          <FieldLabel htmlFor="paymentDate">Payment date</FieldLabel>
          <Input id="paymentDate" name="paymentDate" type="date" max={today} defaultValue={today} aria-invalid={!!fieldErrors.paymentDate} required />
          <FieldError errors={toFieldErrors(fieldErrors.paymentDate)} />
        </Field>
        <Field data-invalid={!!fieldErrors.referenceNumber}>
          <FieldLabel htmlFor="referenceNumber">Reference number</FieldLabel>
          <Input id="referenceNumber" name="referenceNumber" placeholder="e.g. BANK-2026-0412" aria-invalid={!!fieldErrors.referenceNumber} required />
          <FieldDescription>Must be unique. Letters, numbers, and - _ / only.</FieldDescription>
          <FieldError errors={toFieldErrors(fieldErrors.referenceNumber)} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record payment"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function AssignFeeDialog({
  studentId,
  summary,
  tariff,
}: {
  studentId: string
  summary: FeeSummary
  tariff: TariffDto | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        {summary.hasFeeAssigned ? "Adjust fee" : "Assign fee"}
      </DialogTrigger>
      <DialogContent>
        <AssignFeeForm studentId={studentId} summary={summary} tariff={tariff} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AssignFeeForm({
  studentId,
  onDone,
  ...props
}: {
  studentId: string
  summary: FeeSummary
  tariff: TariffDto | null
  onDone: () => void
}) {
  const { summary, tariff } = useInitialValue(props)
  const [source, setSource] = useState<"TARIFF" | "MANUAL">(tariff ? "TARIFF" : "MANUAL")
  const { run, pending, fieldErrors } = useServerAction()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = formValues(event.currentTarget)
    const input = source === "TARIFF" ? { source } : { ...values, source }
    run(() => assignStudentFeeAction(studentId, input), {
      success: (next) => `Fee set to ${formatCurrency(next.totalFee, next.currency)}.`,
      onSuccess: onDone,
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{summary.hasFeeAssigned ? "Adjust fee" : "Assign fee"}</DialogTitle>
        <DialogDescription>
          Already paid: <strong>{formatCurrency(summary.totalPaid, summary.currency)}</strong>. The fee cannot be set below this.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="source">Source</FieldLabel>
          <NativeSelect id="source" value={source} onChange={(event) => setSource(event.target.value as "TARIFF" | "MANUAL")} className="w-full">
            <NativeSelectOption value="TARIFF" disabled={!tariff}>
              Programme tariff{tariff ? ` — ${formatCurrency(tariff.amount, tariff.currency)}, due ${formatDate(tariff.dueDate)}` : " (none for this programme and year)"}
            </NativeSelectOption>
            <NativeSelectOption value="MANUAL">Manual amount (scholarship, agreed arrangement)</NativeSelectOption>
          </NativeSelect>
        </Field>

        {source === "MANUAL" && (
          <>
            <div className="grid gap-6 sm:grid-cols-[1fr_7rem]">
              <Field data-invalid={!!fieldErrors.amount}>
                <FieldLabel htmlFor="fee-amount">Amount</FieldLabel>
                <Input
                  id="fee-amount"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={summary.hasFeeAssigned ? summary.totalFee : tariff?.amount}
                  aria-invalid={!!fieldErrors.amount}
                  required
                />
                <FieldError errors={toFieldErrors(fieldErrors.amount)} />
              </Field>
              <Field data-invalid={!!fieldErrors.currency}>
                <FieldLabel htmlFor="fee-currency">Currency</FieldLabel>
                <Input id="fee-currency" name="currency" maxLength={3} defaultValue={summary.currency} aria-invalid={!!fieldErrors.currency} />
                <FieldError errors={toFieldErrors(fieldErrors.currency)} />
              </Field>
            </div>
            <Field data-invalid={!!fieldErrors.dueDate}>
              <FieldLabel htmlFor="fee-dueDate">Due date</FieldLabel>
              <Input
                id="fee-dueDate"
                name="dueDate"
                type="date"
                defaultValue={summary.dueDate ? toIsoDate(new Date(summary.dueDate)) : tariff ? toIsoDate(new Date(tariff.dueDate)) : undefined}
                aria-invalid={!!fieldErrors.dueDate}
                required
              />
              <FieldError errors={toFieldErrors(fieldErrors.dueDate)} />
            </Field>
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save fee"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ReassignTariffButton({ studentId, tariff }: { studentId: string; tariff: TariffDto }) {
  return (
    <ConfirmAction
      label="Reassign from tariff"
      title="Reassign fee from the programme tariff?"
      description={
        <>
          The assigned fee will become {formatCurrency(tariff.amount, tariff.currency)}, due {formatDate(tariff.dueDate)}.
          Payments already recorded are kept.
        </>
      }
      confirmLabel="Reassign fee"
      action={() => assignStudentFeeAction(studentId, { source: "TARIFF" })}
      success="Fee reassigned from the programme tariff."
    />
  )
}
