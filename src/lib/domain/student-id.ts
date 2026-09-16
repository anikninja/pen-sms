const PREFIX = "SMS"

/** SMS-2026-0001. The sequence is padded to 4 digits and grows past 9999 if needed. */
export function formatStudentId(year: number, sequence: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError("Year and sequence must be positive integers.")
  }
  return `${PREFIX}-${year}-${String(sequence).padStart(4, "0")}`
}

/** Returns the sequence number, or NaN when the value is not a Student ID. */
export function parseStudentIdSequence(studentId: string): number {
  const match = /^SMS-\d{4}-(\d{4,})$/.exec(studentId)
  return match ? Number(match[1]) : Number.NaN
}

export function studentIdPrefix(year: number): string {
  return `${PREFIX}-${year}-`
}
