/**
 * Object storage for submission files, as the D1 services see it (the Worker implements it with the
 * private R2 bucket in worker/src/storage.ts). Framework-free: no Node.js or Workers APIs here.
 *
 * Object keys are made from ids, never from the user's file name:
 *   submissions/<submissionId>/<epochMs>-<nonce>.<pdf|docx>
 * The submission id groups every version of one submission; the time and a random nonce make each
 * upload's key unique, so a new version never overwrites the previous one before the database
 * points at it. The original file name, type and size live in the Submission row.
 */
import type { AcceptedExtension } from "@/lib/domain/submissions"

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, metadata: { contentType: string }): Promise<void>
  /** The object's body and size, or null when it does not exist. */
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>
  exists(key: string): Promise<boolean>
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>
}

const KEY = /^submissions\/[0-9a-f-]{36}\/\d{1,15}-[a-z0-9]{1,16}\.(pdf|docx)$/
// Keys of the local-disk storage (src/lib/storage/index.ts), accepted so that files copied from it
// keep working: `<submissionId>-<epochMs>.<pdf|docx>`.
const LEGACY_KEY = /^[0-9a-f-]{36}-\d+\.(pdf|docx)$/

export function isObjectKey(key: string): boolean {
  return KEY.test(key) || LEGACY_KEY.test(key)
}

export function assertObjectKey(key: string): void {
  if (!isObjectKey(key)) throw new Error("Invalid storage key.")
}

function randomNonce(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
}

export function submissionObjectKey(
  submissionId: string,
  extension: AcceptedExtension,
  at: Date,
  nonce: string = randomNonce()
): string {
  const key = `submissions/${submissionId}/${at.getTime()}-${nonce}${extension}`
  assertObjectKey(key)
  return key
}
