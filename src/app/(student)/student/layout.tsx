import { AppShell } from "@/components/app-shell"
import { requireStudent } from "@/lib/auth/session"

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStudent()
  return (
    <AppShell session={session} title="Student Portal">
      {children}
    </AppShell>
  )
}
