import { REGISTRY_TIME_ZONE, REGISTRY_UTC_OFFSET } from "@/lib/domain/dates"

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REGISTRY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** A moment → the value for <input type="datetime-local">, in Dhaka time ("2026-09-30T23:59"). */
export function toRegistryDateTimeLocal(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/**
 * A datetime-local value, read as Dhaka time → ISO 8601 with offset ("2026-09-30T23:59:00+06:00").
 * Returns null for anything that isn't a complete YYYY-MM-DDTHH:mm value.
 */
export function registryDateTimeLocalToIso(value: string): string | null {
  const match = LOCAL_PATTERN.exec(value.trim())
  if (!match) return null
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${REGISTRY_UTC_OFFSET}`
  // Rejects impossible dates such as 2026-02-30 by round-tripping.
  return toRegistryDateTimeLocal(iso) === value.trim() ? iso : null
}
