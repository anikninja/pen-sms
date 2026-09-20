import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { GraduationCapIcon } from "lucide-react"

import { InxappCredit, InxappCreditCompact } from "@/components/inxapp-credit"
import { LoginForm } from "@/components/login-form"
import { ROLE_HOME } from "@/lib/auth/roles"
import { PRODUCT } from "@/lib/brand"
import { getSession } from "@/lib/auth/session"

export const metadata: Metadata = { title: `Sign in · ${PRODUCT.name}` }

// Matches prisma/seed.ts. Shown only when DEMO_MODE="true".
const DEMO_ACCOUNTS = [
  { role: "Staff (Registry)", email: "registry@sms.inxapp.net" },
  { role: "Student", email: "rahim.uddin@sms.inxapp.net" },
]
const DEMO_PASSWORD = "Password123!"

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect(ROLE_HOME[session.role])

  const showDemo = process.env.DEMO_MODE === "true"

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium">
          <GraduationCapIcon className="size-5" />
          {PRODUCT.name} · {PRODUCT.module}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-xs flex-col gap-6">
            <LoginForm />
            {showDemo && (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="mb-2 font-medium text-foreground">Demo accounts</p>
                <ul className="space-y-1">
                  {DEMO_ACCOUNTS.map((account) => (
                    <li key={account.email}>
                      <span className="text-foreground">{account.role}:</span>{" "}
                      <code className="break-all">{account.email}</code>
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  <span className="text-foreground">Password:</span>{" "}<code>{DEMO_PASSWORD}</code>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span>Note: Every seeded student can sign in with their student email.</span>
                </p>
              </div>
            )}
          </div>
        </div>
        {/* The company credit lives in the right-hand panel, which small screens do not show. */}
        <InxappCreditCompact className="self-center px-0 lg:hidden" />
      </div>
      <div className="relative hidden flex-col justify-end gap-8 bg-muted p-10 lg:flex">
        <blockquote className="max-w-md space-y-2">
          <p className="text-lg font-medium">Student Registry</p>
          <p className="text-sm text-muted-foreground">
            Enrolment, fees and payments, assessment submissions, and results — for Registry staff
            and the students they support.
          </p>
        </blockquote>
        <InxappCredit className="border-t pt-6" />
      </div>
    </div>
  )
}
