/**
 * Submission files through the real Worker: private R2 (local), Worker-signed upload and download
 * URLs, authorization, validation, replacement cleanup, concurrency and CORS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { signFileToken } from "@/lib/internal-auth/token"
import { submissionObjectKey } from "@/lib/storage/object-store"

import { ASSESSMENT, listObjects, STAFF_EMAIL, startTestWorker, TEST_SECRET, withLocalBindings, type TestWorker } from "./harness"

const PDF = "application/pdf"
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const ALLOWED_ORIGIN = "http://localhost:3000" // ALLOWED_ORIGINS in wrangler.jsonc
const NUSRAT_DB_SUBMISSION = "5e3d0a1c-0000-4000-8000-000000000201"
const SADIA_ACC_SUBMISSION = "5e3d0a1c-0000-4000-8000-000000000206" // its object is removed below

let w: TestWorker
const user = (email: string) => w.users.get(email)!.id
const staff = () => user(STAFF_EMAIL)
const rahim = () => user("rahim.uddin@student.pensms.test")
const abir = () => user("abir.hossain@student.pensms.test")
const nusrat = () => user("nusrat.jahan@student.pensms.test")
const tanvir = () => user("tanvir.ahmed@student.pensms.test")
const farhana = () => user("farhana.akter@student.pensms.test")
const sadia = () => user("sadia.islam@student.pensms.test")

beforeAll(async () => {
  w = await startTestWorker({
    seed: true,
    prepare: async (_db, files) => {
      await files.delete(submissionObjectKey(SADIA_ACC_SUBMISSION, ".pdf", new Date(0), "seed"))
    },
  })
})
afterAll(async () => {
  await w?.dispose()
})

const bytes = (text: string) => new TextEncoder().encode(text)
/** Path + query of a URL the Worker returned (the test Worker is reached through w.fetch). */
const local = (url: string) => {
  const parsed = new URL(url)
  expect(parsed.origin).toBe("http://sms-api.test")
  return parsed.pathname + parsed.search
}

async function requestUpload(as: string, assessmentId: string, file: { name: string; type: string; size: number }) {
  return w.call("POST", `/v1/assessments/${assessmentId}/submissions/upload-url`, {
    as,
    body: { fileName: file.name, fileType: file.type, fileSize: file.size },
  })
}

type UploadResponse = {
  submission: { id: string; fileName: string; fileType: string; fileSize: number; isLate: boolean; replaced: boolean }
  error?: string
  fieldErrors?: Record<string, string[]>
}

async function put(url: string, body: Uint8Array, type: string, origin?: string) {
  const response = await w.fetch(local(url), {
    method: "PUT",
    headers: { "Content-Type": type, ...(origin ? { Origin: origin } : {}) },
    body,
  })
  return { status: response.status, data: (await response.json()) as UploadResponse, headers: response.headers }
}

async function upload(as: string, assessmentId: string, name: string, type: string, content: Uint8Array) {
  const granted = await requestUpload(as, assessmentId, { name, type, size: content.byteLength })
  expect(granted.status).toBe(200)
  return put(granted.data.upload.url, content, type)
}

async function download(as: string, submissionId: string) {
  const granted = await w.call("POST", `/v1/files/${submissionId}/download-url`, { as })
  if (granted.status !== 200) return { granted, file: null }
  const response = await w.fetch(local(granted.data.download.url))
  return { granted, file: { status: response.status, headers: response.headers, body: new Uint8Array(await response.arrayBuffer()) } }
}

describe("upload URL: every submission rule is checked before a URL is issued", () => {
  const pdf = { name: "work.pdf", type: PDF, size: 100 }

  it("is for students only", async () => {
    expect((await requestUpload(staff(), ASSESSMENT.ALGO, pdf)).status).toBe(403)
    expect((await w.call("POST", `/v1/assessments/${ASSESSMENT.ALGO}/submissions/upload-url`, { body: pdf })).status).toBe(401)
  })

  it("applies the assessment, enrolment and deadline rules with the Next.js messages", async () => {
    expect(await requestUpload(farhana(), ASSESSMENT.ALGO, pdf)).toMatchObject({ status: 404, data: { error: "Assessment not found." } })
    expect(await requestUpload(tanvir(), ASSESSMENT.ALGO, pdf)).toMatchObject({ status: 403, data: { error: "Only enrolled students can submit." } })
    expect(await requestUpload(farhana(), ASSESSMENT.ACC, pdf)).toMatchObject({ status: 409, data: { error: "This assessment is closed for submissions." } })
    expect(await requestUpload(rahim(), ASSESSMENT.DB, pdf)).toMatchObject({
      status: 409,
      data: { error: "The deadline has passed. Your existing submission can no longer be replaced." },
    })
  })

  it("checks the declared file type and size", async () => {
    const txt = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "notes.txt", type: "text/plain", size: 10 })
    expect(txt).toMatchObject({ status: 400, data: { error: "Only PDF and DOCX files are accepted.", fieldErrors: { file: ["Only PDF and DOCX files are accepted."] } } })
    const renamed = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "fake.pdf", type: "text/plain", size: 10 })
    expect(renamed.status).toBe(400)
    const big = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "big.pdf", type: PDF, size: 5 * 1024 * 1024 + 1 })
    expect(big).toMatchObject({ status: 400, data: { error: "File must be smaller than 5 MB." } })
  })

  it("returns a short-lived PUT URL on the Worker for exactly that file", async () => {
    const { status, data } = await requestUpload(rahim(), ASSESSMENT.ALGO, pdf)
    expect(status).toBe(200)
    expect(data.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": PDF }, maxBytes: 5 * 1024 * 1024 })
    expect(local(data.upload.url)).toMatch(/^\/v1\/uploads\?token=v1\./)
    const lifetime = new Date(data.upload.expiresAt).getTime() - Date.now()
    expect(lifetime).toBeGreaterThan(4 * 60_000)
    expect(lifetime).toBeLessThanOrEqual(5 * 60_000)
  })
})

describe("uploading", () => {
  let algoSubmission: string

  it("stores a first submission on time, with the path stripped from the file name", async () => {
    const r = await upload(rahim(), ASSESSMENT.ALGO, "../../evil/Algo Draft.pdf", PDF, bytes("%PDF-1.4 worker"))
    expect(r.status).toBe(201)
    expect(r.data.submission).toMatchObject({ fileName: "Algo Draft.pdf", fileType: PDF, fileSize: 15, isLate: false, replaced: false })
    algoSubmission = r.data.submission.id
  })

  it("replaces it before the deadline: same submission, new file, old object deleted", async () => {
    const r = await upload(rahim(), ASSESSMENT.ALGO, "Algo Final.docx", DOCX, bytes("PK docx"))
    expect(r.status).toBe(200)
    expect(r.data.submission).toMatchObject({ id: algoSubmission, fileName: "Algo Final.docx", fileType: DOCX, replaced: true })

    const { file } = await download(rahim(), algoSubmission)
    expect(new TextDecoder().decode(file!.body)).toBe("PK docx")
    expect(file!.headers.get("content-disposition")).toContain("Algo%20Final.docx")
  })

  it("marks a first submission after the deadline as late", async () => {
    const r = await upload(abir(), ASSESSMENT.DB, "late.pdf", PDF, bytes("%PDF late"))
    expect(r.status).toBe(201)
    expect(r.data.submission.isLate).toBe(true)
  })

  it("rejects a body that is not the declared file", async () => {
    const granted = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "a.pdf", type: PDF, size: 10 })
    const url = granted.data.upload.url
    const mismatch = "The uploaded file is not the file that was checked. Please try again."
    expect(await put(url, bytes("12345678901"), PDF)).toMatchObject({ status: 400, data: { error: mismatch } })
    expect(await put(url, bytes("1234567890"), DOCX)).toMatchObject({ status: 400, data: { error: mismatch } })
  })

  it("refuses files over 5 MB before reading them", async () => {
    const granted = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "a.pdf", type: PDF, size: 10 })
    const r = await put(granted.data.upload.url, new Uint8Array(5 * 1024 * 1024 + 1), PDF)
    expect(r).toMatchObject({ status: 400, data: { error: "File must be smaller than 5 MB." } })
  })

  it("refuses missing, forged, expired and wrong-kind tokens", async () => {
    const invalid = "This upload link is invalid or has expired. Please try again."
    expect(await put("http://sms-api.test/v1/uploads", bytes("x"), PDF)).toMatchObject({ status: 401, data: { error: invalid } })
    expect((await put("http://sms-api.test/v1/uploads?token=v1.abc.def", bytes("x"), PDF)).status).toBe(401)

    const claims = { sub: nusrat(), sid: w.users.get("nusrat.jahan@student.pensms.test")!.studentId!, aid: ASSESSMENT.ALGO, name: "a.pdf", type: PDF, size: 1 }
    const expired = await signFileToken(TEST_SECRET, { typ: "upload", ...claims }, new Date(Date.now() - 10 * 60_000))
    expect((await put(`http://sms-api.test/v1/uploads?token=${expired.token}`, bytes("x"), PDF)).status).toBe(401)
    const forged = await signFileToken("another-secret-of-sufficient-length-123456", { typ: "upload", ...claims })
    expect((await put(`http://sms-api.test/v1/uploads?token=${forged.token}`, bytes("x"), PDF)).status).toBe(401)
    const wrongKind = await signFileToken(TEST_SECRET, { typ: "download", sub: nusrat(), fid: NUSRAT_DB_SUBMISSION, key: "k" })
    expect((await put(`http://sms-api.test/v1/uploads?token=${wrongKind.token}`, bytes("x"), PDF)).status).toBe(401)
  })

  it("keeps exactly one row and one object when uploads race", async () => {
    const content = (n: number) => bytes(`%PDF-1.4 race ${n}`)
    const grants = await Promise.all([1, 2, 3].map((n) => requestUpload(abir(), ASSESSMENT.ALGO, { name: `race${n}.pdf`, type: PDF, size: content(n).byteLength })))
    const results = await Promise.all(grants.map((grant, n) => put(grant.data.upload.url, content(n + 1), PDF)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201])
    expect(new Set(results.map((r) => r.data.submission.id)).size).toBe(1)
  })
})

describe("downloading", () => {
  it("lets a student download their own file and staff download any file", async () => {
    const own = await download(nusrat(), NUSRAT_DB_SUBMISSION)
    expect(own.file!.status).toBe(200)
    expect(new TextDecoder().decode(own.file!.body.subarray(0, 8))).toBe("%PDF-1.4")
    expect(own.file!.headers.get("content-type")).toBe(PDF)
    expect(own.file!.headers.get("content-disposition")).toMatch(/^attachment; filename="Nusrat_Jahan_DB\.pdf"; filename\*=UTF-8''/)
    expect(own.file!.headers.get("cache-control")).toBe("private, no-store")
    expect(own.file!.headers.get("x-content-type-options")).toBe("nosniff")
    expect(own.file!.headers.get("referrer-policy")).toBe("no-referrer")

    const staffCopy = await download(staff(), NUSRAT_DB_SUBMISSION)
    expect(staffCopy.file!.status).toBe(200)
  })

  it("hides other students' files and unknown ids as not found", async () => {
    expect((await download(rahim(), NUSRAT_DB_SUBMISSION)).granted).toMatchObject({ status: 404, data: { error: "File not found." } })
    expect((await download(staff(), crypto.randomUUID())).granted.status).toBe(404)
    expect((await w.call("POST", "/v1/files/..%2F..%2F.env/download-url", { as: staff() })).status).toBe(404)
    expect((await w.call("POST", `/v1/files/${NUSRAT_DB_SUBMISSION}/download-url`)).status).toBe(401)
  })

  it("expires download links and refuses tampered ones", async () => {
    const key = submissionObjectKey(NUSRAT_DB_SUBMISSION, ".pdf", new Date(0), "seed")
    const expired = await signFileToken(TEST_SECRET, { typ: "download", sub: nusrat(), fid: NUSRAT_DB_SUBMISSION, key }, new Date(Date.now() - 5 * 60_000))
    expect((await w.fetch(`/v1/files/download?token=${expired.token}`)).status).toBe(401)
    expect((await w.fetch("/v1/files/download")).status).toBe(401)
    const upload = await signFileToken(TEST_SECRET, { typ: "upload", sub: nusrat(), sid: "s", aid: "a", name: "a.pdf", type: PDF, size: 1 })
    expect((await w.fetch(`/v1/files/download?token=${upload.token}`)).status).toBe(401)
  })

  it("reports a replaced version or a missing object as no longer available", async () => {
    const r = await upload(nusrat(), ASSESSMENT.ALGO, "v1.pdf", PDF, bytes("%PDF v1"))
    const submissionId = r.data.submission.id
    const old = await w.call("POST", `/v1/files/${submissionId}/download-url`, { as: nusrat() })
    await upload(nusrat(), ASSESSMENT.ALGO, "v2.pdf", PDF, bytes("%PDF v2"))
    const stale = await w.fetch(local(old.data.download.url))
    expect(stale.status).toBe(404)
    expect(await stale.json()).toMatchObject({ error: "The file is no longer available." })

    const missing = await download(sadia(), SADIA_ACC_SUBMISSION)
    expect(missing.file!.status).toBe(404)
  })
})

describe("the bucket stays private", () => {
  it("has no way in without a Worker-signed URL", async () => {
    const key = submissionObjectKey(NUSRAT_DB_SUBMISSION, ".pdf", new Date(0), "seed")
    for (const path of [`/${key}`, "/submissions", `/v1/files/${NUSRAT_DB_SUBMISSION}`, "/v1/files"]) {
      expect((await w.fetch(path)).status).toBe(404)
    }
  })
})

describe("CORS for direct browser uploads", () => {
  const preflight = (origin: string, path = "/v1/uploads") =>
    w.fetch(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } })

  it("allows only the configured app origin", async () => {
    const ok = await preflight(ALLOWED_ORIGIN)
    expect(ok.status).toBe(204)
    expect(ok.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN)
    expect(ok.headers.get("access-control-allow-methods")).toBe("PUT")

    const evil = await preflight("https://evil.test")
    expect(evil.status).toBe(403)
    expect(evil.headers.get("access-control-allow-origin")).toBeNull()
    expect((await preflight(ALLOWED_ORIGIN, "/v1/students")).status).toBe(403) // API routes are never CORS-enabled
  })

  it("labels upload responses for the allowed origin only", async () => {
    const granted = await requestUpload(nusrat(), ASSESSMENT.ALGO, { name: "c.pdf", type: PDF, size: 4 })
    const r = await put(granted.data.upload.url, bytes("%PDF"), PDF, ALLOWED_ORIGIN)
    expect(r.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN)
    const err = await put("http://sms-api.test/v1/uploads", bytes("x"), PDF, "https://evil.test")
    expect(err.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("storage consistency", () => {
  it("leaves exactly one object per submission, and it is the one the database points at", async () => {
    await w.stop()
    await withLocalBindings(w.dir, async ({ db, files }) => {
      const rows = await db.submission.findMany({ select: { id: true, fileUrl: true } })
      const keys = await listObjects(files)
      const expected = rows.filter((row) => row.id !== SADIA_ACC_SUBMISSION).map((row) => row.fileUrl).sort()
      expect(keys).toEqual(expected)
    })
  })
})
