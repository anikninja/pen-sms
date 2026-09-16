import { prisma } from "@/lib/prisma"
import { fieldError } from "@/lib/errors"

export type ProgrammeDto = { id: string; code: string; name: string; active: boolean }

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
  if (!programme) throw fieldError("programmeId", "Choose a valid programme.")
  if (!programme.active) throw fieldError("programmeId", "This programme is not active.")
  return programme
}
