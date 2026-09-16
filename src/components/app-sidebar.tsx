"use client"

import * as React from "react"
import Link from "next/link"
import { GraduationCapIcon, LayoutDashboardIcon } from "lucide-react"

import { NavMain, type NavItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ROLE_HOME, type AppRole } from "@/lib/auth/roles"

// Each build phase adds its screens here (docs/PROGRESS.md).
const NAV: Record<AppRole, NavItem[]> = {
  STAFF: [{ title: "Dashboard", url: "/staff/dashboard", icon: <LayoutDashboardIcon /> }],
  STUDENT: [{ title: "Dashboard", url: "/student/dashboard", icon: <LayoutDashboardIcon /> }],
}

export function AppSidebar({
  role,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  role: AppRole
  user: { name: string; email: string }
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href={ROLE_HOME[role]} />}
            >
              <GraduationCapIcon className="size-5!" />
              <span className="text-base font-semibold">PEN SMS</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {role === "STAFF" ? "Registry" : "Student"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={NAV[role]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
