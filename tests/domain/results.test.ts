import { describe, expect, it } from "vitest"

import { calculateClassification } from "@/lib/domain/results"

describe("calculateClassification", () => {
  it.each([
    [0, "Fail"],
    [39, "Fail"],
    [40, "Pass"],
    [59, "Pass"],
    [60, "Merit"],
    [69, "Merit"],
    [70, "Distinction"],
    [100, "Distinction"],
  ] as const)("grade %i is %s", (grade, expected) => {
    expect(calculateClassification(grade)).toBe(expected)
  })
})
