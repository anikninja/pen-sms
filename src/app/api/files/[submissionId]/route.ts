import { apiRoute } from "@/lib/api/response"
import { authorizeAny } from "@/lib/auth/guards"
import { getSubmissionFile } from "@/lib/services/submissions"
import { parseId } from "@/lib/validations/ids"

type Context = { params: Promise<{ submissionId: string }> }

// GET /api/files/[submissionId] — staff, or the student who owns the submission
export const GET = apiRoute(async (_request, { params }: Context) => {
  const session = await authorizeAny()
  const submissionId = parseId((await params).submissionId, "File")
  const file = await getSubmissionFile(submissionId, session)

  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.fileType,
      "Content-Length": String(file.content.byteLength),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
