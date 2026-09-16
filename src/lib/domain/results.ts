export type Classification = "Distinction" | "Merit" | "Pass" | "Fail"

/** architecture.md §12. Classification is always derived, never stored. */
export function calculateClassification(grade: number): Classification {
  if (grade >= 70) return "Distinction"
  if (grade >= 60) return "Merit"
  if (grade >= 40) return "Pass"
  return "Fail"
}
