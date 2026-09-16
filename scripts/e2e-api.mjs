// End-to-end checks for the JSON API (architecture.md §17.1, §25.1).
// Needs a freshly seeded database and a running app:
//   npx prisma migrate reset --force && npm run build && npx next start -p 3100
//   npm run test:e2e
// It changes data, so reset the database afterwards.
import fs from "node:fs"
import path from "node:path"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const UPLOADS = path.join(process.cwd(), "storage", "uploads")
const YEAR = new Date().getFullYear()
const PASSWORD = "Password123!"

let passed = 0
const failures = []
function check(name, condition, detail) {
  if (condition) passed++
  else failures.push(`${name}${detail === undefined ? "" : ` → ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`)
}

async function login(email, password = PASSWORD) {
  const jar = new Map()
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  store(csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password }),
  })
  store(res)
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${email}`)
  return cookie()
}

async function api(cookie, method, path, body, extraHeaders = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...extraHeaders }
  let payload = body
  if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
    headers["content-type"] = "application/json"
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const type = res.headers.get("content-type") ?? ""
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data, headers: res.headers }
}

const pdfFile = (name = "work.pdf", text = "%PDF-1.4 e2e") => new File([text], name, { type: "application/pdf" })
const docxFile = (name = "work.docx") =>
  new File(["PK docx"], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
const upload = (file) => {
  const form = new FormData()
  form.append("file", file)
  return form
}
const uploadsCount = () => fs.readdirSync(UPLOADS).filter((f) => f !== ".gitkeep").length

// ─── Sessions ────────────────────────────────────────────────────────────────
const staff = await login("registry@pensms.test")
const rahim = await login("rahim.uddin@student.pensms.test") // SMS-Y-0002, BSC-CS, overdue, late DB submission
const nusrat = await login("nusrat.jahan@student.pensms.test") // SMS-Y-0001, fully paid
const abir = await login("abir.hossain@student.pensms.test") // SMS-Y-0003, no payments, no DB submission
const tanvir = await login("tanvir.ahmed@student.pensms.test") // DEFERRED
const farhana = await login("farhana.akter@student.pensms.test") // MBA
const sadia = await login("sadia.islam@student.pensms.test") // MBA, COMPLETED

// ─── Auth on the API ─────────────────────────────────────────────────────────
check("no session → 401", (await api(null, "GET", "/api/students")).status === 401)
{
  const r = await api(rahim, "GET", "/api/students")
  check("student on staff route → 403", r.status === 403, r)
}
check("staff on /api/me/marksheet → 403", (await api(staff, "GET", "/api/me/marksheet")).status === 403)
check("staff uploading a submission → 403", (await api(staff, "POST", `/api/assessments/5e3d0a1c-0000-4000-8000-000000000102/submissions`, upload(pdfFile()))).status === 403)

// ─── Students: search & filters ──────────────────────────────────────────────
const all = await api(staff, "GET", "/api/students")
check("list students 200 with 6", all.status === 200 && all.data.students.length === 6, all.data.students?.length)
const byId = Object.fromEntries(all.data.students.map((s) => [s.studentId, s]))
const sid = (seq) => byId[`SMS-${YEAR}-${String(seq).padStart(4, "0")}`].id
const bscId = byId[`SMS-${YEAR}-0001`].programme.id
const mbaId = byId[`SMS-${YEAR}-0005`].programme.id

const count = async (qs) => (await api(staff, "GET", `/api/students?${qs}`)).data.students?.length
check("search by name (case-insensitive)", (await count("q=RAHIM")) === 1)
check("search by partial Student ID", (await count(`q=sms-${YEAR}-0003`)) === 1)
check("filter by programme code", (await count("programme=mba")) === 2)
check("filter by status", (await count("status=DEFERRED")) === 1)
check("combined filters", (await count("programme=BSC-CS&status=ENROLLED")) === 3)
check("no matches → empty list", (await count("q=zzzz")) === 0)
check("invalid status → 400", (await api(staff, "GET", "/api/students?status=BOGUS")).status === 400)
check("malformed id → 404", (await api(staff, "GET", "/api/students/not-a-uuid")).status === 404)
check("unknown id → 404", (await api(staff, "GET", "/api/students/3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b")).status === 404)
check("invalid JSON body → 400", (await api(staff, "POST", "/api/students", "{not json", { "content-type": "application/json" })).status === 400)

// ─── Students: create ────────────────────────────────────────────────────────
const newStudent = {
  fullName: "E2E Created",
  email: "e2e.created@student.pensms.test",
  dateOfBirth: "2005-02-10",
  programmeId: bscId,
  academicYear: YEAR,
  password: "Password123!",
}
const created = await api(staff, "POST", "/api/students", newStudent)
check("create student 201", created.status === 201, created.data)
check("Student ID generated as next in sequence", created.data.student?.studentId === `SMS-${YEAR}-0007`, created.data.student?.studentId)
check("login created", created.data.student?.hasLogin === true)
{
  const fees = await api(staff, "GET", `/api/students/${created.data.student.id}/fees`)
  const s = fees.data.summary
  check("fee assigned from tariff at enrolment", s?.hasFeeAssigned && s.totalFee === "150000.00" && s.matchesTariff && s.source === "TARIFF", s)
  check("new student past tariff due date is overdue", s?.status === "OVERDUE", s?.status)
}
{
  const dup = await api(staff, "POST", "/api/students", { ...newStudent, email: "E2E.Created@student.pensms.test", password: undefined })
  check("duplicate email (case-insensitive) → 409", dup.status === 409 && dup.data.error === "A student with this email already exists." && dup.data.fieldErrors?.email, dup)
}
{
  const r = await api(staff, "POST", "/api/students", { ...newStudent, email: "x1@e2e.test", dateOfBirth: `${YEAR + 1}-01-01` })
  check("future DOB → 400 message", r.status === 400 && r.data.fieldErrors?.dateOfBirth?.[0] === "Date of birth must be in the past.", r.data)
}
{
  const r = await api(staff, "POST", "/api/students", { ...newStudent, email: "x2@e2e.test", dateOfBirth: `${YEAR - 10}-01-01` })
  check("under 15 → 400 message", r.status === 400 && r.data.fieldErrors?.dateOfBirth?.[0] === "Student must be at least 15 years old.", r.data)
}
{
  const r = await api(staff, "POST", "/api/students", { ...newStudent, email: "bad-email", fullName: "" })
  check("invalid email + missing name → 400 with both field errors", r.status === 400 && r.data.fieldErrors?.email && r.data.fieldErrors?.fullName, r.data)
}
{
  const r = await api(staff, "POST", "/api/students", { ...newStudent, email: "x3@e2e.test", academicYear: 1999 })
  check("academic year out of range → 400", r.status === 400 && r.data.fieldErrors?.academicYear, r.data)
}

// Race: 10 enrolments at once must all get distinct, consecutive IDs.
{
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, n) =>
      api(staff, "POST", "/api/students", { ...newStudent, email: `race${n + 1}@e2e.test`, password: undefined })
    )
  )
  const ids = results.map((r) => r.data.student?.studentId).sort()
  const expected = Array.from({ length: 10 }, (_, n) => `SMS-${YEAR}-${String(n + 8).padStart(4, "0")}`)
  check("10 concurrent enrolments all succeed", results.every((r) => r.status === 201), results.map((r) => `${r.status}${r.data.error ? ` ${r.data.error}` : ""}`))
  check("concurrent enrolments get unique consecutive IDs", JSON.stringify(ids) === JSON.stringify(expected), ids)
}

// New login works and sees an empty marksheet.
{
  const newLogin = await login("e2e.created@student.pensms.test")
  const r = await api(newLogin, "GET", "/api/me/marksheet")
  check("created student can sign in; empty marksheet", r.status === 200 && r.data.results.length === 0, r.data)
}

// Update: programme change keeps fee but flags mismatch; Student ID unchanged.
{
  const id = created.data.student.id
  const r = await api(staff, "PATCH", `/api/students/${id}`, { programmeId: mbaId, fullName: "E2E Renamed" })
  check("update student 200, Student ID unchanged", r.status === 200 && r.data.student.studentId === `SMS-${YEAR}-0007` && r.data.student.programme.code === "MBA", r.data)
  const s = (await api(staff, "GET", `/api/students/${id}/fees`)).data.summary
  check("programme change keeps fee, matchesTariff false", s.totalFee === "150000.00" && s.matchesTariff === false, s)
  const tariff = await api(staff, "PUT", `/api/students/${id}/fee`, { source: "TARIFF" })
  check("reassign from tariff → MBA fee", tariff.status === 200 && tariff.data.summary.totalFee === "250000.00" && tariff.data.summary.matchesTariff, tariff.data)
  const dup = await api(staff, "PATCH", `/api/students/${id}`, { email: "rahim.uddin@student.pensms.test" })
  check("update to existing email → 409", dup.status === 409, dup)
  const empty = await api(staff, "PATCH", `/api/students/${id}`, {})
  check("empty update → 400", empty.status === 400, empty)
}

// ─── Fees & payments ─────────────────────────────────────────────────────────
{
  const r = await api(staff, "GET", `/api/students/${sid(2)}/fees`)
  const s = r.data.summary
  check("Rahim: 150000 fee, 90000 paid, 60000 outstanding, overdue",
    s.totalFee === "150000.00" && s.totalPaid === "90000.00" && s.outstanding === "60000.00" && s.status === "OVERDUE" && s.daysOverdue >= 29, s)
  check("Rahim: payment history has 2 rows", r.data.payments.length === 2, r.data.payments)
}
{
  const s = (await api(staff, "GET", `/api/students/${sid(5)}/fees`)).data.summary
  check("Farhana: outstanding but not overdue", s.outstanding === "150000.00" && s.status === "OUTSTANDING" && !s.isOverdue, s)
  const n = (await api(staff, "GET", `/api/students/${sid(1)}/fees`)).data.summary
  check("Nusrat: fully paid", n.status === "PAID" && n.outstanding === "0.00", n)
}
const pay = (studentSeq, body) => api(staff, "POST", `/api/students/${sid(studentSeq)}/payments`, body)
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date())
{
  const zero = await pay(2, { amount: "0", paymentDate: today, referenceNumber: "E2E-0" })
  check("payment 0 → 400 message", zero.status === 400 && zero.data.error === "Payment amount must be greater than zero.", zero.data)
  const neg = await pay(2, { amount: -100, paymentDate: today, referenceNumber: "E2E-NEG" })
  check("payment -100 → 400", neg.status === 400, neg.data)
  const future = await pay(2, { amount: "100", paymentDate: `${YEAR + 1}-01-01`, referenceNumber: "E2E-FUT" })
  check("future payment date → 400 message", future.status === 400 && future.data.error === "Payment date cannot be in the future.", future.data)
  const over = await pay(2, { amount: "60000.01", paymentDate: today, referenceNumber: "E2E-OVER" })
  check("payment > outstanding → 400 exact message", over.status === 400 && over.data.error === "Payment exceeds the outstanding balance of 60,000.00 BDT.", over.data)
  const dupRef = await pay(2, { amount: "10", paymentDate: today, referenceNumber: `pay-${YEAR}-0001` })
  check("duplicate reference (case-insensitive) → 409", dupRef.status === 409 && dupRef.data.error === "This payment reference already exists.", dupRef.data)
  const ok = await pay(2, { amount: "10000.50", paymentDate: today, referenceNumber: "e2e-0001" })
  check("valid payment 201, reference normalised", ok.status === 201 && ok.data.payment.amount === "10000.50" && ok.data.payment.referenceNumber === "E2E-0001", ok.data)
  const s = (await api(staff, "GET", `/api/students/${sid(2)}/fees`)).data.summary
  check("outstanding recalculated exactly", s.outstanding === "49999.50" && s.totalPaid === "100000.50", s)
  const full = await pay(1, { amount: "1", paymentDate: today, referenceNumber: "E2E-FULL" })
  check("payment for fully paid student → 409", full.status === 409 && full.data.error === "This student has already paid in full.", full.data)
}
// Race: 5 simultaneous 40,000 payments against Abir's 150,000 → exactly 3 may succeed.
{
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => pay(3, { amount: "40000", paymentDate: today, referenceNumber: `E2E-RACE-${n}` }))
  )
  const statuses = results.map((r) => r.status).sort()
  check("concurrent payments: exactly 3 accepted, 2 rejected", JSON.stringify(statuses) === JSON.stringify([201, 201, 201, 400, 400]), statuses)
  const s = (await api(staff, "GET", `/api/students/${sid(3)}/fees`)).data.summary
  check("concurrent payments never exceed the fee", s.totalPaid === "120000.00" && s.outstanding === "30000.00", s)
}
// Fee adjustment
{
  const below = await api(staff, "PUT", `/api/students/${sid(2)}/fee`, { source: "MANUAL", amount: "50000", dueDate: "2026-12-31" })
  check("manual fee below paid → 400 message", below.status === 400 && below.data.error === "Fee cannot be less than the amount already paid (100,000.50 BDT).", below.data)
  const manual = await api(staff, "PUT", `/api/students/${sid(2)}/fee`, { source: "MANUAL", amount: "120000", dueDate: `${YEAR + 1}-01-31` })
  check("manual fee (scholarship) 200, not overdue, source MANUAL", manual.status === 200 && manual.data.summary.source === "MANUAL" && !manual.data.summary.matchesTariff && manual.data.summary.status === "OUTSTANDING", manual.data)
  const back = await api(staff, "PUT", `/api/students/${sid(2)}/fee`, { source: "TARIFF" })
  check("reassign from tariff restores 150000", back.status === 200 && back.data.summary.totalFee === "150000.00" && back.data.summary.matchesTariff, back.data)
  const badSource = await api(staff, "PUT", `/api/students/${sid(2)}/fee`, { source: "NOPE" })
  check("invalid fee source → 400", badSource.status === 400, badSource.data)
}
// No tariff for the year → no fee, payments blocked
{
  const noTariff = await api(staff, "POST", "/api/students", { ...newStudent, email: "notariff@e2e.test", password: undefined, academicYear: YEAR + 1 })
  check("student for a year without tariff 201", noTariff.status === 201, noTariff.data)
  const id = noTariff.data.student.id
  check("its Student ID uses that year", noTariff.data.student.studentId === `SMS-${YEAR + 1}-0001`, noTariff.data.student.studentId)
  const s = (await api(staff, "GET", `/api/students/${id}/fees`)).data.summary
  check("no fee assigned state", s.hasFeeAssigned === false && s.status === "NO_FEE" && s.totalFee === "0.00", s)
  const p = await api(staff, "POST", `/api/students/${id}/payments`, { amount: "100", paymentDate: today, referenceNumber: "E2E-NOFEE" })
  check("payment with no fee → 409 message", p.status === 409 && p.data.error === "No fee has been assigned to this student.", p.data)
  const t = await api(staff, "PUT", `/api/students/${id}/fee`, { source: "TARIFF" })
  check("assign from missing tariff → 409", t.status === 409, t.data)
  const m = await api(staff, "PUT", `/api/students/${id}/fee`, { source: "MANUAL", amount: "90000", dueDate: `${YEAR + 1}-06-30` })
  check("manual fee assigns", m.status === 200 && m.data.summary.hasFeeAssigned, m.data)
}

// ─── Assessments ─────────────────────────────────────────────────────────────
const DB = "5e3d0a1c-0000-4000-8000-000000000101"
const ALGO = "5e3d0a1c-0000-4000-8000-000000000102"
const ACC = "5e3d0a1c-0000-4000-8000-000000000104"
{
  const r = await api(staff, "GET", "/api/assessments")
  const db = r.data.assessments?.find((a) => a.id === DB)
  check("staff sees all 4 assessments", r.status === 200 && r.data.assessments.length === 4, r.data)
  check("DB counts: 3 submissions, 4 graded, past deadline", db?.submissionCount === 3 && db.gradedCount === 4 && db.isPastDeadline, db)
  check("filter by programme", (await api(staff, "GET", `/api/assessments?programmeId=${mbaId}`)).data.assessments.length === 2)
}
{
  const r = await api(rahim, "GET", "/api/assessments")
  const ids = r.data.assessments.map((a) => a.id).sort()
  check("student sees only own programme's assessments", JSON.stringify(ids) === JSON.stringify([DB, ALGO].sort()), ids)
  const db = r.data.assessments.find((a) => a.id === DB)
  check("Rahim DB: LATE, replacement blocked after deadline", db.status === "LATE" && !db.canUpload && db.uploadBlockedReason.startsWith("The deadline has passed"), db)
  const algo = r.data.assessments.find((a) => a.id === ALGO)
  check("Rahim ALGO: PENDING, can upload", algo.status === "PENDING" && algo.canUpload, algo)
  check("student payload has no other students' submissions", !JSON.stringify(r.data).includes("Nusrat_Jahan"))
}
{
  const past = new Date(Date.now() - 86400000).toISOString()
  const future = new Date(Date.now() + 7 * 86400000).toISOString()
  const pastCreate = await api(staff, "POST", "/api/assessments", { programmeId: bscId, title: "E2E Past", module: "Testing", submissionDeadline: past })
  check("create with past deadline → 201 + warning", pastCreate.status === 201 && pastCreate.data.warnings.length === 1, pastCreate.data)
  const missing = await api(staff, "POST", "/api/assessments", { programmeId: bscId, title: " ", module: "", submissionDeadline: future })
  check("missing title/module → 400 with field errors", missing.status === 400 && missing.data.fieldErrors?.title && missing.data.fieldErrors?.module, missing.data)
  const noTz = await api(staff, "POST", "/api/assessments", { programmeId: bscId, title: "X", module: "Y", submissionDeadline: "2026-12-01T10:00" })
  check("deadline without time zone → 400", noTz.status === 400, noTz.data)
  const badProg = await api(staff, "POST", "/api/assessments", { programmeId: "3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b", title: "X", module: "Y", submissionDeadline: future })
  check("unknown programme → 400 field error", badProg.status === 400 && badProg.data.fieldErrors?.programmeId, badProg.data)
  const move = await api(staff, "PATCH", `/api/assessments/${DB}`, { programmeId: mbaId })
  check("moving an assessment with submissions → 409", move.status === 409, move.data)
  const close = await api(staff, "PATCH", `/api/assessments/${pastCreate.data.assessment.id}`, { isOpen: false })
  check("close assessment → 200", close.status === 200 && close.data.assessment.isOpen === false, close.data)
}

// ─── Submissions ─────────────────────────────────────────────────────────────
{
  const before = uploadsCount()
  const first = await api(rahim, "POST", `/api/assessments/${ALGO}/submissions`, upload(pdfFile("../../evil/Algo Draft.pdf")))
  check("first submission before deadline → 201 on time", first.status === 201 && first.data.submission.isLate === false && first.data.submission.replaced === false, first.data)
  check("path stripped from file name", first.data.submission?.fileName === "Algo Draft.pdf", first.data.submission?.fileName)
  check("one file written", uploadsCount() === before + 1)

  const replaced = await api(rahim, "POST", `/api/assessments/${ALGO}/submissions`, upload(docxFile("Algo Final.docx")))
  check("resubmission before deadline → 200 replaced (same row)", replaced.status === 200 && replaced.data.submission.replaced && replaced.data.submission.id === first.data.submission.id, replaced.data)
  check("old file deleted after replacement", uploadsCount() === before + 1)

  const dl = await api(rahim, "GET", `/api/files/${replaced.data.submission.id}`)
  check("student downloads own file", dl.status === 200 && dl.data.toString() === "PK docx" && dl.headers.get("content-disposition")?.includes("Algo%20Final.docx"), dl.headers.get("content-disposition"))
}
{
  const r = await api(rahim, "POST", `/api/assessments/${DB}/submissions`, upload(pdfFile()))
  check("replacement after deadline → 409 exact message", r.status === 409 && r.data.error === "The deadline has passed. Your existing submission can no longer be replaced.", r.data)
}
{
  const r = await api(abir, "POST", `/api/assessments/${DB}/submissions`, upload(pdfFile("late.pdf")))
  check("first submission after deadline (open) → 201 flagged late", r.status === 201 && r.data.submission.isLate === true, r.data)
}
{
  const txt = await api(nusrat, "POST", `/api/assessments/${ALGO}/submissions`, upload(new File(["hi"], "notes.txt", { type: "text/plain" })))
  check("txt rejected → 400 message", txt.status === 400 && txt.data.error === "Only PDF and DOCX files are accepted.", txt.data)
  const fake = await api(nusrat, "POST", `/api/assessments/${ALGO}/submissions`, upload(new File(["hi"], "fake.pdf", { type: "text/plain" })))
  check("renamed non-PDF rejected", fake.status === 400, fake.data)
  const big = await api(nusrat, "POST", `/api/assessments/${ALGO}/submissions`, upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" })))
  check("file over 5 MB → 400 message", big.status === 400 && big.data.error === "File must be smaller than 5 MB.", big.data)
  const none = await api(nusrat, "POST", `/api/assessments/${ALGO}/submissions`, new FormData())
  check("no file → 400", none.status === 400, none.data)
}
check("other programme's assessment → 404", (await api(farhana, "POST", `/api/assessments/${ALGO}/submissions`, upload(pdfFile()))).status === 404)
{
  const r = await api(tanvir, "POST", `/api/assessments/${ALGO}/submissions`, upload(pdfFile()))
  check("deferred student → 403 message", r.status === 403 && r.data.error === "Only enrolled students can submit.", r.data)
}
{
  const r = await api(farhana, "POST", `/api/assessments/${ACC}/submissions`, upload(pdfFile()))
  check("closed assessment → 409 message", r.status === 409 && r.data.error === "This assessment is closed for submissions.", r.data)
}

// ─── File downloads ──────────────────────────────────────────────────────────
const NUSRAT_DB_SUBMISSION = "5e3d0a1c-0000-4000-8000-000000000201"
check("student cannot download another student's file → 404", (await api(rahim, "GET", `/api/files/${NUSRAT_DB_SUBMISSION}`)).status === 404)
{
  const r = await api(staff, "GET", `/api/files/${NUSRAT_DB_SUBMISSION}`)
  check("staff downloads a seeded PDF", r.status === 200 && r.data.subarray(0, 8).toString() === "%PDF-1.4" && r.headers.get("content-type") === "application/pdf" && r.headers.get("x-content-type-options") === "nosniff", r.status)
}
check("download signed out → 401", (await api(null, "GET", `/api/files/${NUSRAT_DB_SUBMISSION}`)).status === 401)
check("download malformed id → 404", (await api(staff, "GET", "/api/files/..%2F..%2F.env")).status === 404)

// ─── Results ─────────────────────────────────────────────────────────────────
const grade = (seq, assessmentId, body, who = staff) => api(who, "PUT", `/api/students/${sid(seq)}/results/${assessmentId}`, body)
{
  const high = await grade(3, DB, { grade: 101 })
  check("grade 101 → 400 message", high.status === 400 && high.data.error === "Grade must be between 0 and 100.", high.data)
  check("grade -1 → 400", (await grade(3, DB, { grade: -1 })).status === 400)
  const frac = await grade(3, DB, { grade: 70.5 })
  check("grade 70.5 → 400 whole number", frac.status === 400 && frac.data.error === "Grade must be a whole number.", frac.data)
  const wrongProg = await grade(5, DB, { grade: 50 })
  check("grade outside programme → 409 message", wrongProg.status === 409 && wrongProg.data.error === "This student is not in the assessment's programme.", wrongProg.data)
  const regrade = await grade(3, DB, { grade: 59 })
  check("re-grade updates (Pass, still unpublished)", regrade.status === 200 && regrade.data.result.grade === 59 && regrade.data.result.classification === "Pass" && regrade.data.result.published === false, regrade.data)
  const newGrade = await grade(2, ALGO, { grade: "69" })
  check("new grade starts unpublished, Merit", newGrade.status === 200 && newGrade.data.result.published === false && newGrade.data.result.classification === "Merit", newGrade.data)
  check("student cannot enter grades → 403", (await grade(2, ALGO, { grade: 100 }, rahim)).status === 403)
}
{
  const r = await api(nusrat, "GET", "/api/me/marksheet")
  check("Nusrat marksheet: only published DB 78", r.status === 200 && r.data.results.length === 1 && r.data.results[0].grade === 78 && r.data.results[0].classification === "Distinction", r.data)
  check("withheld grade 82 not in payload", !JSON.stringify(r.data).includes("82") && !JSON.stringify(r.data).includes("published"), r.data)

  const pub = await api(staff, "PATCH", `/api/students/${sid(1)}/results/${ALGO}`, { published: true })
  check("publish one result", pub.status === 200 && pub.data.result.published === true, pub.data)
  const after = await api(nusrat, "GET", "/api/me/marksheet")
  check("published result now visible", after.data.results.length === 2 && after.data.results.some((x) => x.grade === 82), after.data)

  const withhold = await api(staff, "POST", `/api/students/${sid(1)}/results/publish`, { published: false })
  check("withhold whole marksheet (per student) updates 2", withhold.status === 200 && withhold.data.updated === 2, withhold.data)
  check("withheld marksheet is empty", (await api(nusrat, "GET", "/api/me/marksheet")).data.results.length === 0)

  const missing = await api(staff, "PATCH", `/api/students/${sid(5)}/results/${ALGO}`, { published: true })
  check("publish with no grade → 404", missing.status === 404, missing.data)
  const badBody = await api(staff, "PATCH", `/api/students/${sid(1)}/results/${ALGO}`, { published: "yes" })
  check("publish with non-boolean → 400", badBody.status === 400, badBody.data)
}
{
  const r = await api(rahim, "GET", "/api/me/marksheet")
  check("Rahim marksheet: DB 70 only (ALGO 69 unpublished)", r.data.results.length === 1 && r.data.results[0].grade === 70, r.data)
}
check("Sadia (completed) can read her marksheet", (await api(sadia, "GET", "/api/me/marksheet")).data.results.length === 1)

console.log(`\n${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exitCode = failures.length ? 1 : 0
