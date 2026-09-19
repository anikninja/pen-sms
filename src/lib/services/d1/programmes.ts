/** Programmes on Cloudflare D1. Same queries and rules as src/lib/services/programmes.ts. */
import type { D1Client } from "@/lib/services/d1/client"
import { assertActiveProgramme, type ProgrammeDto } from "@/lib/services/shared/programmes"

const programmeSelect = { id: true, code: true, name: true, active: true } as const

export async function listProgrammes(db: D1Client, options: { activeOnly?: boolean } = {}): Promise<ProgrammeDto[]> {
  return db.programme.findMany({
    where: options.activeOnly ? { active: true } : undefined,
    orderBy: { code: "asc" },
    select: programmeSelect,
  })
}

/** For create/move operations: the programme must exist and accept new students or assessments. */
export async function requireActiveProgramme(db: D1Client, programmeId: string): Promise<ProgrammeDto> {
  return assertActiveProgramme(await db.programme.findUnique({ where: { id: programmeId }, select: programmeSelect }))
}
