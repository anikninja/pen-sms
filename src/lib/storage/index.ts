import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * All file-system access for uploaded documents goes through this module (architecture.md §32).
 * To move to S3 / Vercel Blob, implement FileStorage and change `storage` below.
 */
export interface FileStorage {
  save(file: Blob, key: string): Promise<{ url: string; size: number }>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

// `${submissionId}-${timestamp}.pdf|.docx` — keys never come from the client.
const KEY_PATTERN = /^[0-9a-f-]{36}-\d+\.(pdf|docx)$/

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`)
}

export class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertValidKey(key)
    return path.join(this.root, key)
  }

  async save(file: Blob, key: string) {
    const filePath = this.pathFor(key)
    const bytes = Buffer.from(await file.arrayBuffer())
    await mkdir(this.root, { recursive: true })
    // "wx" never overwrites: every upload gets a new key.
    await writeFile(filePath, bytes, { flag: "wx" })
    return { url: key, size: bytes.byteLength }
  }

  async read(key: string) {
    return readFile(this.pathFor(key))
  }

  async delete(key: string) {
    try {
      await unlink(this.pathFor(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

export const UPLOADS_DIR = path.join(process.cwd(), "storage", "uploads")

export const storage: FileStorage = new LocalFileStorage(UPLOADS_DIR)

export function storageKey(submissionId: string, extension: ".pdf" | ".docx", at: Date): string {
  return `${submissionId}-${at.getTime()}${extension}`
}
