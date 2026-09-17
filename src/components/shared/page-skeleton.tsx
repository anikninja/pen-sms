import { Skeleton } from "@/components/ui/skeleton"

/** Placeholder shaped like a Registry page (header, summary cards, table) while its data loads. */
export function PageSkeleton({ cards = 3, rows = 5 }: { cards?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {cards > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-lg border p-3">
        <Skeleton className="h-6 w-full" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}
