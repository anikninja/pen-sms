import { fieldError } from "@/lib/errors"

export type ProgrammeDto = { id: string; code: string; name: string; active: boolean }

/** For create/move operations: the programme must exist and accept new students or assessments. */
export function assertActiveProgramme(programme: ProgrammeDto | null): ProgrammeDto {
  if (!programme) throw fieldError("programmeId", "Choose a valid programme.")
  if (!programme.active) throw fieldError("programmeId", "This programme is not active.")
  return programme
}
