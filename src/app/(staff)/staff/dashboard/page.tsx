import type { Metadata } from "next"

import { EnrolmentStatusBadge } from "@/components/shared/enrolment-status-badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireStaff } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

export const metadata: Metadata = { title: "Dashboard · Registry" }

export default async function StaffDashboardPage() {
  // Layouts and pages render in parallel, so each page checks the role itself.
  const session = await requireStaff()

  const [totalStudents, enrolledStudents, activeProgrammes, unpublishedResults, recentStudents] =
    await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { enrolmentStatus: "ENROLLED" } }),
      prisma.programme.count({ where: { active: true } }),
      prisma.result.count({ where: { published: false } }),
      prisma.student.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          studentId: true,
          fullName: true,
          academicYear: true,
          enrolmentStatus: true,
          programme: { select: { code: true } },
        },
      }),
    ])

  const stats = [
    { label: "Total Students", value: totalStudents },
    { label: "Enrolled Students", value: enrolledStudents },
    { label: "Active Programmes", value: activeProgrammes },
    { label: "Unpublished Results", value: unpublishedResults },
  ]

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {session.name}</h1>
        <p className="text-sm text-muted-foreground">Registry overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recently added students</h2>
        {recentStudents.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No students yet. Run <code>npm run db:seed</code> to load demo data.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Programme</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentStudents.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell className="font-mono text-xs">{student.studentId}</TableCell>
                    <TableCell>{student.fullName}</TableCell>
                    <TableCell>{student.programme.code}</TableCell>
                    <TableCell>{student.academicYear}</TableCell>
                    <TableCell>
                      <EnrolmentStatusBadge status={student.enrolmentStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  )
}
