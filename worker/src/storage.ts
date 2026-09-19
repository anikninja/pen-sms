/**
 * Submission files in the private R2 bucket (binding FILES). The bucket has no public access: the
 * only way to read or write an object is through this Worker, with a short-lived signed URL that
 * the Worker itself issued after checking who may use it (API.md, "Files").
 */
import { signFileToken, type DownloadTokenClaims, type UploadTokenClaims } from "@/lib/internal-auth/token"
import { assertObjectKey, type ObjectStore } from "@/lib/storage/object-store"

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, bytes: Uint8Array, metadata: { contentType: string }): Promise<void> {
    assertObjectKey(key)
    await this.bucket.put(key, bytes, { httpMetadata: { contentType: metadata.contentType } })
  }

  async get(key: string): Promise<{ body: ReadableStream; size: number } | null> {
    assertObjectKey(key)
    const object = await this.bucket.get(key)
    return object ? { body: object.body, size: object.size } : null
  }

  async exists(key: string): Promise<boolean> {
    assertObjectKey(key)
    return (await this.bucket.head(key)) !== null
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key)
    await this.bucket.delete(key)
  }
}

type Claims<T> = Omit<T, "typ" | "iat" | "exp" | "jti">

/** A 5-minute URL for the browser to PUT one declared file to this Worker. */
export async function createUploadUrl(origin: string, secret: string, claims: Claims<UploadTokenClaims>, now: Date) {
  const { token, expiresAt } = await signFileToken(secret, { typ: "upload", ...claims }, now)
  return { url: `${origin}/v1/uploads?token=${encodeURIComponent(token)}`, expiresAt }
}

/** A 60-second URL for the browser to download one version of one submission from this Worker. */
export async function createDownloadUrl(origin: string, secret: string, claims: Claims<DownloadTokenClaims>, now: Date) {
  const { token, expiresAt } = await signFileToken(secret, { typ: "download", ...claims }, now)
  return { url: `${origin}/v1/files/download?token=${encodeURIComponent(token)}`, expiresAt }
}
