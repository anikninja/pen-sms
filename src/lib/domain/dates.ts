/**
 * Calendar dates (date of birth, payment date) are compared as YYYY-MM-DD strings in the
 * Registry's time zone, so "today" means today in Dhaka, not today in UTC.
 */
export const REGISTRY_TIME_ZONE = "Asia/Dhaka"

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REGISTRY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Today's date in the Registry time zone, as YYYY-MM-DD. */
export function registryToday(now: Date): string {
  return dateFormatter.format(now)
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** Stored as midnight UTC of that calendar date. */
export function isoDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/** Completed years between two YYYY-MM-DD dates. */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  const hadBirthday = tm > bm || (tm === bm && td >= bd)
  return ty - by - (hadBirthday ? 0 : 1)
}
