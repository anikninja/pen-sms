import { REGISTRY_TIME_ZONE } from "@/lib/domain/dates"

const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "150000.00", "BDT" → "150,000.00 BDT". Display only — never use for arithmetic. */
export function formatCurrency(value: string | { toString(): string }, currency: string): string {
  return `${moneyFormatter.format(Number(value.toString()))} ${currency}`
}

/** Calendar date stored as UTC midnight → "2026-09-16". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
})

/** "2026-09-16" or a UTC-midnight Date → "16 Sep 2026". */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value
  return dateFormatter.format(date)
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: REGISTRY_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** A moment in time shown in the Registry time zone → "30 Sep 2026, 23:59". */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value)
}
