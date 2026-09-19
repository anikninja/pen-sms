/**
 * Students on PostgreSQL (the running application). Student IDs are serialised with an advisory
 * lock and search uses PostgreSQL's case-insensitive mode; the D1 implementation of the same rules
 * is src/lib/services/d1/students.ts.
 */
import { Prisma } from "@prisma/client"
import bcrypt from "bcryptjs"

import { isoDateToUtc } from "@/lib/domain/dates"
import { formatStudentId } from "@/lib/domain/student-id"
import { DomainError, fieldConflict, isUniqueViolation } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { requireActiveProgramme } from "@/lib/services/programmes"
import {
  DUPLICATE_EMAIL,
  DUPLICATE_LOGIN,
  ID_GENERATION_FAILED,
  MAX_ID_ATTEMPTS,
  STUDENT_NOT_FOUND,
  type StudentDto,
} from "@/lib/services/shared/students"
import { toIsoDate } from "@/lib/utils/format"
import type {
  StudentCreateInput,
  StudentSearchInput,
  StudentUpdateInput,
} from "@/lib/validations/students"

export type { StudentDto } from "@/lib/services/shared/students"

// First key of the advisory lock that serialises Student ID generation; the second key is the year.
const STUDENT_ID_LOCK = 4_101

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

/** Search by name or Student ID, filter by programme code and status — all in the query (§20). */
export async function listStudents(search: StudentSearchInput): Promise<StudentDto[]> {
  const where: Prisma.StudentWhereInput = {
    AND: [
      search.q
        ? {
            OR: [
              { fullName: { contains: search.q, mode: "insensitive" } },
              { studentId: { contains: search.q, mode: "insensitive" } },
            ],
          }
        : {},
      search.programme ? { programme: { code: { equals: search.programme, mode: "insensitive" } } } : {},
      search.status ? { enrolmentStatus: search.status } : {},
    ],
  }

  const rows = await prisma.student.findMany({ where, orderBy: { studentId: "asc" }, select: studentSelect })
  return rows.map(toDto)
}

export async function getStudent(id: string): Promise<StudentDto> {
  const row = await prisma.student.findUnique({ where: { id }, select: studentSelect })
  if (!row) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)
  return toDto(row)
}

/**
 * Creates a student with a generated Student ID (§4.2), copies the programme tariff into
 * StudentFee in the same transaction (§6A), and optionally creates a STUDENT login (§27).
 */
export async function createStudent(input: StudentCreateInput): Promise<StudentDto> {
  await requireActiveProgramme(input.programmeId)
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const studentId = await nextStudentId(tx, input.academicYear)

          if (passwordHash && (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } }))) {
            throw fieldConflict("email", DUPLICATE_LOGIN)
          }

          const tariff = await tx.programmeFee.findUnique({
            where: {
              programmeId_academicYear: { programmeId: input.programmeId, academicYear: input.academicYear },
            },
          })

          const row = await tx.student.create({
            data: {
              studentId,
              fullName: input.fullName,
              email: input.email,
              dateOfBirth: isoDateToUtc(input.dateOfBirth),
              programmeId: input.programmeId,
              academicYear: input.academicYear,
              enrolmentStatus: input.enrolmentStatus,
              fee: tariff
                ? {
                    create: {
                      programmeFeeId: tariff.id,
                      amount: tariff.amount,
                      currency: tariff.currency,
                      dueDate: tariff.dueDate,
                    },
                  }
                : undefined,
              user: passwordHash
                ? { create: { email: input.email, name: input.fullName, passwordHash, role: "STUDENT" } }
                : undefined,
            },
            select: studentSelect,
          })
          return toDto(row)
        },
        // Enrolments for the same year queue on the advisory lock; allow for a burst of them.
        { maxWait: 10_000, timeout: 15_000 }
      )
    } catch (error) {
      // Safety net only: the advisory lock already prevents two transactions picking the same sequence.
      if (isUniqueViolation(error, "studentId") && attempt < MAX_ID_ATTEMPTS) continue
      if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
      if (isUniqueViolation(error, "studentId")) {
        throw new DomainError("CONFLICT", ID_GENERATION_FAILED)
      }
      throw error
    }
  }
}

/**
 * Must run inside the enrolment transaction. The advisory lock is held until that transaction ends,
 * so concurrent enrolments for the same year read the highest ID one at a time — after the previous
 * one has committed — instead of all reading the same value and colliding (§4.2).
 */
async function nextStudentId(tx: Prisma.TransactionClient, year: number): Promise<string> {
  // $executeRaw: pg_advisory_xact_lock returns void, which $queryRaw cannot deserialise.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STUDENT_ID_LOCK}::int, ${year}::int)`

  // Numeric max, so SMS-2026-10000 correctly follows SMS-2026-9999.
  const [row] = await tx.$queryRaw<{ max: number }[]>`
    SELECT COALESCE(MAX(split_part("studentId", '-', 3)::int), 0)::int AS max
    FROM "Student"
    WHERE "studentId" ~ ${`^SMS-${year}-[0-9]+$`}
  `
  return formatStudentId(year, row.max + 1)
}

/**
 * Updates student details. The Student ID never changes, and the assigned fee is not touched
 * even when programme or year change — the fee summary reports matchesTariff: false (§6A).
 */
export async function updateStudent(id: string, input: StudentUpdateInput): Promise<StudentDto> {
  const current = await prisma.student.findUnique({
    where: { id },
    select: { programmeId: true, email: true, user: { select: { id: true } } },
  })
  if (!current) throw new DomainError("NOT_FOUND", STUDENT_NOT_FOUND)

  if (input.programmeId && input.programmeId !== current.programmeId) {
    await requireActiveProgramme(input.programmeId)
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.student.update({
        where: { id },
        data: {
          ...input,
          dateOfBirth: input.dateOfBirth ? isoDateToUtc(input.dateOfBirth) : undefined,
        },
        select: studentSelect,
      })

      // Keep the login email and display name in step with the student record.
      if (current.user && (input.email || input.fullName)) {
        await tx.user.update({
          where: { id: current.user.id },
          data: { email: input.email, name: input.fullName },
        })
      }
      return toDto(row)
    })
  } catch (error) {
    if (isUniqueViolation(error, "email")) throw fieldConflict("email", DUPLICATE_EMAIL)
    throw error
  }
}
