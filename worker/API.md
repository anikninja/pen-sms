# PEN SMS Worker API (v1)

The Cloudflare Worker in this folder is the application's **database and file boundary**. The Next.js server (Vercel) calls it over HTTPS; the Worker runs the business rules against Cloudflare D1 through Prisma 6.12 and `@prisma/adapter-d1`, and keeps submission files in a private R2 bucket. Browsers never call these endpoints, except the two short-lived file-transfer URLs ([Files](#files)).

```
Browser ──► Next.js (Vercel) ──HTTPS + signed token──► Worker ──Prisma + adapter-d1──► D1
   │                                                    ▲  │
   └──── signed upload/download URL (files only) ───────┘  └──► R2 (private)
```

- **Coarse-grained.** Each page of the app needs one Worker request ([Views](#views)). Each form submission needs one ([Operations](#operations)). There are no generic "run this Prisma query" endpoints.
- **Same rules as the PostgreSQL app.** Validation schemas, business rules, DTOs and messages are shared code in `../src/lib` (`validations`, `domain`, `money`, `services/shared`, `services/d1`).

## Conventions

| | |
|---|---|
| Base path | `/v1` (and `/health`) |
| Transport | HTTPS only. Plain `http://` to a public hostname is `403 "HTTPS is required."` before any other check (Cloudflare serves the custom domain over HTTP too, and a signed request must never travel unencrypted). `localhost`, `127.0.0.1` and `[::1]` are exempt for local development |
| Bodies | JSON (`Content-Type: application/json`), at most 256 KB |
| IDs | UUIDs. A malformed id is `404` (as in the Next.js API) |
| Money | Decimal strings with 2 places: `"150000.00"`. Never numbers, never minor units |
| Dates | ISO 8601 strings: `"2026-09-30T17:59:00.000Z"`. Calendar dates (date of birth, payment date) are `"YYYY-MM-DD"` |
| Caching | Every response is `Cache-Control: no-store` |

### Errors

Every error has the same shape. `error` and `fieldErrors` are the same as in the Next.js JSON API. `code` lets the Next.js client rebuild the `DomainError`.

```json
{ "error": "Payment exceeds the outstanding balance of 60,000.00 BDT.", "code": "VALIDATION", "fieldErrors": { "amount": ["…"] } }
```

| `code` | Status | When |
|---|---|---|
| `VALIDATION` | 400 | Invalid input: field messages in `fieldErrors`. Invalid JSON. 413 for a body over 256 KB; 405 for a wrong method |
| `UNAUTHORIZED` | 401 | Missing or invalid internal token, or no signed-in user where one is needed |
| `FORBIDDEN` | 403 | The user's role is not allowed |
| `NOT_FOUND` | 404 | Unknown or malformed id, or a route that does not exist |
| `CONFLICT` | 409 | Duplicate (email, payment reference), or a rule that the current data blocks (paid in full, programme locked, …) |
| `INTERNAL` | 500 | Anything else. Logged in the Worker. The response never contains SQL, stack traces or configuration |

## Authentication

### Trust boundary

| Party | Trusted for | Not trusted for |
|---|---|---|
| **Browser** | Nothing. It holds only the Auth.js session cookie, and never sees a Worker token or secret | — |
| **Next.js server** | Authenticating users: the Auth.js credentials login, bcrypt, the session cookie. Signing each Worker request with the user id of the current session | Roles or permissions. The Worker re-reads them |
| **Worker** | Authorization. On every request it loads the user named in the token from D1, then applies the role rule of the endpoint | — |

**Why bcrypt runs in Next.js.** One bcrypt check with cost 10 takes about 118 ms of CPU (measured). Workers Free allows about 10 ms of CPU per request. So the login lookup returns the stored hash to the Next.js server, which compares it, and new passwords are hashed in Next.js before `POST /v1/students`. Hashes only travel server-to-server over HTTPS, inside signed requests.

### Internal token

Sent as `Authorization: Bearer v1.<claims>.<signature>` on every request except `/health`.

- **Format:** `v1.` + base64url(JSON claims) + `.` + base64url(HMAC-SHA-256). The version is fixed, so there is no algorithm negotiation. Code: `src/lib/internal-auth/token.ts`, shared by both sides.
- **Key:** HMAC key derived with HKDF-SHA-256 from `WORKER_INTERNAL_SECRET`, which is at least 32 random characters. The file-URL tokens use a different derived key, so neither kind is ever accepted as the other.

| Claim | Meaning |
|---|---|
| `iss` / `aud` / `typ` | `"pen-sms-web"` / `"pen-sms-worker"` / `"api"` |
| `sub` | The signed-in user's id, or `null` for the login lookup. **No role, no student id, no permissions.** |
| `iat`, `exp` | Issued at / expires. At most **60 s** apart. ±30 s clock skew is accepted. A token claiming a longer lifetime is refused even if validly signed |
| `jti` | Random id, for log correlation |
| `htm`, `htu`, `bh` | HTTP method, path + query, and base64url SHA-256 of the body. The token is valid **only for that exact request** |

**The Worker rejects (401)** a request whose token is missing, malformed or signed with another secret. It also rejects one that is expired, not yet valid or too long-lived, or that was made for a different method, path, query or body. The response says only "The request is not signed by the application."; the precise reason goes to the Worker log (`internal_token_rejected`).

**Replay.** A captured token can only repeat the identical request within about 90 s (60 s TTL plus skew), and capturing one requires breaking TLS between Vercel and Cloudflare. For each kind of operation, the effect of a replay:
- **Payments and student creation:** stopped by unique constraints (reference number, email).
- **Fee assignment, updates, grading and publishing:** idempotent, so a repeat changes nothing further.
- **`POST /v1/assessments`:** the only operation a replay could duplicate. This is accepted as residual risk.

A `jti` store could close that gap later, at the cost of one extra D1 write per request.

**Secret handling.**
- **Storage:** `WORKER_INTERNAL_SECRET` is a Wrangler secret (`wrangler secret put`) on the Worker, and a server-only environment variable on Vercel. It is never `NEXT_PUBLIC_*`, never in `wrangler.jsonc` and never in git. Locally it lives in `worker/.dev.vars` (git-ignored; template: `.dev.vars.example`).
- **Rotation:** set the new value, keep the old one as `WORKER_INTERNAL_SECRET_PREVIOUS` on the Worker until Vercel uses the new value, then delete it.
- **If the secret is missing:** every signed route returns `500 "The service is not configured."`. `/health` still answers.

### Access levels

| Access | Requires |
|---|---|
| `public` | Nothing (`/health` only) |
| `service` | A valid token. `sub` may be `null` |
| `user` | A valid token whose `sub` is an existing user. A deleted user gets 401 "Please sign in." immediately |
| `staff` | `user` with role `STAFF`. Otherwise 403 "Only Registry staff can do this." |
| `student` | `user` with role `STUDENT` and a linked student. Otherwise 403 "Only students can do this." |

Headers such as `x-user-id` or `x-role` are ignored; a test checks this.

## Endpoints

### Health

| Method | Path | Access | Response |
|---|---|---|---|
| GET | `/health` | public | `200 { status: "ok", d1: "ok", schema: { ok, missingTables: [], latestMigration: "0001_baseline.sql" }, time }`. `503` with `status: "degraded"` if tables are missing, or `d1: "unreachable"` if D1 fails. No data, counts, versions or configuration |

### Session and login

| Method | Path | Access | Request | Response |
|---|---|---|---|---|
| POST | `/v1/auth/lookup` | service | `{ email }` | `{ user: { id, email, name, role, studentId, passwordHash } \| null }`. The Next.js server runs `bcrypt.compare`, against a dummy hash when `user` is null, so timing does not reveal which emails exist |
| GET | `/v1/session` | user | — | `{ session: { userId, name, email, role, studentId } }`, as D1 has it now. This replaces `getSession()`'s database read |

### Operations

Request bodies are validated with the same zod schemas as the Next.js API (`src/lib/validations/*`), and every rule message is the same.

| Method | Path | Access | Request | Response |
|---|---|---|---|---|
| GET | `/v1/students?q=&programme=&status=` | staff | Query as in `/api/students` | `{ students: StudentDto[] }` |
| POST | `/v1/students` | staff | `studentCreateRecordSchema`: the create fields plus an optional `passwordHash` (bcrypt), **never** a plain `password` | `201 { student }` |
| GET | `/v1/students/:id` | staff | — | `{ student }` |
| PATCH | `/v1/students/:id` | staff | `studentUpdateSchema` | `{ student }` |
| GET | `/v1/students/:id/fees` | staff | — | `{ summary, payments, tariff }` |
| PUT | `/v1/students/:id/fee` | staff | `{ source: "TARIFF" }` or `{ source: "MANUAL", amount, dueDate, currency? }` | `{ summary }` |
| POST | `/v1/students/:id/payments` | staff | `{ amount, paymentDate, referenceNumber }` | `201 { payment }` |
| PUT | `/v1/students/:id/results/:assessmentId` | staff | `{ grade }` | `{ result }` |
| PATCH | `/v1/students/:id/results/:assessmentId` | staff | `{ published }` | `{ result }` |
| POST | `/v1/students/:id/results/publish` | staff | `{ published }` | `{ updated }` |
| GET | `/v1/programmes?activeOnly=true` | staff | — | `{ programmes }` |
| GET | `/v1/fees?status=` | staff | `status`: `NO_FEE` \| `PAID` \| `OUTSTANDING` \| `OVERDUE` | `{ rows: FeeOverviewRow[] }` |
| GET | `/v1/assessments?programmeId=` | user | — | Staff: `{ assessments: AssessmentDto[] }`. Student: `{ assessments: StudentAssessmentDto[] }` for their own programme (as `GET /api/assessments`) |
| POST | `/v1/assessments` | staff | `assessmentCreateSchema` | `201 { assessment, warnings }` |
| GET | `/v1/assessments/:id` | staff | — | `{ assessment }` |
| PATCH | `/v1/assessments/:id` | staff | `assessmentUpdateSchema` | `{ assessment }` |
| POST | `/v1/assessments/:id/results/publish` | staff | `{ published }` | `{ updated }` |
| GET | `/v1/me/overview` | student | — | Student dashboard: `{ student, fee, nextDeadline, counts }` |
| GET | `/v1/me/fees` | student | — | `{ summary, payments }` |
| GET | `/v1/me/assessments` | student | — | `{ assessments: StudentAssessmentDto[] }` |
| GET | `/v1/me/marksheet` | student | — | `{ results: MarksheetEntry[] }`: published results only, without the publish flag |

`/v1/me/*` always uses the student in the session (read from D1). Any student id in the request is ignored.

### Views

Staff pages that combine several reads get one endpoint each, so a page render is one Worker request.

| Path (GET, staff) | For page | Response |
|---|---|---|
| `/v1/views/dashboard` | `/staff/dashboard` | `StaffDashboard` |
| `/v1/views/students?q=&programme=&status=` | `/staff/students` | `{ students, programmes }` |
| `/v1/views/students/:id` | `/staff/students/[id]` | `{ student, fees: { summary, payments, tariff }, assessments, results }` |
| `/v1/views/students/:id/edit` | `/staff/students/[id]/edit` | `{ student, programmes }` |
| `/v1/views/assessments?programme=CODE` | `/staff/assessments` | `{ programmes, assessments }` |
| `/v1/views/assessments/:id` | `/staff/assessments/[id]` | `{ assessment, grading: { rows, counts }, programmes }` |
| `/v1/views/results?assessment=ID` | `/staff/results` | `{ assessments, withheld: { [assessmentId]: count }, selectedId, grading }` |

Student pages are covered by `/v1/me/*`. The new-student page uses `/v1/programmes?activeOnly=true`, and the fees page uses `/v1/fees`.

## Concurrency and idempotency

D1 has no interactive transactions, and Prisma's `$transaction` is not atomic on D1. Every invariant is therefore enforced inside **one SQL statement** (details: `prisma/d1/README.md`).

| Operation | Guarantee | Tested with |
|---|---|---|
| Create student | The Student ID is computed inside the INSERT, so concurrent enrolments get distinct, consecutive IDs. If a later step fails, the fee copy and login are compensated by deleting the student | 10 concurrent requests |
| Record payment | Inserted only if it fits the outstanding balance at that instant. Duplicate references → 409 | 5 concurrent payments; 4 concurrent same-reference requests |
| Assign fee | One `INSERT … ON CONFLICT`. Never below what was paid; the currency is locked once payments exist | Phase 3 race tests |
| Enter grade | One `INSERT … SELECT … ON CONFLICT`. The programme must match; one row per student and assessment | 5 concurrent grades |
| Move assessment | One conditional UPDATE, only while there are no submissions or results | — |

## D1 limits handled

- **Bound parameters.** Prisma 6.12 on D1 fails a nested relation selection that has its own `where`, and a top-level `IN` list, once they need more than about 98 bound parameters ("too many SQL variables"; measured on local D1). The D1 services use flat queries with a constant number of parameters instead. Tests cover 136 students and 114 assessments.
- **Stored formats.** DateTime values are stored as ISO text by the adapter. Money is stored as integer minor units (`BigInt`).

## Files

Submission files (PDF/DOCX, up to 5 MB) live in the private R2 bucket `inxapp-sms-files` (binding `FILES`). They move between the browser and the Worker directly, **never through Vercel**, whose functions accept at most 4.5 MB per request.

- **Why signed Worker URLs and not R2's S3 presigned URLs:** no R2 access keys to store, no bucket CORS, and the Worker can check type, size and ownership while receiving the file. Local development and tests also cover this path; Miniflare's R2 has no S3 endpoint.

### Upload

1. The browser asks the Next.js server, which calls `POST /v1/assessments/:id/submissions/upload-url` (student) with `{ fileName, fileType, fileSize }`.
   - The Worker runs every submission rule first: own programme, open, enrolled, file type and size, and the replacement deadline. Failures use the same messages as the current app.
   - It returns `{ upload: { url, method: "PUT", headers: { "Content-Type" }, expiresAt, maxBytes } }`.
2. The browser sends `PUT <url>` with the raw file as the body and that `Content-Type`.
   - The URL is `https://<worker>/v1/uploads?token=…`, valid for **5 minutes**.
   - The token names the user, the student, the assessment and the declared file name, type and size.
3. The Worker checks everything again when the file arrives:
   - the token is valid and not expired;
   - the user is still that student;
   - the body is exactly the declared type and size (a larger body is refused before it is read);
   - every submission rule.

   It then stores the object and writes the row, and answers with the same `{ submission: { …, replaced } }` as `POST /api/assessments/:id/submissions` (201 for a first upload, 200 for a replacement). Lateness comes from the Worker's clock.

### Download

1. The Next.js route `/api/files/:submissionId` calls `POST /v1/files/:submissionId/download-url` (user).
   - Staff may download any file; a student only their own. Anything else is `404 "File not found."`, so other students' submissions are not revealed.
   - It returns `{ download: { url, expiresAt } }`, valid for **60 seconds**, for that submission and that exact version (object key).
2. The browser follows the URL: `GET /v1/files/download?token=…`.
   - The file is streamed from R2 as an attachment, with its stored name and type, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
   - If the submission was replaced after the URL was issued, or the object is missing: `404 "The file is no longer available."`.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/v1/assessments/:id/submissions/upload-url` | student | Checks, then a 5-minute upload URL |
| PUT | `/v1/uploads?token=…` | file token | CORS for `ALLOWED_ORIGINS` only. Body ≤ 5 MB |
| POST | `/v1/files/:submissionId/download-url` | user | Ownership check, then a 60-second download URL |
| GET | `/v1/files/download?token=…` | file token | Streams from R2 |

### Storage rules

- **Private bucket.** No public access, no `r2.dev` URL, no custom domain. There is no endpoint that lists objects or reads a key from the request; the only reads are through a download token that the Worker issued after checking ownership.
- **Object keys** come from ids, never from the user's file name: `submissions/<submissionId>/<epochMs>-<random>.<pdf|docx>` (`src/lib/storage/object-store.ts`). The original name, type, size and time are in the `Submission` row.
- **Consistency without transactions** (`src/lib/services/d1/submission-files.ts`):
  1. the new version is stored under a new key before the row points at it;
  2. the row is updated only if it still points at the version that was read (compare-and-swap);
  3. the losing upload of a race deletes its own object and retries;
  4. the previous version is deleted after the row moves.

  Racing uploads leave exactly one row and one object; a test checks that the bucket then holds exactly the keys the database points at.
- **File tokens** are signed with a key derived from `WORKER_INTERNAL_SECRET` for files only. An upload token is never accepted as a download token, nor either as an API token.
- **CORS.** Only `PUT /v1/uploads` answers browser preflights, and only for the origins in `ALLOWED_ORIGINS` (`http://localhost:3000` locally; `https://sms.inxapp.net` in production). No bucket CORS is needed, because browsers never talk to R2.

### Existing local files (`storage/uploads/`)

These belong to the local PostgreSQL setup and are not deployed or migrated:
- **Six seed fixtures** (`5e3d0a1c-…-020N-0.pdf`), which `prisma/seed.ts` regenerates.
- **Five uploads from local testing on 17–18 Sep 2026.** The 12-byte `.pdf` and 7-byte `.docx` are exactly the fixtures of `scripts/e2e-api.mjs`.

None is production data, since the app has never been deployed, so no migration script is needed. The files are left untouched. The D1 seed puts its own copies of the six fixtures into R2.
