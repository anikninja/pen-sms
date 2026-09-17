"use client"

import "./globals.css"

import type { RouteErrorProps } from "@/components/shared/route-states"

// Last resort when the root layout itself fails. It replaces the whole document, so it keeps to plain markup.
export default function GlobalError({ error, retry }: RouteErrorProps) {
  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center p-4 font-sans antialiased">
        <title>Something went wrong · PEN SMS</title>
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">The application could not be loaded. Please try again in a moment.</p>
          {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
          <button type="button" onClick={() => retry()} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
