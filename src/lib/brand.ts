/**
 * Product and company identity, in one place so screens, metadata and documentation never drift.
 * INX SMS is the first product of INXAPP Limited; the logo files live in public/brand.
 */
export const PRODUCT = {
  name: "INX SMS",
  /** Shown next to the product name in the sidebar and on the sign-in screen. */
  module: "Registry",
  description: "A Student Management System for university Registry teams.",
} as const

export const COMPANY = {
  name: "INXAPP Limited",
  short: "INXAPP",
  tagline: "Innovate. Execute. Excel.",
  promise: "Building Next-Gen Software Solutions for a Smarter Tomorrow.",
  url: "https://www.inxapp.net",
  /** Without the scheme, for display. */
  domain: "www.inxapp.net",
} as const

/** "An INXAPP Limited product" — the credit line used across the app and the README. */
export const CREDIT = `An ${COMPANY.name} product` as const
