import type { Metadata } from "next"

import { PageHeader } from "@/components/shared/page-header"
import { StudentForm } from "@/components/staff/student-form"
import { requireStaff } from "@/lib/auth/session"
import { idOr404, orNotFound } from "@/lib/pages"
import { listProgrammes } from "@/lib/services/programmes"
import { getStudent } from "@/lib/services/students"

export const metadata: Metadata = { title: "Edit student · Registry" }

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff()
  const id = idOr404((await params).id)

  const [student, allProgrammes] = await Promise.all([orNotFound(getStudent(id)), listProgrammes()])
  // Active programmes, plus the student's current one even if it has since been deactivated.
  const programmes = allProgrammes.filter((programme) => programme.active || programme.id === student.programme.id)

  return (
    <>
      <PageHeader title={`Edit ${student.fullName}`} description={student.studentId} />
      <StudentForm mode="edit" programmes={programmes} student={student} defaultYear={new Date().getFullYear()} />
    </>
  )
}
