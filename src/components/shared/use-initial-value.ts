"use client"

import { useState } from "react"

/**
 * The value from the first render, ignoring later props.
 *
 * Uncontrolled inputs (Base UI FieldControl) must keep the same defaultValue while mounted. After a
 * Server Action revalidates, a form can re-render with fresh props before it closes or navigates
 * away; freezing its defaults avoids the "changing the default value state" warning.
 */
export function useInitialValue<T>(value: T): T {
  const [initial] = useState(value)
  return initial
}
