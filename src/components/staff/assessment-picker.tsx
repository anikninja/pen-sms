"use client"

import { useRouter } from "next/navigation"

import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"

type Option = { id: string; title: string; module: string; programmeCode: string; unpublished: number }

/** Changing the assessment updates ?assessment= so the page loads that assessment's grades on the server. */
export function AssessmentPicker({ options, selectedId }: { options: Option[]; selectedId: string | null }) {
  const router = useRouter()
  const programmes = [...new Set(options.map((option) => option.programmeCode))]

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="assessment">Assessment</Label>
      <NativeSelect
        id="assessment"
        value={selectedId ?? ""}
        onChange={(event) => router.push(`/staff/results?assessment=${event.target.value}`)}
        className="w-full sm:w-[28rem]"
      >
        {selectedId === null && (
          <NativeSelectOption value="" disabled>
            Choose an assessment
          </NativeSelectOption>
        )}
        {programmes.map((code) => (
          <NativeSelectOptGroup key={code} label={code}>
            {options
              .filter((option) => option.programmeCode === code)
              .map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.title} — {option.module}
                  {option.unpublished > 0 ? ` (${option.unpublished} withheld)` : ""}
                </NativeSelectOption>
              ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
    </div>
  )
}
