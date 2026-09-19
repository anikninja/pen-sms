/**
 * Students on Cloudflare D1 (prisma/d1/schema.prisma). Same rules, DTOs and messages as the
 * PostgreSQL service (src/lib/services/students.ts); not wired into the application yet.
 *
 * D1 has no interactive transactions and no locks, but runs statements one at a time, each atomically.
 * So every invariant is enforced inside a single statement:
 * - the Student ID is computed in the INSERT that creates the student (MAX + 1, as on PostgreSQL);
 * - the fee is copied from the tariff in one INSERT … SELECT.
 * A login cannot be created in the same statement (another table); if that step fails the student
 * is deleted again (ON DELETE CASCADE removes the copied fee).
 *
 * Passwords arrive already hashed: bcrypt runs in the Next.js server, because one bcrypt hash costs
 * about 100 ms of CPU and the Workers Free plan allows about 10 ms per request (worker/API.md).
 */
import type { Prisma } from ".prisma/client-d1"

import { isoDateToUtc } from "@/lib/domain/dates"
import { studentIdPrefix } from "@/lib/domain/student-id"
import { DomainError, fieldConflict, isUniqueViolation } from "@/lib/errors"
import type { D1Client } from "@/lib/services/d1/client"
import { requireActiveProgramme } from "@/lib/services/d1/programmes"
import {
  DUPLICATE_EMAIL,
  DUPLICATE_LOGIN,
  ID_GENERATION_FAILED,
  MAX_ID_ATTEMPTS,
  STUDENT_NOT_FOUND,
  type StudentDto,
} from "@/lib/services/shared/students"
import { toIsoDate } from "@/lib/utils/format"
import type { StudentCreateInput, StudentSearchInput, StudentUpdateInput } from "@/lib/validations/students"

/** The create input with the password replaced by its bcrypt hash (hashed by the caller). */
export type D1StudentCreateInput = Omit<StudentCreateInput, "password"> & { passwordHash?: string | null }

const studentSelect = {
  id: true,
  studentId: true,
  fullName: true,
  email: true,
  dateOfBirth: true,
  academicYear: true,
  enrolmentStatus: true,
  createdAt: true,
  updatedAt: true,
  programme: { select: { id: true, code: true, name: true } },
  user: { select: { id: true } },
} satisfies Prisma.StudentSelect

type StudentRow = Prisma.StudentGetPayload<{ select: typeof studentSelect }>

function toDto({ user, dateOfBirth, ...student }: StudentRow): StudentDto {
  return { ...student, dateOfBirth: toIsoDate(dateOfBirth), hasLogin: user !== null }
}

/**
 * Search by name or Student ID, filter by programme code and status (§20), case-insensitively.
 * - Name and Student ID: Prisma's `contains` is SQL LIKE on SQLite, which ignores case for ASCII
 *   letters. (PostgreSQL's ILIKE also folds non-ASCII letters such as É/é; SQLite does not.)
 * - Programme code: an exact match, so LIKE does not apply; the code is compared case-insensitively
 *   against the (small) programme table here, then students are filtered by programme id.
 */
export async function listStudents(db: D1Client, search: StudentSearchInput): Promise<StudentDto[]> {
  let programmeIds: string[] | null = null
  if (search.programme) {
    const wanted = search.programme.toLowerCase()
    const programmes = await db.programme.findMany({ select: { id: true, code: true } })
    programmeIds = programmes.filter((programme) => programme.code.toLowerCase() === wanted).map((programme) => programme.id)
    if (programmeIds.length === 0) return []
  }

  const where: Prisma.StudentWhereInput = {
    AND: [
      search.q ? { OR: [{ fullName: { contains: search.q } }, { studentId: { contains: search.q } }] } : {},
      programmeIds ? { programmeId: { in: programmeIds } } : {},
      search.status ? { enrolmentStatus: search.status } : {},
    ],
  }
  const rows = await db.student.findMany({ where, orderBy: { studentId: "asc" }, select: studentSelect })
  return rows.map(toDto)
}

export async function getStudent(db: D1Client, id: string): Promise<StudentDto> {
  const row = await db.student.findUnique({ where: { id }, select: studentSelect })
  if (!row) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  return toDto(row)
}

/**
 * Inserts the student with the next Student ID for the year, computed in the same statement (§4.2).
 *
 * Rule (as on PostgreSQL): 1 + the highest numeric sequence among IDs of exactly the form
 * `SMS-<year>-<digits>`. Gaps are not reused, malformed IDs and other years are ignored, and the
 * first student of a year gets 0001. The sequence is padded to 4 digits and grows past 9999,
 * exactly like formatStudentId().
 *
 * Because D1 executes statements one at a time, the MAX seen by this INSERT includes every
 * previously committed student, so concurrent enrolments cannot pick the same ID. The unique index
 * on studentId remains the last line of defence.
 */
async function insertStudentWithNextId(
  db: D1Client,
  row: { id: string; input: D1StudentCreateInput; now: Date }
): Promise<void> {
  const { id, input, now } = row
  const prefix = studentIdPrefix(input.academicYear) // "SMS-2026-"
  const sequenceStart = prefix.length + 1

  await db.$executeRaw`
    INSERT INTO "Student" ("id", "studentId", "fullName", "email", "dateOfBirth", "programmeId", "academicYear", "enrolmentStatus", "createdAt", "updatedAt")
    SELECT
      ${id},
      ${prefix} || CASE WHEN next.seq < 10000 THEN substr('0000' || next.seq, -4) ELSE CAST(next.seq AS TEXT) END,
      ${input.fullName}, ${input.email}, ${isoDateToUtc(input.dateOfBirth)}, ${input.programmeId},
      ${input.academicYear}, ${input.enrolmentStatus}, ${now}, ${now}
    FROM (
      SELECT COALESCE(MAX(CAST(substr("studentId", ${sequenceStart}) AS INTEGER)), 0) + 1 AS seq
      FROM "Student"
      WHERE substr("studentId", 1, ${prefix.length}) = ${prefix}
        AND length("studentId") >= ${sequenceStart}
        AND substr("studentId", ${sequenceStart}) NOT GLOB '*[^0-9]*'
    ) AS next`
}

/** Copies the programme/year tariff into the student's fee in one statement; no tariff, no fee (§6A). */
async function copyTariffToFee(db: D1Client, studentId: string, now: Date): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "StudentFee" ("id", "studentId", "programmeFeeId", "amount", "currency", "dueDate", "createdAt", "updatedAt")
    SELECT ${crypto.randomUUID()}, s."id", t."id", t."amount", t."currency", t."dueDate", ${now}, ${now}
    FROM "Student" s
    JOIN "ProgrammeFee" t ON t."programmeId" = s."programmeId" AND t."academicYear" = s."academicYear"
    WHERE s."id" = ${studentId}`
}

/**
 * Creates a student with a generated Student ID (§4.2), copies the programme tariff into StudentFee
 * (§6A), and optionally creates a STUDENT login (§27).
 *
 * PostgreSQL did all three in one transaction. Here: (1) the student row, with its ID, is one atomic
 * statement; (2) the fee copy is one atomic statement; (3) the login is one INSERT. If (2) or (3)
 * fails, the student is deleted (cascading to the fee), so no half-created student remains.
 */
export async function createStudent(db: D1Client, input: D1StudentCreateInput, now = new Date()): Promise<StudentDto> {
  await requireActiveProgramme(db, input.programmeId)
  const passwordHash = input.passwordHash ?? null

  // Checked before anything is written; a login created in between is caught by the unique index.
  if (passwordHash && (await db.user.findUnique({ where: { email: input.email }, select: { id: true } }))) {
    throw fieldConflict("email", DUPLICATE_LOGIN)
  }

  const id = crypto.randomUUID()
  for (let attempt = 1; ; attempt++) {
    try {
      await insertStudentWithNextId(db, { id, input, now })
      break
    } catch (error) {
      // Safety net only: statement-level atomicity already prevents two enrolments picking the same ID.
      if (isUniqueViolation(error, "studentId") && attempt < MAX_ID_ATTEMPTS) continue
      if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
      if (isUniqueViolation(error, "studentId")) throw new DomainError("CONFLICT", ID_GENERATION_FAILED)
      throw error
    }
  }

  try {
    await copyTariffToFee(db, id, now)
    if (passwordHash) {
      await db.user.create({
        data: { email: input.email, name: input.fullName, passwordHash, role: "STUDENT", studentId: id },
        select: { id: true },
      })
    }
  } catch (error) {
    // Compensate: remove the student (and, by cascade, its fee) so the enrolment is all-or-nothing.
    await db.$executeRaw`DELETE FROM "Student" WHERE "id" = ${id}`.catch((cleanupError: unknown) =>
      console.error("Could not remove a partially created student", id, cleanupError)
    )
    if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
    throw error
  }

  return getStudent(db, id)
}

/**
 * Updates student details and keeps the login's email and name in step (§27). The Student ID never
 * changes, and the assigned fee is not touched (§6A).
 *
 * PostgreSQL updated both rows in one transaction. Here the login is updated first — it has only
 * two fields to restore, and its unique email is the likelier conflict — then the student. If the
 * student update fails, the login is put back, but only if it still holds the values written here.
 */
export async function updateStudent(db: D1Client, id: string, input: StudentUpdateInput): Promise<StudentDto> {
  const current = await db.student.findUnique({
    where: { id },
    select: { programmeId: true, user: { select: { id: true, email: true, name: true } } },
  })
  if (!current) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  if (input.programmeId && input.programmeId !== current.programmeId) {
    await requireActiveProgramme(db, input.programmeId)
  }

  const login = current.user && (input.email || input.fullName) ? current.user : null
  if (login) {
    try {
      await db.user.updateMany({ where: { id: login.id }, data: { email: input.email, name: input.fullName } })
    } catch (error) {
      if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
      throw error
    }
  }

  try {
    const row = await db.student.update({
      where: { id },
      data: { ...input, dateOfBirth: input.dateOfBirth ? isoDateToUtc(input.dateOfBirth) : undefined },
      select: studentSelect,
    })
    return toDto(row)
  } catch (error) {
    if (login) {
      await db.user
        .updateMany({
          where: { id: login.id, email: input.email ?? login.email, name: input.fullName ?? login.name },
          data: { email: login.email, name: login.name },
        })
        .catch((cleanupError: unknown) => console.error("Could not restore a student's login", login.id, cleanupError))
    }
    if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
    throw error
  }
}
