"use client"

import { useEffect } from "react"
import { FileQuestionIcon, TriangleAlertIcon } from "lucide-react"

import { ButtonLink } from "@/components/shared/button-link"
import { Button } from "@/components/ui/button"

export type RouteErrorProps = { error: Error & { digest?: string }; retry: () => void }

function StateCard({ icon, title, children, actions }: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  )
}

/**
 * Fallback for an unexpected error while rendering a page. The error's message is never shown:
 * in production Next.js replaces server error messages anyway, and database details must not
 * reach the browser (architecture.md §33). The digest matches the server log entry.
 */
export function RouteError({ error, retry, homeHref }: RouteErrorProps & { homeHref: string }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <StateCard
      icon={<TriangleAlertIcon className="size-5" />}
      title="Something went wrong"
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href={homeHref} variant="outline">
            Go to dashboard
          </ButtonLink>
        </>
      }
    >
      <p>This page could not be loaded. Please try again in a moment.</p>
      {error.digest && <p className="mt-2 font-mono text-xs">Reference: {error.digest}</p>}
    </StateCard>
  )
}

export function NotFoundState({ homeHref, homeLabel = "Go to dashboard" }: { homeHref: string; homeLabel?: string }) {
  return (
    <StateCard
      icon={<FileQuestionIcon className="size-5" />}
      title="Page not found"
      actions={<ButtonLink href={homeHref}>{homeLabel}</ButtonLink>}
    >
      <p>The page or record you are looking for does not exist, or you do not have access to it.</p>
    </StateCard>
  )
}
