import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { EnrolmentStatusBadge } from "@/components/shared/enrolment-status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requireStudent } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

export const metadata: Metadata = { title: "Dashboard · Student Portal" }

export default async function StudentDashboardPage() {
  // The student is always taken from the session, never from the URL.
  const session = await requireStudent()

  const student = await prisma.student.findUnique({
    where: { id: session.studentId },
    select: {
      studentId: true,
      fullName: true,
      email: true,
      academicYear: true,
      enrolmentStatus: true,
      programme: { select: { code: true, name: true } },
    },
  })
  if (!student) notFound()

  const details = [
    { label: "Student ID", value: <span className="font-mono">{student.studentId}</span> },
    { label: "Programme", value: `${student.programme.name} (${student.programme.code})` },
    { label: "Academic Year", value: student.academicYear },
    { label: "Email", value: student.email },
    { label: "Enrolment Status", value: <EnrolmentStatusBadge status={student.enrolmentStatus} /> },
  ]

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {student.fullName}</h1>
        <p className="text-sm text-muted-foreground">Your enrolment record</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Enrolment details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {details.map((item) => (
              <div key={item.label} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="text-sm font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  )
}
