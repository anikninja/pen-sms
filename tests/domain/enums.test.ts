import { $Enums as PostgresEnums } from "@prisma/client"
import { describe, expect, it } from "vitest"

import { $Enums as D1Enums } from ".prisma/client-d1"

import { ENROLMENT_STATUSES, ROLES } from "@/lib/domain/enums"

describe("enum constants match both Prisma schemas", () => {
  it("EnrolmentStatus", () => {
    expect([...ENROLMENT_STATUSES].sort()).toEqual(Object.values(PostgresEnums.EnrolmentStatus).sort())
    expect([...ENROLMENT_STATUSES].sort()).toEqual(Object.values(D1Enums.EnrolmentStatus).sort())
  })

  it("Role", () => {
    expect([...ROLES].sort()).toEqual(Object.values(PostgresEnums.Role).sort())
    expect([...ROLES].sort()).toEqual(Object.values(D1Enums.Role).sort())
  })
})
