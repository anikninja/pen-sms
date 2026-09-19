import { apiRoute } from "@/lib/api/response"
import { authorizeAny } from "@/lib/auth/guards"
import { data } from "@/lib/data"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ submissionId: string }> }

// GET /api/files/[submissionId] — staff, or the student who owns the submission.
// PostgreSQL backend: the file itself. Worker backend: a redirect to a 60-second download URL on the
// Worker, which streams the file from the private R2 bucket (files never pass through Vercel).
export const GET = apiRoute(async (_request, { params }: Context) => {
  const session = await authorizeAny()
  const submissionId = parseId((await params).submissionId, "File")
  const file = await (await data()).getSubmissionDownload(submissionId, session)

  if (file.kind === "redirect") {
    return new Response(null, {
      status: 302,
      headers: { Location: file.url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    })
  }

  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new Response(file.content as BodyInit, {
    headers: {
      "Content-Type": file.fileType,
      "Content-Length": String(file.content.byteLength),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
