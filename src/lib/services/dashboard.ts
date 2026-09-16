import { prisma } from "@/lib/prisma"
import { countPendingSubmissions } from "@/lib/services/assessments"
import { listFeeOverview, totalOutstandingByCurrency, type FeeOverviewRow } from "@/lib/services/fees"

export type StaffDashboard = {
  totalStudents: number
  enrolledStudents: number
  totalOutstanding: { currency: string; amount: string }[]
  overdueStudents: number
  pendingSubmissions: number
  unpublishedResults: number
  overdue: FeeOverviewRow[]
}

/** The six Registry dashboard figures and the overdue fees table (architecture.md §19). */
export async function getStaffDashboard(now = new Date()): Promise<StaffDashboard> {
  const [totalStudents, enrolledStudents, fees, pendingSubmissions, unpublishedResults] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { enrolmentStatus: "ENROLLED" } }),
    listFeeOverview({}, now),
    countPendingSubmissions(),
    prisma.result.count({ where: { published: false } }),
  ])

  const overdue = fees
    .filter((row) => row.status === "OVERDUE")
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.student.studentId.localeCompare(b.student.studentId))

  return {
    totalStudents,
    enrolledStudents,
    totalOutstanding: totalOutstandingByCurrency(fees),
    overdueStudents: overdue.length,
    pendingSubmissions,
    unpublishedResults,
    overdue,
  }
}
