import { prisma } from "@/lib/prisma"
import { countPendingSubmissions } from "@/lib/services/assessments"
import { listFeeOverview } from "@/lib/services/fees"
import { buildStaffDashboard, type StaffDashboard } from "@/lib/services/shared/overviews"

export type { StaffDashboard } from "@/lib/services/shared/overviews"

/** The six Registry dashboard figures and the overdue fees table (architecture.md §19). */
export async function getStaffDashboard(now = new Date()): Promise<StaffDashboard> {
  const [totalStudents, enrolledStudents, fees, pendingSubmissions, unpublishedResults] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { enrolmentStatus: "ENROLLED" } }),
    listFeeOverview({}, now),
    countPendingSubmissions(),
    prisma.result.count({ where: { published: false } }),
  ])
  return buildStaffDashboard({ totalStudents, enrolledStudents, fees, pendingSubmissions, unpublishedResults })
}
