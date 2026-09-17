import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { Session } from "@/lib/auth/session"

export function AppShell({
  session,
  title,
  children,
}: {
  session: Session
  title: string
  children: React.ReactNode
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        role={session.role}
        user={{ name: session.name, email: session.email }}
      />
      {/* min-w-0: a flex item defaults to its content width, so a wide table would widen the whole page
          instead of scrolling inside its own container (seen at 768px with the sidebar open). */}
      <SidebarInset className="min-w-0">
        <SiteHeader title={title} />
        <main className="flex flex-1 flex-col gap-6 p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
