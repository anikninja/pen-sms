/** Student DTO and messages shared by the PostgreSQL and D1 student services. */
import type { EnrolmentStatus } from "@prisma/client"

export type StudentDto = {
  id: string
  studentId: string
  fullName: string
  email: string
  dateOfBirth: string // YYYY-MM-DD
  academicYear: number
  enrolmentStatus: EnrolmentStatus
  programme: { id: string; code: string; name: string }
  hasLogin: boolean
  createdAt: Date
  updatedAt: Date
}

/** Attempts at generating a Student ID before giving up (a safety net: collisions are prevented). */
export const MAX_ID_ATTEMPTS = 3

export const STUDENT_NOT_FOUND = "Student not found."
export const DUPLICATE_EMAIL = "A student with this email already exists."
export const DUPLICATE_LOGIN = "A login with this email already exists."
export const ID_GENERATION_FAILED = "Could not generate a Student ID. Please try again."
