"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** Tabs whose selection lives in ?tab=, so links like "/staff/students/[id]?tab=fees" open the right tab. */
export function UrlTabs({
  tabs,
  defaultTab,
}: {
  tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]
  defaultTab: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get("tab")
  const value = tabs.some((tab) => tab.value === requested) ? requested! : defaultTab

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams)
        params.set("tab", String(next))
        router.replace(`${pathname}?${params}`, { scroll: false })
      }}
    >
      <TabsList className="h-auto max-w-full flex-wrap">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="flex-none">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
