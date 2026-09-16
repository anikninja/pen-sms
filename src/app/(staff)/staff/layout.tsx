import { AppShell } from "@/components/app-shell"
import { requireStaff } from "@/lib/auth/session"

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff()
  return (
    <AppShell session={session} title="Registry">
      {children}
    </AppShell>
  )
}
