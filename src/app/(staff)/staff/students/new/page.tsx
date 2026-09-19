import type { Metadata } from "next"

import { PageHeader } from "@/components/shared/page-header"
import { StudentForm } from "@/components/staff/student-form"
import { requireStaff } from "@/lib/auth/session"
import { data } from "@/lib/data"

export const metadata: Metadata = { title: "New student · Registry" }

export default async function NewStudentPage() {
  await requireStaff()
  // Inactive programmes are not offered for new students (§20).
  const programmes = await (await data()).listProgrammes({ activeOnly: true })

  return (
    <>
      <PageHeader
        title="New student"
        description="The Student ID is generated on save, and the programme's fee for the academic year is assigned automatically."
      />
      <StudentForm mode="create" programmes={programmes} defaultYear={new Date().getFullYear()} />
    </>
  )
}
