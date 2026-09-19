/**
 * The enum values of both Prisma schemas, as plain constants. Shared code (validation, the Worker)
 * uses these instead of importing the enum objects from a generated Prisma client, so it does not
 * pull a database client into bundles that must not contain one. A test checks they stay equal to
 * the enums of prisma/schema.prisma and prisma/d1/schema.prisma.
 */
export const ENROLMENT_STATUSES = ["ENROLLED", "DEFERRED", "WITHDRAWN", "COMPLETED"] as const
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number]

export const ROLES = ["STAFF", "STUDENT"] as const
export type Role = (typeof ROLES)[number]
