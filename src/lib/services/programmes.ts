import { prisma } from "@/lib/prisma"
import { assertActiveProgramme, type ProgrammeDto } from "@/lib/services/shared/programmes"

export type { ProgrammeDto } from "@/lib/services/shared/programmes"

export async function listProgrammes(options: { activeOnly?: boolean } = {}): Promise<ProgrammeDto[]> {
  return prisma.programme.findMany({
    where: options.activeOnly ? { active: true } : undefined,
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, active: true },
  })
}

/** For create/move operations: the programme must exist and accept new students or assessments. */
export async function requireActiveProgramme(programmeId: string): Promise<ProgrammeDto> {
  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: { id: true, code: true, name: true, active: true },
  })
  return assertActiveProgramme(programme)
}
